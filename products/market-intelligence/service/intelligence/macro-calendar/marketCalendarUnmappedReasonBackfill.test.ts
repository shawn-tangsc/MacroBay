import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, recordCalendarUnmapped, upsertCalendarStandardRow }
  from './marketCalendarStandardTable'
import { recomputeUnmappedReasons, unmappedReasonBackupTable } from './marketCalendarUnmappedReasonBackfill'

const unmappedRow = (over: Record<string, unknown> = {}) => ({
  providerId: 'narwhal', sourceKey: '["206580",1]',
  detectedAt: '2026-11-18T00:00:00.000Z',
  rawJson: JSON.stringify({ name: '在庫', eventKind: 'economic-indicator' }),
  reason: 'missing-country' as const, ...over
})

const reasonsOf = (database: DatabaseSync) =>
  database.prepare('select reason from mi_calendar_unmapped order by reason').all() as { reason: string }[]

const standardRow = (over: Record<string, unknown> = {}) => ({
  countryCode: 'JP', metricKey: 'r-1', periodKey: '2026-10', scheduledDate: '2026-11-18',
  scheduledAt: '2026-11-18T10:30:00.000Z', timePrecision: 'minute' as const,
  valuesJson: '{}', sourceProviderId: 'narwhal', sourceEventId: '["206580",1]', parserVersion: 'v1',
  observedAt: '2026-11-18T10:31:00.000Z', firstSeenAt: '2026-11-18T10:31:00.000Z',
  identityKind: 'source' as const, sourceLabel: '在庫', seriesId: 'no-such-series', ...over
})

describe('未映射原因重算：recomputeUnmappedReasons', () => {
  it('源自己说不是经济指标 → 事件；已转正的行 → 从清单删掉', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    recordCalendarUnmapped(database, unmappedRow({
      sourceKey: '["44671",75353"]'.replace('"]', '"'),
      rawJson: JSON.stringify({ name: '泰国央行公布货币政策会议纪要', eventKind: 'central-bank-activity' }),
    }))
    recordCalendarUnmapped(database, unmappedRow({ sourceKey: '["213556",71983]' }))
    upsertCalendarStandardRow(database, standardRow({ sourceEventId: '["213556",71983]', identityKind: 'code' }))
    const report = recomputeUnmappedReasons(database)
    expect(report.scanned).toBe(2)
    expect(report.deleted).toBe(1)
    expect(reasonsOf(database)).toEqual([{ reason: 'unknown-event-type' }])
  })

  it('同国家映射表里有这条源内 id → 也是过期条目，删', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    recordCalendarUnmapped(database, unmappedRow())
    upsertCalendarStandardRow(database, standardRow())
    expect(recomputeUnmappedReasons(database).deleted).toBe(1)
    expect(reasonsOf(database)).toEqual([])
  })

  it('测度是 LEVEL 的码 → period-unresolved（码认出来了，源没给统计期，不推算）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    recordCalendarUnmapped(database, unmappedRow({
      sourceKey: '["999999",1]', rawJson: JSON.stringify({ name: '10月ZEW经济景气指数', eventKind: 'economic-indicator' }),
    }))
    upsertCalendarStandardRow(database, standardRow({ sourceEventId: '["999999",1]', countryCode: 'DE' }))
    recomputeUnmappedReasons(database)
    expect(reasonsOf(database)).toEqual([{ reason: 'period-unresolved' }])
  })

  it('对不上任何码 → no-code；幂等：第二次一条都不写', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    recordCalendarUnmapped(database, unmappedRow({
      sourceKey: '["888888",1]', rawJson: JSON.stringify({ name: '某个还没有码的指标', eventKind: 'economic-indicator' }),
    }))
    upsertCalendarStandardRow(database, standardRow({ sourceEventId: '["888888",1]', countryCode: 'JP' }))
    const first = recomputeUnmappedReasons(database)
    const second = recomputeUnmappedReasons(database)
    expect(reasonsOf(database)).toEqual([{ reason: 'no-code' }])
    expect(first.updated).toBe(1)
    expect(second).toEqual({ scanned: 1, deleted: 0, updated: 0, counts: { 'no-code': 1 } })
    // 跑前备份只建一次，内容是改判**之前**的那一版。
    const backup = database.prepare(`select reason from ${unmappedReasonBackupTable}`).all() as { reason: string }[]
    expect(backup).toEqual([{ reason: 'missing-country' }])
  })

  it('dryRun 只报数不写库', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    recordCalendarUnmapped(database, unmappedRow({
      sourceKey: '["888888",1]', rawJson: JSON.stringify({ name: '随便一个指标', eventKind: 'economic-indicator' }),
    }))
    upsertCalendarStandardRow(database, standardRow({ sourceEventId: '["888888",1]', countryCode: 'JP' }))
    expect(recomputeUnmappedReasons(database, { dryRun: true }).updated).toBe(1)
    expect(reasonsOf(database)).toEqual([{ reason: 'missing-country' }])
  })
})
