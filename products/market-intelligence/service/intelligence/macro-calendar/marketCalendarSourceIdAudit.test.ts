import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  calendarStandardTablePolicy, ensureCalendarStandardTables, recordCalendarSourceId, upsertCalendarStandardRow,
  type CalendarStandardRow
} from './marketCalendarStandardTable'
import { auditSourceIdMismatches, sourceIdOverwriteOnWrite } from './marketCalendarSourceIdAudit'

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
  it('reports the row-vs-ledger mismatch with the month and both ids', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    // 一次发布先落 replay 的 id、并记进台账；随后采集用另一个 id 写同一身份（一行只能存一个 id）。
    upsertCalendarStandardRow(database, base)
    record(database, 'US.CORE_PCE.2026-10')
    upsertCalendarStandardRow(database, { ...base, sourceEventId: 'US.PCE.2026-10', sourceProviderId: 'macro-calendar-bea' })

    expect(auditSourceIdMismatches(database, tables)).toEqual([{
      month: '2026-11',
      // 写入端已把国家码归一到 alpha-2（2026-11-16），行里读出来就是 `US`。
      countryCode: 'US',
      metricKey: 'US.CORE_PCE.SA.YOY',
      firstScheduledDate: '2026-11-25',
      ledgerSourceEventId: 'US.CORE_PCE.2026-10',
      rowSourceEventId: 'US.PCE.2026-10'
    }])
  })

  it('distinguishes a real loss: ledger has the publication, no row carries it', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    record(database, 'US.MISSING.2026-10')

    const [mismatch] = auditSourceIdMismatches(database, tables)
    expect(mismatch).toMatchObject({ ledgerSourceEventId: 'US.MISSING.2026-10', rowSourceEventId: null })
  })

  it('flags an overwrite whose old id left no trace', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    upsertCalendarStandardRow(database, { ...base, sourceEventId: 'untraced-old' })
    // 台账里没有 'untraced-old'：覆盖发生了，但没有任何留痕。
    const result = sourceIdOverwriteOnWrite(database, tables, {
      countryCode: base.countryCode, metricKey: base.metricKey, periodKey: base.periodKey,
      firstScheduledDate: base.scheduledDate, sourceEventId: 'new-id'
    })

    expect(result).toMatchObject({ previousSourceEventId: 'untraced-old', nextSourceEventId: 'new-id', tracedInLedger: false })
    expect(String(warn.mock.calls[0]?.[0])).toContain('MI_CALENDAR_SOURCE_ID_OVERWRITTEN_UNTRACED')
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
