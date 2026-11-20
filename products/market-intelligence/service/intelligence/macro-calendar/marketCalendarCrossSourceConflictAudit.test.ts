import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { ensureCalendarValueRevisionTable, readCalendarValueRevisions } from './marketCalendarValueRevisionAudit'
import {
  crossSourceConflictCounts, listCrossSourceConflicts, markCrossSourceConflicts, recordCrossSourceConflict
} from './marketCalendarCrossSourceConflictAudit'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

const KEY = { countryCode: 'USA', metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodKey: '2026-09' }

const side = (over: Partial<Parameters<typeof recordCrossSourceConflict>[1]['sides'][number]> = {}) => ({
  providerId: 'narwhal', sourceEventId: 'n-1', firstScheduledDate: '2026-10-03',
  field: 'actual' as const, value: '4.1', observedAt: '2026-10-03T12:31:00.000Z', ...over
})

describe('跨源数值冲突：两条互指、同源不互指、待判清单只出现一次', () => {
  it('两条互指：各写一行冲突记录，指向对方来源与源内 id', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarValueRevisionTable(database)
    const written = recordCrossSourceConflict(database, { ...KEY, sides: [
      side(),
      side({ providerId: '0xrouter', sourceEventId: 'x-1', firstScheduledDate: '2026-10-04',
        value: '4.2', observedAt: '2026-10-04T12:31:00.000Z' })
    ] })
    expect(written).toBe(2)
    const rows = database.prepare(`select provider_id, source_event_id, value_before, value_after, decision,
      conflict_with_provider_id, conflict_with_source_event_id
      from mi_calendar_value_revisions order by provider_id`).all() as Array<Record<string, string | null>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ provider_id: '0xrouter', source_event_id: 'x-1', value_before: '4.2',
      decision: 'conflict:cross-source', conflict_with_provider_id: 'narwhal',
      conflict_with_source_event_id: 'n-1', value_after: null })
    expect(rows[1]).toMatchObject({ provider_id: 'narwhal', source_event_id: 'n-1', value_before: '4.1',
      decision: 'conflict:cross-source', conflict_with_provider_id: '0xrouter',
      conflict_with_source_event_id: 'x-1' })
  })

  it('同源两行不互指：同一家给出两个不同数，不当跨源冲突记', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarValueRevisionTable(database)
    const written = recordCrossSourceConflict(database, { ...KEY, sides: [
      side({ sourceEventId: 'n-1', firstScheduledDate: '2026-10-03' }),
      side({ sourceEventId: 'n-2', firstScheduledDate: '2026-10-09', value: '4.2',
        observedAt: '2026-10-09T12:31:00.000Z' })
    ] })
    expect(written).toBe(0)
    expect(crossSourceConflictCounts(database)).toEqual([])
  })

  it('值相同不算冲突（两家报同一个数）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarValueRevisionTable(database)
    expect(recordCrossSourceConflict(database, { ...KEY, sides: [
      side(), side({ providerId: '0xrouter', sourceEventId: 'x-1', value: '4.1' })
    ] })).toBe(0)
  })

  it('待判清单只出现一次：两条互指的记录折成一条，两侧的值都在', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarValueRevisionTable(database)
    recordCrossSourceConflict(database, { ...KEY, sides: [
      side(), side({ providerId: '0xrouter', sourceEventId: 'x-1', value: '4.2',
        observedAt: '2026-10-04T12:31:00.000Z' })
    ] })
    const pending = listCrossSourceConflicts(database)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ ...KEY, field: 'actual' })
    expect(pending[0]!.sides.map((item) => [item.providerId, item.value]).sort())
      .toEqual([['0xrouter', '4.2'], ['narwhal', '4.1']])
  })

  it('重复记同一对冲突是幂等的（不翻倍）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarValueRevisionTable(database)
    const input = { ...KEY, sides: [
      side(), side({ providerId: '0xrouter', sourceEventId: 'x-1', value: '4.2',
        observedAt: '2026-10-04T12:31:00.000Z' })
    ] }
    recordCrossSourceConflict(database, input)
    recordCrossSourceConflict(database, input)
    const count = (database.prepare('select count(*) n from mi_calendar_value_revisions').get() as { n: number }).n
    expect(Number(count)).toBe(2)
    expect(listCrossSourceConflicts(database)).toHaveLength(1)
  })

  it('来源可靠性是派生计数：按「参与过几对冲突」算，不按记录条数，也不另存一列', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarValueRevisionTable(database)
    recordCrossSourceConflict(database, { ...KEY, sides: [
      side(), side({ providerId: '0xrouter', sourceEventId: 'x-1', value: '4.2',
        observedAt: '2026-10-04T12:31:00.000Z' })
    ] })
    recordCrossSourceConflict(database, { countryCode: 'USA', metricKey: 'US.CPI.NSA.YOY', periodKey: '2026-09',
      sides: [side({ providerId: 'macro-calendar-bls' }),
        side({ providerId: '0xrouter', sourceEventId: 'x-2', value: '3.7', observedAt: '2026-10-04T12:31:00.000Z' })].map((item) =>
        ({ ...item, field: 'actual' as const })) })
    expect(crossSourceConflictCounts(database)).toEqual([
      { providerId: '0xrouter', conflicts: 2 },
      { providerId: 'macro-calendar-bls', conflicts: 1 },
      { providerId: 'narwhal', conflicts: 1 }
    ])
    // 「只存派生计数」：表上没有可靠性列可写；数只从 revision 表算出来。
    const columns = database.prepare("select name from pragma_table_info('mi_calendar_value_revisions')").all() as
      { name: string }[]
    expect(columns.map((column) => column.name)).not.toContain('reliability')
  })

  it('冲突记录不混进「数值修订」读口（那里只认真正的改值与拒绝覆盖）', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarValueRevisionTable(database)
    recordCrossSourceConflict(database, { ...KEY, sides: [
      side(), side({ providerId: '0xrouter', sourceEventId: 'x-1', value: '4.2',
        observedAt: '2026-10-04T12:31:00.000Z' })
    ] })
    const read = readCalendarValueRevisions(database, { ...KEY, firstScheduledDate: '2026-10-03' })
    expect(read.state).toBe('not-recorded')
  })
})

