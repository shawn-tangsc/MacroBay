import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { createMarketCalendarEventRepository } from './marketCalendarEventRepository'
import type { MarketCollectionContext } from './marketCalendarStorageValidation'
import { narwhalSourceEventIdForIdentity } from '../marketCalendarMetricIdentity'

const NOW = '2026-11-13T10:30:00.000Z'
const descriptorId = 'macro-calendar-narwhal-economic-data'

/**
 * 同一批次里，有的行带 `measure_keys_json`、有的不带（来源没有该列的测度）。
 *
 * 插入语句原本按**第一行的列**拼一份并在批次内共用——列集合不同时，
 * 后面的行会按位错绑，最后撞 `unique(collection_id, candidate_key)` 整批回滚。
 * 回归：这种混合批次必须整批写进去，且每行落到自己的身份上。
 */
function batch(collectionId: string, withKeys: boolean[]) {
  return {
    providerId: 'narwhal', descriptorId, locale: 'zh', month: '2026-12', collectionId,
    parserVersion: 'v-test',
    parseResult: {
      state: 'succeeded' as const,
      drafts: withKeys.map((hasKeys, index) => {
        const metricKey = `US.TEST_${index}.NONE.LEVEL`
        const sourceEventId = narwhalSourceEventIdForIdentity({ countryCode: 'USA', metricKey, periodKey: '2026-11' })
        return {
          providerId: 'narwhal', descriptorId, kind: 'economic-indicator', locale: 'zh',
          sourceEventId, marketFactKey: JSON.stringify(['narwhal', descriptorId, 'zh', sourceEventId]),
          identityState: 'unverified', localeMerge: 'disabled', officialLink: 'disabled',
          displayName: 'Test release', countryCode: 'US', importance: 'medium',
          scheduledDate: '2026-12-01', scheduledAt: '2026-12-01T13:30:00.000Z',
          ...(hasKeys ? { measureKeys: metricKey } : {})
        }
      }),
      diagnostics: { inputRows: withKeys.length, skippedRows: 0,
        reasons: { 'invalid-identity': 0, 'invalid-date': 0, 'invalid-row': 0 } }
    }
  }
}

describe('混合列批次', () => {
  it('同一批次里有的行带 measure_keys、有的不带，也能整批写入', () => {
    const database = new DatabaseSync(':memory:')
    const contexts = new Map<string, MarketCollectionContext>()
    const repository = createMarketCalendarEventRepository({ database, cursorKey: Buffer.alloc(32, 21),
      now: () => NOW, resolveCollectionContext: (id: string) => contexts.get(id),
      readCapacity: () => ({ marketBytes: 0, walBytes: 0, freeBytes: 10 * 1024 ** 3, archiveAvailable: true }) })
    contexts.set('mixed-1', { providerId: 'narwhal', descriptorId, locale: 'zh', month: '2026-12',
      detectedAt: NOW, evidence: { providerId: 'narwhal', descriptorId, rawRecordId: 'raw-1', evidenceHash: 'e'.repeat(64) } })
    expect(repository.appendCollection(batch('mixed-1', [true, false, true])).state).toBe('succeeded')
    const rows = database.prepare('select candidate_key, measure_keys_json from mi_macro_calendar_market_event_observations order by candidate_key').all() as
      { candidate_key: string; measure_keys_json: string | null }[]
    expect(rows).toHaveLength(3)
    expect(new Set(rows.map((row) => row.candidate_key)).size).toBe(3)
    expect(rows.filter((row) => row.measure_keys_json === null)).toHaveLength(1)
  })
})
