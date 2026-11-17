import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  calendarStandardTablePolicy, ensureCalendarStandardTables, recordCalendarSourceId, upsertCalendarStandardRow,
  type CalendarStandardRow
} from './marketCalendarStandardTable'
import {
  auditSourceIdMismatches, logSourceIdOverwriteSummary, sourceIdOnWrite, sourceIdOverwritePayload
} from './marketCalendarSourceIdAudit'

const tables = {
  eventsTable: calendarStandardTablePolicy.eventsTable,
  sourceIdsTable: calendarStandardTablePolicy.sourceIdsTable
}

const base: CalendarStandardRow = {
  countryCode: 'USA', metricKey: 'US.CORE_PCE.SA.YOY', periodKey: '2026-10',
  scheduledDate: '2026-11-25', scheduledAt: '2026-11-25T13:30:00.000Z', timePrecision: 'minute',
  valuesJson: '{}', sourceProviderId: 'macro-calendar-official-replay',
  sourceEventId: 'US.CORE_PCE.2026-10', parserVersion: 'replay-v1',
  observedAt: '2026-11-16T00:00:00.000Z', firstSeenAt: '2026-11-16T00:00:00.000Z'
}

const record = (database: DatabaseSync, sourceEventId: string, providerId = 'macro-calendar-official-replay') =>
  recordCalendarSourceId(database, {
    providerId, sourceEventId, countryCode: base.countryCode, metricKey: base.metricKey,
    periodKey: base.periodKey, firstScheduledDate: base.scheduledDate, observedAt: base.observedAt
  })

afterEach(() => { vi.restoreAllMocks() })

describe('source-id overwrite is measured, not explained away', () => {
  it('keeps the first publication id on the row, and records the later one only in the ledger', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 一次发布先落 replay 的 id、并记进台账；随后采集用另一个 id 写同一身份（一行只能存一个 id）。
    upsertCalendarStandardRow(database, base)
    record(database, 'US.CORE_PCE.2026-10')
    upsertCalendarStandardRow(database, { ...base, sourceEventId: 'US.PCE.2026-10', sourceProviderId: 'macro-calendar-bea' })
    // 台账记每一次发布（双写路径会调它）：后到的 id 也在台账里，所以「旧 id 有留痕」成立。
    record(database, 'US.PCE.2026-10', 'macro-calendar-bea')

    // **先到的赢**（用户 2026-11-18）：行上留 replay 那个 id，后到的只在台账里留痕。
    // 台账因此比行多一个 id——这是**允许**的那种不一致（同一次发布被后写覆盖、且旧 id 有留痕），
    // 量出来是为了看得见，不是判红。
    expect(auditSourceIdMismatches(database, tables)).toEqual([{
      month: '2026-11', countryCode: 'US', metricKey: base.metricKey, firstScheduledDate: base.scheduledDate,
      ledgerSourceEventId: 'US.PCE.2026-10', rowSourceEventId: 'US.CORE_PCE.2026-10'
    }])
    const row = database.prepare(`select source_event_id as id from ${calendarStandardTablePolicy.eventsTable}
      where metric_key = ? and first_scheduled_date = ?`).get(base.metricKey, base.scheduledDate) as { id: string }
    expect(row.id).toBe('US.CORE_PCE.2026-10')
    const ledger = database.prepare(`select source_event_id as id from ${calendarStandardTablePolicy.sourceIdsTable}
      where metric_key = ? order by source_event_id`).all(base.metricKey) as { id: string }[]
    expect(ledger.map((entry) => entry.id)).toEqual(['US.CORE_PCE.2026-10', 'US.PCE.2026-10'])
  })

  it('still reports a mismatch when the row carries an id the ledger never saw', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 不记台账就写行：行上的 id 在台账里查不到，这才是「没有留痕」的真红。
    upsertCalendarStandardRow(database, base)
    expect(auditSourceIdMismatches(database, tables)).toEqual([])
    record(database, 'SOMETHING-ELSE')
    const [mismatch] = auditSourceIdMismatches(database, tables)
    // 台账记了一个行上没写的 id → 行与台账不一致（这一条是「台账有、行上写着别的」，不是丢行）。
    expect(mismatch).toMatchObject({ ledgerSourceEventId: 'SOMETHING-ELSE', rowSourceEventId: base.sourceEventId })
  })

  it('distinguishes a real loss: ledger has the publication, no row carries it', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    record(database, 'US.MISSING.2026-10')

    const [mismatch] = auditSourceIdMismatches(database, tables)
    expect(mismatch).toMatchObject({ ledgerSourceEventId: 'US.MISSING.2026-10', rowSourceEventId: null })
  })

  it('flags an overwrite whose old id left no trace, in the per-round summary', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, { ...base, sourceEventId: 'untraced-old' })
    // 台账里没有 'untraced-old'：覆盖发生了，但没有任何留痕。
    const probe = sourceIdOnWrite(database, tables, {
      countryCode: base.countryCode, metricKey: base.metricKey, periodKey: base.periodKey,
      firstScheduledDate: base.scheduledDate, sourceEventId: 'new-id'
    })
    expect(probe).toEqual({ previousSourceEventId: 'untraced-old', tracedInLedger: false })

    // **一行汇总，不是一行一条**：真红（untraced）在 summary 里数得出来。
    logSourceIdOverwriteSummary([
      sourceIdOverwritePayload({ metricKey: base.metricKey, firstScheduledDate: base.scheduledDate, sourceEventId: 'new-id' }, probe!)
    ])
    expect(warn).toHaveBeenCalledTimes(1)
    const line = String(warn.mock.calls[0]?.[0])
    expect(line).toContain('MI_CALENDAR_SOURCE_ID_OVERWRITTEN_SUMMARY')
    expect(line).toContain('"overwrites":1')
    expect(line).toContain('"untraced":1')
  })

  it('stays silent when the identity keeps the same id, and when the row is new', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, base)
    upsertCalendarStandardRow(database, { ...base, observedAt: '2026-11-16T01:00:00.000Z' })

    expect(auditSourceIdMismatches(database, tables)).toEqual([])
    expect(warn).not.toHaveBeenCalled()
  })
})