describe('扫描标准表里的真实冲突形状', () => {
  const seed = (database: DatabaseSync, providerId: string, firstScheduledDate: string, actual: string) => {
    upsertCalendarStandardRow(database, {
      countryCode: 'USA', metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodKey: '2026-09',
      scheduledDate: '2026-10-03', firstScheduledDate, timePrecision: 'date',
      valuesJson: JSON.stringify({ actual }), valueState: 'present',
      sourceProviderId: providerId, sourceEventId: `${providerId}-${firstScheduledDate}`,
      parserVersion: 'v1', observedAt: '2026-10-03T12:31:00.000Z', firstSeenAt: '2026-10-03T12:31:00.000Z'
    })
  }

  it('两家两条行、actual 不同 → 记一对冲突；再扫一次不翻倍', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    ensureCalendarValueRevisionTable(database)
    seed(database, 'narwhal', '2026-10-03', '4.1')
    seed(database, '0xrouter', '2026-10-04', '4.2')
    expect(markCrossSourceConflicts(database)).toEqual({ groups: 1, recorded: 2 })
    expect(markCrossSourceConflicts(database)).toEqual({ groups: 1, recorded: 0 })
    expect(listCrossSourceConflicts(database)).toHaveLength(1)
  })

  it('同源两条行、actual 不同 → 不是跨源冲突，一条都不记', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    ensureCalendarValueRevisionTable(database)
    seed(database, 'narwhal', '2026-10-03', '4.1')
    seed(database, 'narwhal', '2026-10-09', '4.2')
    expect(markCrossSourceConflicts(database)).toEqual({ groups: 0, recorded: 0 })
    expect(listCrossSourceConflicts(database)).toEqual([])
  })
})