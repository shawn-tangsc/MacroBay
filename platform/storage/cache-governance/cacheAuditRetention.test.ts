import { describe, expect, it } from 'vitest'

import type { CacheOperationAuditRecord } from './cacheContracts'
import {
  cacheAuditRetentionPolicy,
  clampCacheAuditMaxRecords,
  clampCacheAuditRetentionDays,
  pruneCacheAuditRecords
} from './cacheAuditRetention'

const NOW = '2026-11-04T00:00:00.000Z'

function record(operationId: string, requestedAt: string): CacheOperationAuditRecord {
  return {
    operationId,
    cacheId: 'platform.agent-runtime-compatibility',
    ownerType: 'platform',
    ownerId: 'platform',
    operation: 'clear',
    dryRun: false,
    requestedAt,
    status: 'succeeded'
  }
}

describe('cache audit retention', () => {
  it('drops records older than the retention window and keeps the rest in order', () => {
    const result = pruneCacheAuditRecords(
      [
        record('fresh', '2026-11-03T12:00:00.000Z'),
        record('at-cutoff', '2026-08-06T00:00:00.000Z'),
        record('older', '2026-08-05T23:59:59.000Z')
      ],
      { now: NOW }
    )

    expect(result.records.map((entry) => entry.operationId)).toEqual(['fresh', 'at-cutoff'])
    expect(result.removedByAge).toBe(1)
    expect(result.removedByCount).toBe(0)
  })

  it('keeps a record whose timestamp cannot be read instead of guessing it is old', () => {
    // 删掉一条读不出时间的审计记录，比留一条旧记录更糟：它可能是唯一能证明「这里出过事」的那条。
    const result = pruneCacheAuditRecords(
      [record('unparseable', 'not-a-date'), record('fresh', '2026-11-03T12:00:00.000Z')],
      { now: NOW }
    )

    expect(result.records.map((entry) => entry.operationId)).toEqual(['unparseable', 'fresh'])
    expect(result.removedByAge).toBe(0)
  })

  it('trims to the record cap from the oldest end, so the visible top of the list never changes', () => {
    const records = Array.from({ length: 5 }, (_, index) =>
      record(`op-${index}`, `2026-11-0${index + 1}T00:00:00.000Z`)
    )

    const result = pruneCacheAuditRecords(records, { now: NOW, maxRecords: 2 })

    expect(result.records.map((entry) => entry.operationId)).toEqual(['op-4', 'op-3'])
    expect(result.removedByAge).toBe(0)
    expect(result.removedByCount).toBe(3)
  })

  it('applies both limits in one pass and reports them separately', () => {
    const result = pruneCacheAuditRecords(
      [
        record('ancient', '2025-01-01T00:00:00.000Z'),
        record('a', '2026-11-01T00:00:00.000Z'),
        record('b', '2026-11-02T00:00:00.000Z'),
        record('c', '2026-11-03T00:00:00.000Z')
      ],
      { now: NOW, maxRecords: 2 }
    )

    expect(result.records.map((entry) => entry.operationId)).toEqual(['c', 'b'])
    expect(result.removedByAge).toBe(1)
    expect(result.removedByCount).toBe(1)
  })

  it('does nothing when the clock itself is unreadable', () => {
    const result = pruneCacheAuditRecords([record('one', '2020-01-01T00:00:00.000Z')], { now: 'nope' })

    expect(result.records).toHaveLength(1)
    expect(result.removedByAge).toBe(0)
  })

  it('falls back to the defaults for a nonsensical window instead of never deleting', () => {
    expect(clampCacheAuditRetentionDays(0)).toBe(cacheAuditRetentionPolicy.defaultRetentionDays)
    expect(clampCacheAuditRetentionDays(Number.NaN)).toBe(cacheAuditRetentionPolicy.defaultRetentionDays)
    expect(clampCacheAuditRetentionDays(10_000)).toBe(cacheAuditRetentionPolicy.maxRetentionDays)
    expect(clampCacheAuditMaxRecords(0)).toBe(cacheAuditRetentionPolicy.maxRecords)
    expect(clampCacheAuditMaxRecords(-4)).toBe(cacheAuditRetentionPolicy.maxRecords)
  })
})
