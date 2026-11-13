import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it, vi } from 'vitest'

import { dualWriteMeasureRows, dualWriteObservationBatch } from './marketCalendarStandardDualWrite'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'
import { narwhalSourceEventIdForIdentity } from './marketCalendarMetricIdentity'

const key = (metricKey: string, periodKey = '2026-10') =>
  JSON.stringify(['narwhal', 'macro-calendar-narwhal-economic-data', 'zh',
    JSON.parse(narwhalSourceEventIdForIdentity({ countryCode: 'USA', metricKey, periodKey }))])
const draft = (metricKey: string) => ({ marketFactKey: key(metricKey), kind: 'economic-indicator',
  displayName: 'CPI', countryCode: 'US', scheduledAt: '2026-11-10T13:30:00.000Z', scheduledDate: '2026-11-10',
  providerActual: { displayValue: '3.7' }, providerPrevious: { displayValue: '3.4' } })

const batch = (drafts: readonly object[]) => ({ providerId: 'narwhal', parserVersion: 'v1',
  observedAt: '2026-11-10T13:31:00.000Z', drafts: drafts as never })

describe('观测 → 标准 双写', () => {
  it('身份解析成功 → 写标准行；解析不出 → 进 unmapped 并有 reason', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = dualWriteObservationBatch(database, batch([
      draft('US.CPI.NSA.YOY'),
      { marketFactKey: JSON.stringify(['narwhal', 'd', 'zh', ['001530fb-87a1-4aa3-8be0-30eeaf9344b1', 1]]) }
    ]))
    expect(counts.written).toBe(1)
    expect(counts.unmapped['bad-identity']).toBe(1)
    expect(counts.failed).toBe(0)
    expect((database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c).toBe(1)
    expect((database.prepare('select count(*) c from mi_calendar_unmapped').get() as { c: number }).c).toBe(1)
  })

  it('写标准表失败 → 只计数 + 记日志，不抛（采集不被拖停）', () => {
    const database = new DatabaseSync(':memory:')
    // 故意不建表：写入必然抛错。
    const onError = vi.fn()
    const counts = dualWriteObservationBatch(database, batch([draft('US.CPI.NSA.YOY')]), { onError })
    expect(counts.failed).toBe(1)
    expect(counts.written).toBe(0)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it('同一个身份重放两次 → 仍是一行（覆盖不是新增）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    dualWriteObservationBatch(database, batch([draft('US.CPI.NSA.YOY')]))
    dualWriteObservationBatch(database, batch([draft('US.CPI.NSA.YOY')]))
    expect((database.prepare('select count(*) c from mi_calendar_events').get() as { c: number }).c).toBe(1)
  })
})

describe('事件型：源类型串 → evt.* 码', () => {
  const eventDraft = (displayName: string, at: string) => ({
    marketFactKey: JSON.stringify(['narwhal', 'macro-calendar-narwhal-central-bank-activities', 'zh',
      JSON.parse(narwhalSourceEventIdForIdentity({ countryCode: 'USA',
        metricKey: 'central-bank-activity', periodKey: at }))]),
    kind: 'central-bank-activity', displayName, countryCode: 'US', scheduledAt: at, scheduledDate: at.slice(0, 10)
  })

  it('已知类型串 → 落标准表，periodKey 取时刻到分钟', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = dualWriteObservationBatch(database, batch([eventDraft('Central bank speech', '2026-11-13T14:10:00.000Z')]))
    expect(counts.written).toBe(1)
    const row = database.prepare('select metric_key, period_key, time_precision from mi_calendar_events').get() as
      { metric_key: string; period_key: string; time_precision: string }
    expect(row.metric_key).toBe('evt.central-bank-speech')
    expect(row.period_key).toBe('2026-11-13T14:10')
    expect(row.time_precision).toBe('minute')
  })

  it('未知类型串 → 不猜，落 unknown-event-type', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = dualWriteObservationBatch(database, batch([eventDraft('Some new type', '2026-11-13T15:00:00.000Z')]))
    expect(counts.written).toBe(0)
    expect(counts.unmapped['unknown-event-type']).toBe(1)
  })
})


