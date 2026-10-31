import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStoredEdition } from './dailyBriefingService'
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
import type { DailyBriefCoreFactEnsureResult } from './dailyBriefFactEnsure'
import { ensureDailyBriefFactsAtStartup } from './dailyBriefFactEnsureStartup'

const now = '2026-10-30T09:00:00.000Z'

function document(date: string): DailyBriefingDocument {
  const asOf = `${date}T00:00:00.000Z`
  return buildDailyBriefingDocument({
    date,
    packet: {
      asOf,
      windowStart: new Date(Date.parse(asOf) - 24 * 60 * 60 * 1_000).toISOString(),
      windowEnd: asOf,
      windowHours: 24,
      locale: 'zh-CN',
      timeZone: 'Asia/Shanghai',
      conclusion: null,
      news: { state: 'empty', items: [] },
      calendar: { state: 'source-disabled', events: [] },
      readings: {
        fearGreed: { state: 'empty', asOf },
        funding: { state: 'empty', asOf },
        capital: { state: 'empty', asOf }
      },
      market: {},
      enabled: { fearGreed: false, funding: false, stablecoin: true, etf: true, calendar: false }
    }
  })
}

function row(date: string, locale: DailyBriefingLocale = 'zh-CN'): DailyBriefingStoredEdition {
  return {
    date,
    locale,
    generatedAt: `${date}T00:30:00.000Z`,
    windowStart: `${date}T00:00:00.000Z`,
    windowEnd: `${date}T00:00:00.000Z`,
    document: document(date)
  }
}

function memoryStore(rows: readonly DailyBriefingStoredEdition[]) {
  const key = (date: string, locale: string) => `${date}:${locale}`
  const map = new Map(rows.map((item) => [key(item.date, item.locale), item]))
  const puts: DailyBriefingStoredEdition[] = []
  return {
    map,
    puts,
    async list(from: string, to: string, locale: DailyBriefingLocale) {
      return [...map.values()].filter((item) => item.locale === locale && item.date >= from && item.date <= to)
    },
    async get(date: string, locale: DailyBriefingLocale) {
      return map.get(key(date, locale))
    },
    async put(item: DailyBriefingStoredEdition) {
      puts.push(item)
      map.set(key(item.date, item.locale), item)
    }
  }
}

function result(document: DailyBriefingDocument, changed = true): DailyBriefCoreFactEnsureResult {
  return {
    document: changed
      ? { ...document, provenance: { ...document.provenance, readAt: '2026-10-30T09:00:00.000Z' } }
      : document,
    changed,
    filled: changed ? ['core-stablecoin-supply-usd'] : [],
    statuses: []
  }
}

describe('daily brief fact ensure at startup', () => {
  it('does nothing when no edition is stored', async () => {
    const store = memoryStore([])
    const ensure = vi.fn(async ({ document }: { document: DailyBriefingDocument }) => result(document))
    const events: Readonly<Record<string, unknown>>[] = []

    await ensureDailyBriefFactsAtStartup({
      store,
      ensure,
      locale: async () => 'zh-CN',
      now: () => now,
      onEvent: (event) => { events.push(event) }
    })

    expect(ensure).not.toHaveBeenCalled()
    expect(store.puts).toEqual([])
    expect(events).toContainEqual(expect.objectContaining({ event: 'startup-skipped' }))
  })

  it('ensures only the latest stored edition and writes it back when a row is filled', async () => {
    const store = memoryStore([row('2026-10-29'), row('2026-10-30')])
    const ensure = vi.fn(async ({ document, cutoff }: { document: DailyBriefingDocument; cutoff: string }) => result(document))
    const events: Readonly<Record<string, unknown>>[] = []

    await ensureDailyBriefFactsAtStartup({
      store,
      ensure,
      locale: async () => 'zh-CN',
      now: () => now,
      onEvent: (event) => { events.push(event) }
    })

    expect(ensure).toHaveBeenCalledTimes(1)
    expect(ensure).toHaveBeenCalledWith(expect.objectContaining({
      cutoff: '2026-10-30T00:00:00.000Z',
      trigger: 'startup'
    }))
    expect(store.puts.map((item) => item.date)).toEqual(['2026-10-30'])
    expect(events).toContainEqual(expect.objectContaining({ event: 'startup-filled', editionDate: '2026-10-30' }))
  })

  it('does not write when the edition was regenerated during the ensure', async () => {
    const store = memoryStore([row('2026-10-30')])
    const ensure = vi.fn(async ({ document }: { document: DailyBriefingDocument }) => {
      // A generation lands while the reader was working: the stored row is now newer.
      store.map.set('2026-10-30:zh-CN', { ...row('2026-10-30'), generatedAt: '2026-10-30T09:01:00.000Z' })
      return result(document)
    })
    const events: Readonly<Record<string, unknown>>[] = []

    await ensureDailyBriefFactsAtStartup({
      store,
      ensure,
      locale: async () => 'zh-CN',
      now: () => now,
      onEvent: (event) => { events.push(event) }
    })

    expect(store.puts).toEqual([])
    expect(events).toContainEqual(expect.objectContaining({ event: 'startup-write-skipped', reason: 'regenerated' }))
  })

  it('tolerates a store write failure', async () => {
    const store = memoryStore([row('2026-10-30')])
    const failing = {
      ...store,
      async put(item: DailyBriefingStoredEdition): Promise<void> {
        store.puts.push(item)
        throw new Error('disk full')
      }
    }
    const events: Readonly<Record<string, unknown>>[] = []

    await expect(ensureDailyBriefFactsAtStartup({
      store: failing,
      ensure: async ({ document }) => result(document),
      locale: async () => 'zh-CN',
      now: () => now,
      onEvent: (event) => { events.push(event) }
    })).resolves.toBeUndefined()
    expect(events).toContainEqual(expect.objectContaining({ event: 'startup-edition-failed' }))
  })

  it('ensures both locales stored for the latest date', async () => {
    const store = memoryStore([row('2026-10-30', 'zh-CN'), row('2026-10-30', 'en-US')])
    const ensure = vi.fn(async ({ document }: { document: DailyBriefingDocument }) => result(document))

    await ensureDailyBriefFactsAtStartup({
      store,
      ensure,
      locale: async () => 'zh-CN',
      now: () => now
    })

    expect(ensure).toHaveBeenCalledTimes(2)
    expect(store.puts.map((item) => item.locale).sort()).toEqual(['en-US', 'zh-CN'])
  })
})
