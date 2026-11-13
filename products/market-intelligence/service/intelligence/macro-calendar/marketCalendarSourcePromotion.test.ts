import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarStandardTables, recordCalendarUnmapped, upsertCalendarStandardRow }
  from './marketCalendarStandardTable'
import { promoteSourceIdentities } from './marketCalendarSourcePromotion'

const sourceRow = (over: Record<string, unknown> = {}) => ({
  countryCode: 'USA', metricKey: 'r-1', periodKey: '2026-10', scheduledDate: '2026-11-18',
  scheduledAt: '2026-11-18T10:30:00.000Z', timePrecision: 'minute' as const,
  valuesJson: '{}', sourceProviderId: 'narwhal', sourceEventId: 'r-1', parserVersion: 'v1',
  observedAt: '2026-11-18T10:31:00.000Z', firstSeenAt: '2026-11-18T10:31:00.000Z',
  identityKind: 'source' as const, sourceLabel: 'Securities transactions',
  seriesId: 'usa-securities-transactions', ...over
})

const rowsOf = (database: DatabaseSync) =>
  database.prepare('select metric_key, identity_kind, source_event_id from mi_calendar_events').all() as
    { metric_key: string; identity_kind: string; source_event_id: string }[]

describe('转正入口：promoteSourceIdentities', () => {
  it('算出身份的原地转正；同一行转两次不新增（幂等）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 就业统计这个 series 里有 measure（adp_employment_change）→ 组主测度是 US.ADP.SA.CHANGE。
    upsertCalendarStandardRow(database, sourceRow({ metricKey: 'r-adp', sourceEventId: 'r-adp',
      seriesId: 'usa-employment-statistics', sourceLabel: 'Employment statistics' }))
    const first = promoteSourceIdentities(database)
    const second = promoteSourceIdentities(database)
    expect(first).toEqual({ scanned: 1, promoted: 1, stillSource: 0 })
    expect(second).toEqual({ scanned: 0, promoted: 0, stillSource: 0 })
    const rows = rowsOf(database)
    expect(rows).toHaveLength(1)                       // 转正后不许多出一行
    expect(rows[0]!.metric_key).toBe('US.ADP.SA.CHANGE')
    expect(rows[0]!.identity_kind).toBe('code')
  })

  it('同身份同一天已有标准码行 → 并进去（删源内那行），不留两行', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 先有一条标准码行（值后到那种），再来一条同身份同日的源内身份行。
    upsertCalendarStandardRow(database, sourceRow({ metricKey: 'US.ADP.SA.CHANGE', identityKind: 'code',
      sourceEventId: 'r-code', valuesJson: '{"actual":"165"}' }))
    upsertCalendarStandardRow(database, sourceRow({ metricKey: 'r-2', sourceEventId: 'r-2',
      seriesId: 'usa-employment-statistics', sourceLabel: 'Employment statistics' }))
    expect(promoteSourceIdentities(database)).toEqual({ scanned: 1, promoted: 1, stillSource: 0 })
    const rows = rowsOf(database)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.identity_kind).toBe('code')
  })

  it('算不出身份的留在原地，并计入 stillSource', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, sourceRow({ seriesId: 'usa-nowhere-series', sourceLabel: 'Something new' }))
    expect(promoteSourceIdentities(database)).toEqual({ scanned: 1, promoted: 0, stillSource: 1 })
    expect(rowsOf(database)[0]!.identity_kind).toBe('source')
  })

  it('dryRun 只报数，不写库', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, sourceRow({ metricKey: 'r-adp', sourceEventId: 'r-adp',
      seriesId: 'usa-employment-statistics', sourceLabel: 'Employment statistics' }))
    expect(promoteSourceIdentities(database, { dryRun: true })).toEqual({ scanned: 1, promoted: 1, stillSource: 0 })
    expect(rowsOf(database)[0]!.identity_kind).toBe('source')   // 一行都没动
    expect(rowsOf(database)[0]!.metric_key).toBe('r-adp')
  })

  it('转正后清单里的对应条目被移除；留下的每条都查得到标准行', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, sourceRow({ metricKey: 'r-adp', sourceEventId: 'r-adp',
      seriesId: 'usa-employment-statistics', sourceLabel: 'Employment statistics' }))
    upsertCalendarStandardRow(database, sourceRow({ metricKey: 'r-keep', sourceEventId: 'r-keep',
      seriesId: 'usa-nowhere-series', sourceLabel: 'Something new' }))
    for (const key of ['r-adp', 'r-keep']) {
      recordCalendarUnmapped(database, { providerId: 'narwhal', sourceKey: key,
        detectedAt: '2026-11-18T10:31:00.000Z', rawJson: '{"measureKeys":[]}', reason: 'unknown-event-type' })
    }
    promoteSourceIdentities(database)
    const left = database.prepare('select source_key from mi_calendar_unmapped').all() as { source_key: string }[]
    expect(left.map((entry) => entry.source_key)).toEqual(['r-keep'])
    // 清单不是孤儿列表：留下的每一条都能按 source_event_id 找回它的标准行。
    const events = database.prepare("select source_event_id from mi_calendar_events where identity_kind = 'source'")
      .all() as { source_event_id: string }[]
    for (const entry of left) expect(events.map((row) => row.source_event_id)).toContain(entry.source_key)
  })
})
