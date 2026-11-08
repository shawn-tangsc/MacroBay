import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'

/**
 * A library written before the write model changed had no `unique(collection_id, candidate_key)`,
 * so one batch could store the same identity twice. Cross-batch rows are history and must survive;
 * only copies that share a batch are collapsed, and the removed copies are kept in a backup table so
 * the operation has a way back.
 */
function legacyDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  database.exec(`create table mi_macro_calendar_market_event_observations (
    observation_id text primary key,
    collection_id text not null,
    candidate_key text not null,
    provider_id text not null,
    locale text not null
  )`)
  // Two copies of one identity in the same batch, and one row in another batch.
  database.exec(`insert into mi_macro_calendar_market_event_observations values
    ('o1', 'batch-1', 'key-a', '0xrouter', 'zh'),
    ('o2', 'batch-1', 'key-a', '0xrouter', 'zh'),
    ('o3', 'batch-2', 'key-a', '0xrouter', 'zh')`)
  return database
}

function open(database: DatabaseSync) {
  return createMarketCalendarEventRepository({
    database,
    resolveCollectionContext: () => ({ providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data', locale: 'zh', month: '2026-09', detectedAt: '2026-09-08T00:00:00.000Z', evidence: { providerId: '0xrouter', descriptorId: 'macro-calendar-0xrouter-economic-data', rawRecordId: 'raw-one', evidenceHash: 'a'.repeat(64) } }),
    readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }),
    now: () => '2026-09-08T00:00:01.000Z',
    cursorKey: Buffer.alloc(32, 7)
  })
}

function rows(database: DatabaseSync, table = 'mi_macro_calendar_market_event_observations') {
  return database.prepare(`select observation_id from ${table} order by observation_id`).all()
    .map((row) => String((row as { observation_id: string }).observation_id))
}

describe('the same-batch identity migration', () => {
  it('collapses two copies in one batch, keeps the other batch and records what it removed', () => {
    const database = legacyDatabase()
    open(database)
    // One row per (batch, identity): the newest of the duplicates stays, the other two batches live on.
    expect(rows(database)).toEqual(['o2', 'o3'])
    // The removed copy is recoverable, not silently gone.
    expect(rows(database, 'mi_macro_calendar_market_observation_duplicates_backup')).toEqual(['o1'])
    const unique = database.prepare('pragma index_list(mi_macro_calendar_market_event_observations)').all() as { name: string; unique: number }[]
    expect(unique.some((index) => Number(index.unique) === 1 && index.name === 'idx_mi_calendar_market_observation_identity_key')).toBe(true)
    database.close()
  })

  it('does not touch a library that already enforces the identity', () => {
    const database = legacyDatabase()
    open(database)
    const before = rows(database)
    // A second open (every start re-runs the migration) must be a no-op.
    open(database)
    expect(rows(database)).toEqual(before)
    database.close()
  })
})