/**
 * **同一身份的两条 locale 行：发布 id 取「先到的赢」**（用户 2026-11-18 报的 1190 条/轮成对告警）。
 *
 * 现况：源对同一次发布发中英两条（数组身份第一段相同 —— `["214438",78387]` 与 `["214438",78345]`），
 * 两条落到同一行，后写的那条每轮把 `source_event_id` 改回自己 → 同一对 id 来回翻、启动日志成对刷屏。
 *
 * 判据：连写两轮 → 行上的 id 第一轮之后不再变化；**第二轮一条「真的改了 id」都不该有**。
 * 反向（改回 last-write-wins）→ 第二轮必变，这条会红。
 */
describe('发布 id：先到的赢，不来回翻', () => {
  const zh = { ...base, sourceEventId: '["214438",78387]', sourceProviderId: '0xrouter' }
  const en = { ...base, sourceEventId: '["214438",78345]', sourceProviderId: '0xrouter' }
  const rowId = (database: DatabaseSync): string =>
    (database.prepare(`select source_event_id as id from ${calendarStandardTablePolicy.eventsTable}
      where metric_key = ? and first_scheduled_date = ?`).get(base.metricKey, base.scheduledDate) as { id: string }).id

  it('keeps the first id on both rounds and reports no overwrite', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 台账记下每一次发布（设计如此）：两个 id 都在，所以「旧 id 有留痕」成立。
    record(database, zh.sourceEventId, '0xrouter')
    record(database, en.sourceEventId, '0xrouter')

    const first = [upsertCalendarStandardRow(database, zh), upsertCalendarStandardRow(database, en)]
    expect(rowId(database)).toBe(zh.sourceEventId)
    // 第一轮里 en 那一笔被「先到的赢」挡下，不算真的改 id。
    expect(first.filter((entry) => entry.sourceIdOverwrite !== undefined)).toHaveLength(0)

    const valuesOf = (): string => (database.prepare(`select values_json as v from ${calendarStandardTablePolicy.eventsTable}
      where metric_key = ? and first_scheduled_date = ?`).get(base.metricKey, base.scheduledDate) as { v: string }).v
    const valuesAfterFirst = valuesOf()
    const second = [upsertCalendarStandardRow(database, zh), upsertCalendarStandardRow(database, en)]
    expect(rowId(database), '第二轮不许再翻').toBe(zh.sourceEventId)
    expect(second.filter((entry) => entry.sourceIdOverwrite !== undefined)).toHaveLength(0)
    // **读者可见的数据一个字节不许变**：这一笔只动 `source_event_id` 这一列，值区原样。
    expect(valuesOf()).toBe(valuesAfterFirst)
  })

  it('still records the overwrite when the old id left no trace (that one is real red)', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, { ...zh, sourceEventId: 'untraced-old' })
    // 台账里没有 untraced-old：这不是「同一发布的两个写法」，是真覆盖 → 照旧写新的并记一笔。
    const placed = upsertCalendarStandardRow(database, en)
    expect(placed.sourceIdOverwrite).toMatchObject({ previousSourceEventId: 'untraced-old', tracedInLedger: false })
    expect(rowId(database)).toBe(en.sourceEventId)
  })
})