describe('源内身份不参与跨源合并', () => {
  it('同一国家/期间/发布日：源内身份行与另一个源的标准码行各成一行，谁也不吞谁', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const base = { countryCode: 'USA', periodKey: '2026-10', scheduledDate: '2026-11-18',
      scheduledAt: '2026-11-18T10:30:00.000Z', kind: 'event' as const }
    dualWriteMeasureRows(database, { providerId: 'narwhal', parserVersion: 'v1',
      observedAt: '2026-11-18T10:31:00.000Z',
      rows: [{ ...base, metricKey: 'r-local-id', sourceEventId: 'r-local-id',
        identityKind: 'source' as const, sourceLabel: 'Something new', seriesId: 'usa-nowhere' }] as never })
    dualWriteMeasureRows(database, { providerId: 'official', parserVersion: 'v1',
      observedAt: '2026-11-18T10:31:00.000Z',
      rows: [{ ...base, metricKey: 'US.ADP.SA.CHANGE', sourceEventId: 'official-1',
        identityKind: 'code' as const, status: 'published' as const }] as never })
    const rows = database.prepare('select identity_kind, metric_key from mi_calendar_events order by identity_kind')
      .all() as { identity_kind: string; metric_key: string }[]
    // 没有共同身份就不能合并：源内身份行按源内 id 独立存在，标准码行按标准码独立存在。
    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.identity_kind)).toEqual(['code', 'source'])
  })
})

describe('源内身份 → 标准码：原地转正，不新增行', () => {
  const row = (over: Record<string, unknown>) => ({
    countryCode: 'USA', metricKey: 'r-1', periodKey: '2026-10', scheduledDate: '2026-11-05',
    scheduledAt: '2026-11-05T13:30:00.000Z', sourceEventId: 'r-1', kind: 'indicator' as const,
    identityKind: 'source' as const, status: 'published' as const, ...over
  })
  const write = (database: DatabaseSync, rows: object[]) => dualWriteMeasureRows(database, {
    providerId: 'narwhal', parserVersion: 'v1', observedAt: '2026-11-05T13:31:00.000Z', rows: rows as never
  })

  it('补上映射后同一行改成标准码：一行，不是两行', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, [row({})])
    write(database, [row({ metricKey: 'US.ADP.SA.CHANGE', identityKind: 'code' as const })])
    const rows = database.prepare('select metric_key, identity_kind from mi_calendar_events').all() as
      { metric_key: string; identity_kind: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.metric_key).toBe('US.ADP.SA.CHANGE')
    expect(rows[0]!.identity_kind).toBe('code')
  })

  it('源内身份的行照常写进表（不被当成未知码退回工作清单），并带上源原文名', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const counts = write(database, [row({ kind: 'event' as const, sourceLabel: 'Securities transactions' })])
    expect(counts.written).toBe(1)
    expect(counts.unmapped['unknown-measure']).toBe(0)
    const stored = database.prepare(`select metric_key, identity_kind, source_label from mi_calendar_events`)
      .get() as { metric_key: string; identity_kind: string; source_label: string }
    // 没有名字列的话，日历只能拿一个 uuid 当标题——源原文名必须随行存。
    expect(stored.source_label).toBe('Securities transactions')
    expect(stored.identity_kind).toBe('source')
  })

  it('闭集是硬的：闭集外的状态写不进表（fail-closed，不靠调用方自觉）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    write(database, [row({ status: 'published' as const })])
    const counts = write(database, [row({ metricKey: 'r-2', sourceEventId: 'r-2', scheduledDate: '2026-11-06',
      status: 'weird' as never })])
    // 认不出就不许入库：归一成 unknown 是**构造器**的活，写入端只挡，不猜。
    expect(counts.failed).toBe(1)
    const rows = database.prepare('select status from mi_calendar_events').all() as { status: string }[]
    expect(rows.map((entry) => entry.status)).toEqual(['published'])
  })
})

describe('同身份同日两份发布（夹具，不靠真实数据）', () => {
  it('一份带值一份空：合并后行有值、映射表留两个 id、计数为 1', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const common = { countryCode: 'USA', metricKey: 'US.NONFARM.SA.CHANGE', periodKey: '2026-10',
      scheduledDate: '2026-11-06', scheduledAt: '2026-11-06T13:30:00.000Z', kind: 'indicator' as const,
      identityKind: 'code' as const, status: 'published' as const }
    const write = (rows: object[]) => dualWriteMeasureRows(database, { providerId: 'narwhal',
      parserVersion: 'v1', observedAt: '2026-11-06T13:31:00.000Z', rows: rows as never })
    write([{ ...common, sourceEventId: 'empty-shell', actual: undefined }])
    const counts = write([{ ...common, sourceEventId: 'with-values', actual: '165', previous: '60' }])
    const row = database.prepare(`select values_json, value_state from mi_calendar_events
      where metric_key = 'US.NONFARM.SA.CHANGE' and period_key = '2026-10'`).get() as
      { values_json: string; value_state: string }
    const ids = database.prepare('select source_event_id from mi_calendar_event_source_ids order by source_event_id')
      .all() as { source_event_id: string }[]
    expect(JSON.parse(row.values_json).actual).toBe('165')   // 空值不覆盖有值
    expect(row.value_state).toBe('present')
    expect(ids.map((entry) => entry.source_event_id)).toEqual(['empty-shell', 'with-values'])
    expect(counts.mergedSameDay).toBe(1)
  })
})
