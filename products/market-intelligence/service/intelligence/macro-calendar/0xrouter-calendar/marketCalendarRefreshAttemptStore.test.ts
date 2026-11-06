import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import { createMarketCalendarRefreshAttemptStore, latestAttemptFor, readWorstEnabledCollection } from './marketCalendarRefreshAttemptStore'

const descriptors = {
  economic: 'macro-calendar-0xrouter-economic-data',
  events: 'macro-calendar-0xrouter-financial-events',
  bank: 'macro-calendar-0xrouter-central-bank-activities'
} as const

const disposals: Array<() => void> = []
afterEach(() => { while (disposals.length) disposals.pop()?.() })

function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'mc-attempts-'))
  const filePath = join(directory, 'calendar.sqlite')
  const database = new DatabaseSync(filePath)
  // The attempts table is written by the runtime, which always builds the repository first;
  // creating it here reproduces that order and gives the test the real collections schema.
  createMarketCalendarEventRepository({ database })
  const store = createMarketCalendarRefreshAttemptStore(database)
  disposals.push(() => { database.close(); rmSync(directory, { recursive: true, force: true }) })
  return { database, store }
}

/** One successful collection row: `recorded_at` is what "last collected" is derived from. */
function collection(database: DatabaseSync, descriptorId: string, recordedAt: string, locale = 'zh') {
  database.prepare(`insert into mi_macro_calendar_market_event_collections
    (collection_id, provider_id, descriptor_id, locale, window_start, window_end, detected_at, recorded_at,
     raw_record_id, evidence_hash, parser_version, input_count, skipped_count, skip_reasons_json, status)
    values (?, '0xrouter', ?, ?, '2026-11-01T00:00:00.000Z', '2026-11-30T23:59:59.999Z', ?, ?, 'raw-1',
      'evidence-1', 'parser-1', 1, 0, '[]', 'success')`)
    .run(`collection-${descriptorId}-${recordedAt}`, descriptorId, locale, recordedAt, recordedAt)
}

describe('market calendar refresh attempts', () => {
  it('keeps a failure across a restart, which the in-memory map could not do', () => {
    const { database, store } = harness()
    expect(store.record({ descriptorId: descriptors.economic, locale: 'zh', month: '2026-11', attemptedAt: '2026-11-04T11:00:00.000Z',
      state: 'failed', trigger: 'automatic', failureCode: 'response-unavailable' })).toBe(true)

    const reopened = createMarketCalendarRefreshAttemptStore(database)
    expect(reopened.listAttempts()).toEqual([{ descriptorId: descriptors.economic, locale: 'zh', month: '2026-11',
      attemptedAt: '2026-11-04T11:00:00.000Z', state: 'failed', trigger: 'automatic',
      failureCode: 'response-unavailable' }])
  })

  it('never lets an older verdict overwrite a newer one', () => {
    const { store } = harness()
    store.record({ descriptorId: descriptors.economic, locale: 'zh', month: '2026-11', attemptedAt: '2026-11-05T08:00:00.000Z',
      state: 'succeeded', trigger: 'automatic' })
    store.record({ descriptorId: descriptors.economic, locale: 'zh', month: '2026-11', attemptedAt: '2026-11-04T11:00:00.000Z',
      state: 'failed', trigger: 'automatic', failureCode: 'storage-pressure' })
    expect(store.listAttempts()).toEqual([{ descriptorId: descriptors.economic, locale: 'zh', month: '2026-11',
      attemptedAt: '2026-11-05T08:00:00.000Z', state: 'succeeded', trigger: 'automatic' }])
  })

  it('reads last-collected per source as its own latest success', () => {
    const { database, store } = harness()
    collection(database, descriptors.economic, '2026-11-03T13:27:00.000Z')
    collection(database, descriptors.economic, '2026-11-05T08:19:00.000Z')
    expect(store.listCollectionHighWater()).toEqual([
      { descriptorId: descriptors.economic, locale: 'zh', lastCollectedAt: '2026-11-05T08:19:00.000Z' }
    ])
  })

  /**
   * The rule Chief pinned: per source take `max`, then across the enabled sources take `min`.
   * The other order — or one global `max` — reports the live source's age and hides the one
   * that stopped, which is the failure this readout exists to expose.
   */
  it('reports the oldest enabled source, so one live source cannot hide a stopped one', () => {
    const highWater = [
      { descriptorId: descriptors.economic, locale: 'zh' as const, lastCollectedAt: '2026-11-05T08:19:00.000Z' },
      { descriptorId: descriptors.events, locale: 'zh' as const, lastCollectedAt: '2026-11-05T08:19:00.000Z' },
      { descriptorId: descriptors.bank, locale: 'zh' as const, lastCollectedAt: '2026-11-03T13:27:00.000Z' }
    ]
    expect(readWorstEnabledCollection(highWater, [descriptors.economic, descriptors.events, descriptors.bank]))
      .toBe('2026-11-03T13:27:00.000Z')
    // A source nobody enabled must not drag the answer down.
    expect(readWorstEnabledCollection(highWater, [descriptors.economic, descriptors.events]))
      .toBe('2026-11-05T08:19:00.000Z')
    // No enabled source has ever collected: `null` is the answer, not a guess.
    expect(readWorstEnabledCollection(highWater, [])).toBeNull()
  })

  it('shows the newest attempt of a source, across its locales', () => {
    const rows = [
      { descriptorId: descriptors.economic, locale: 'zh' as const, month: '2026-11', attemptedAt: '2026-11-04T11:00:00.000Z', state: 'failed' as const, trigger: 'automatic' as const, failureCode: 'response-unavailable' },
      { descriptorId: descriptors.economic, locale: 'en' as const, month: '2026-11', attemptedAt: '2026-11-05T08:19:00.000Z', state: 'succeeded' as const, trigger: 'automatic' as const }
    ]
    expect(latestAttemptFor(rows, descriptors.economic)).toEqual({ state: 'succeeded',
      attemptedAt: '2026-11-05T08:19:00.000Z', trigger: 'automatic' })
    expect(latestAttemptFor(rows, descriptors.economic, '2026-10')).toBeUndefined()
    expect(latestAttemptFor(rows, descriptors.bank)).toBeUndefined()
  })

  it('rejects a verdict it cannot name', () => {
    const { store } = harness()
    expect(store.record({ descriptorId: descriptors.economic, locale: 'zh', month: '2026-11', attemptedAt: 'not-an-instant',
      state: 'failed', trigger: 'automatic' })).toBe(false)
    expect(store.record({ descriptorId: descriptors.economic, locale: 'zh', month: '2026-11', attemptedAt: '2026-11-04T11:00:00.000Z',
      state: 'failed', trigger: 'automatic', failureCode: 'private-provider-error' })).toBe(false)
    expect(store.listAttempts()).toEqual([])
  })
})
