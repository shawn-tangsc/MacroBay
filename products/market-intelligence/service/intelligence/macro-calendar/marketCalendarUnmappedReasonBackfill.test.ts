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

describe('名字规范化：区间括号（2026-11-18）', () => {
  it('带「（至0925）」的样名剥掉后能命中该国码；不带括号的不受影响', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // `JP.PURCHASED_FOREIGN_BONDS_WEEK.NONE.AMOUNT` 在码表里；源标题带着「（至0925）」。
    recordCalendarUnmapped(database, unmappedRow({
      sourceKey: '["999001",2]',
      rawJson: JSON.stringify({ name: 'Purchased foreign bonds last week (billion yen)（至0925）', eventKind: 'economic-indicator' }),
    }))
    // 用一个**不在映射表里**的源内 id：这样分类只取决于名字能不能对上码，而不是映射。
    upsertCalendarStandardRow(database, standardRow({ sourceEventId: '["999001",2]', countryCode: 'JP' }))
    recomputeUnmappedReasons(database)
    // 剥掉区间括号后名字是「purchased foreign bonds last week (billion yen)」，与码表英文名一致。
    expect(reasonsOf(database)).toEqual([{ reason: 'period-unresolved' }])
  })
})

describe('「已解决」按同一场发布判（2026-11-18）', () => {
  it('同一场发布中英两条、只落了一条带码的行 → 两条都算已解决', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const raw = (name: string) => JSON.stringify({
      name, indicatorId: 4127, scheduledAt: '2026-11-17T06:00:00.000Z', eventKind: 'economic-indicator'
    })
    // 源内 id 用真实的数组形状（分组键取第一段），否则两条不会被认成同一场发布。
    recordCalendarUnmapped(database, { providerId: '0xrouter', sourceKey: '["4127",1]',
      detectedAt: '2026-11-16T10:00:00.000Z', rawJson: raw('10月失业率'), reason: 'no-standard-row' })
    // 第二条是「另一条 locale」：同 indicatorId + 同 scheduledAt，但 key 不同。
    database.prepare(`insert or ignore into mi_calendar_unmapped
      (provider_id, source_key, detected_at, raw_json, reason) values (?,?,?,?,?)`)
      .run('0xrouter', '["4127",2]', '2026-11-16T10:01:00.000Z', raw('unemployment rate'), 'period-unresolved')
    // 标准行的排期时刻必须与源给的一致——判定按「源内 id + 排期时刻」对齐同一场发布。
    upsertCalendarStandardRow(database, standardRow({
      sourceEventId: '["4127",1]', countryCode: 'GB', identityKind: 'code',
      scheduledAt: '2026-11-17T06:00:00.000Z'
    }))
    recomputeUnmappedReasons(database)
    expect(reasonsOf(database)).toEqual([])
  })

  it('没有 indicatorId → 仍按 source_event_id 精确判，不借别人的 key', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    recordCalendarUnmapped(database, { providerId: 'narwhal', sourceKey: 'r-9',
      detectedAt: '2026-11-16T10:00:00.000Z', rawJson: JSON.stringify({ name: '没有 id 的一条' }), reason: 'no-standard-row' })
    upsertCalendarStandardRow(database, standardRow({ sourceEventId: 'r-other', countryCode: 'GB', identityKind: 'code' }))
    recomputeUnmappedReasons(database)
    expect(reasonsOf(database)).toEqual([{ reason: 'no-standard-row' }])
  })

  it('同一时刻、不同 indicatorId → 互不影响，不因时刻相同被判已解决', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const raw = (id: number) => JSON.stringify({ name: 'x', indicatorId: id, scheduledAt: '2026-11-17T06:00:00.000Z' })
    recordCalendarUnmapped(database, { providerId: '0xrouter', sourceKey: 'a-1',
      detectedAt: '2026-11-16T10:00:00.000Z', rawJson: raw(1), reason: 'no-standard-row' })
    recordCalendarUnmapped(database, { providerId: '0xrouter', sourceKey: 'b-1',
      detectedAt: '2026-11-16T10:01:00.000Z', rawJson: raw(2), reason: 'no-standard-row' })
    upsertCalendarStandardRow(database, standardRow({ sourceEventId: 'a-1', countryCode: 'GB', identityKind: 'code' }))
    recomputeUnmappedReasons(database)
    expect(reasonsOf(database)).toEqual([{ reason: 'no-standard-row' }])
  })
})
