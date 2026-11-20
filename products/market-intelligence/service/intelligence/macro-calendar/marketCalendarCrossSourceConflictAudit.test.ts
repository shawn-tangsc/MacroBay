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
  /** 数值列（N3）：冲突判定按数值比，展示串只作证据。`numericJson` 省略＝这一行没有数值（旧行）。 */
  const numeric = (value: number, decimals = 1, unit = 'percent') => JSON.stringify({
    v: 1, state: 'available', unit, values: { actual: value }, decimals: { actual: decimals },
    parserVersion: 'calendar-numeric-v1'
  })
  const seed = (database: DatabaseSync, providerId: string, firstScheduledDate: string, actual: string,
    numericJson?: string) => {
    upsertCalendarStandardRow(database, {
      countryCode: 'USA', metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodKey: '2026-09',
      scheduledDate: '2026-10-03', firstScheduledDate, timePrecision: 'date',
      valuesJson: JSON.stringify({ actual }), valueState: 'present',
      sourceProviderId: providerId, sourceEventId: `${providerId}-${firstScheduledDate}`,
      parserVersion: 'v1', observedAt: '2026-10-03T12:31:00.000Z', firstSeenAt: '2026-10-03T12:31:00.000Z',
      ...(numericJson === undefined ? {} : { numericJson })
    })
  }

  it('两家两条行、actual 不同 → 记一对冲突；再扫一次不翻倍', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    ensureCalendarValueRevisionTable(database)
    seed(database, 'narwhal', '2026-10-03', '4.1', numeric(4.1))
    seed(database, '0xrouter', '2026-10-04', '4.2', numeric(4.2))
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 1, recorded: 2, incomparable: 0, sameValueDifferentText: 0, displayCompared: 0 })
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 1, recorded: 0, incomparable: 0, sameValueDifferentText: 0, displayCompared: 0 })
    expect(listCrossSourceConflicts(database)).toHaveLength(1)
  })

  it('同源两条行、actual 不同 → 不是跨源冲突，一条都不记', () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    ensureCalendarValueRevisionTable(database)
    seed(database, 'narwhal', '2026-10-03', '4.1', numeric(4.1))
    seed(database, 'narwhal', '2026-10-09', '4.2', numeric(4.2))
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 0, recorded: 0, incomparable: 0, sameValueDifferentText: 0, displayCompared: 0 })
    expect(listCrossSourceConflicts(database)).toEqual([])
  })
})

/**
 * N3 接进冲突审计（Chief 2026-11-21 拍板）：**相等性看数值列，展示串留作证据**。
 *
 * 三条要求逐条钉住：
 * ① 冲突记录里两个原始展示串都在（`value_before` 就是展示串）；
 * ② 任一边不是 `available`（未记录/缺/解析不了）→ **不算冲突**，单独计数，别混进「冲突 0 条」；
 * ③ 同值不同写法（`4.1` vs `4.10`）以前被记成冲突，那是**假阳性**——条数会变少，不是口径松动。
 */
describe('冲突相等性按数值列判（N3 接入）', () => {
  const numeric = (value: number, decimals = 1, unit = 'percent') => JSON.stringify({
    v: 1, state: 'available', unit, values: { actual: value }, decimals: { actual: decimals },
    parserVersion: 'calendar-numeric-v1'
  })
  const seed = (database: DatabaseSync, providerId: string, firstScheduledDate: string, actual: string,
    numericJson?: string) => {
    upsertCalendarStandardRow(database, {
      countryCode: 'USA', metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodKey: '2026-09',
      scheduledDate: '2026-10-03', firstScheduledDate, timePrecision: 'date',
      valuesJson: JSON.stringify({ actual }), valueState: 'present',
      sourceProviderId: providerId, sourceEventId: `${providerId}-${firstScheduledDate}`,
      parserVersion: 'v1', observedAt: '2026-10-03T12:31:00.000Z', firstSeenAt: '2026-10-03T12:31:00.000Z',
      ...(numericJson === undefined ? {} : { numericJson })
    })
  }
  const open = () => {
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    ensureCalendarValueRevisionTable(database)
    return database
  }

  it('4.1 与 4.10 是同一个数：不记冲突，计入「同值不同写法」', () => {
    const database = open()
    seed(database, 'narwhal', '2026-10-03', '4.1', numeric(4.1, 1))
    seed(database, '0xrouter', '2026-10-04', '4.10', numeric(4.1, 2))
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 0, recorded: 0, incomparable: 0, sameValueDifferentText: 1, displayCompared: 0 })
    expect(listCrossSourceConflicts(database)).toEqual([])
    // 再扫一次：幂等，不因为「没记」而反复计数（计数是这一轮的事实，不是累积值）。
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 0, recorded: 0, incomparable: 0, sameValueDifferentText: 1, displayCompared: 0 })
  })

  it('真不同（4.1 vs 4.2）照旧记冲突，记录的 value_before 就是两个原始展示串', () => {
    const database = open()
    seed(database, 'narwhal', '2026-10-03', '4.1', numeric(4.1))
    seed(database, '0xrouter', '2026-10-04', '4.2', numeric(4.2))
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 1, recorded: 2, incomparable: 0, sameValueDifferentText: 0, displayCompared: 0 })
    expect(listCrossSourceConflicts(database).map((conflict) => conflict.basis)).toEqual(['numeric'])
    const recorded = database.prepare(`select provider_id, value_before from mi_calendar_value_revisions
      where decision = 'conflict:cross-source' order by provider_id`).all() as
      Array<{ provider_id: string; value_before: string }>
    expect(recorded).toEqual([
      { provider_id: '0xrouter', value_before: '4.2' },
      { provider_id: 'narwhal', value_before: '4.1' }
    ])
  })

  it('一边没有数值列（旧行）→ 按展示串原样比，记冲突并标注「按展示串·未经数值校验」', () => {
    const database = open()
    seed(database, 'narwhal', '2026-10-03', '4.1')   // numeric_json 缺 → unparsed
    seed(database, '0xrouter', '2026-10-04', '4.2', numeric(4.2))
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 1, recorded: 2, incomparable: 0, sameValueDifferentText: 0, displayCompared: 1 })
    const rows = database.prepare(`select provider_id, parser_version from mi_calendar_value_revisions
      where decision = 'conflict:cross-source' order by provider_id`).all() as
      Array<{ provider_id: string; parser_version: string }>
    // 标注落在记录的出处里：这两个值是**按展示串**判出来的，没经过数值校验。
    expect(rows).toEqual([
      { provider_id: '0xrouter', parser_version: 'cross-source-conflict-v2-display-unverified' },
      { provider_id: 'narwhal', parser_version: 'cross-source-conflict-v2-display-unverified' }
    ])
    expect(listCrossSourceConflicts(database).map((conflict) => conflict.basis)).toEqual(['display-unverified'])
  })

  it('单位不同 → 数值不可比，退回展示串比较并标注（不拿「都推不出」当同单位）', () => {
    const database = open()
    seed(database, 'narwhal', '2026-10-03', '4.1', numeric(4.1, 1, 'percent'))
    seed(database, '0xrouter', '2026-10-04', '4.2', numeric(4.2, 1, 'thousands'))
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 1, recorded: 2, incomparable: 0, sameValueDifferentText: 0, displayCompared: 1 })
    expect(listCrossSourceConflicts(database)[0]?.basis).toBe('display-unverified')
  })

  it('一边这一格根本没值 → 不比、不记，进「不可比」计数（不是「两家一致」）', () => {
    const database = open()
    seed(database, 'narwhal', '2026-10-03', '4.1', numeric(4.1))
    // 另一家这一期有行、但 actual 没给（空串＝没给，`recordCrossSourceConflict` 的老规矩）。
    upsertCalendarStandardRow(database, {
      countryCode: 'USA', metricKey: 'US.UNEMPLOYMENT.SA.RATE', periodKey: '2026-09',
      scheduledDate: '2026-10-03', firstScheduledDate: '2026-10-04', timePrecision: 'date',
      valuesJson: JSON.stringify({}), valueState: 'missing',
      sourceProviderId: '0xrouter', sourceEventId: 'x-2026-10-04',
      parserVersion: 'v1', observedAt: '2026-10-03T12:31:00.000Z', firstSeenAt: '2026-10-03T12:31:00.000Z'
    })
    expect(markCrossSourceConflicts(database))
      .toEqual({ groups: 0, recorded: 0, incomparable: 1, sameValueDifferentText: 0, displayCompared: 0 })
    expect(listCrossSourceConflicts(database)).toEqual([])
  })

  it('三家两条行：数值相同的两条合成一侧，记录里仍带各自的展示串', () => {
    const database = open()
    seed(database, 'narwhal', '2026-10-03', '4.1', numeric(4.1))
    seed(database, 'macro-calendar-bls', '2026-10-03', '4.10', numeric(4.1, 2))
    seed(database, '0xrouter', '2026-10-04', '4.2', numeric(4.2))
    const result = markCrossSourceConflicts(database)
    expect(result).toEqual({ groups: 1, recorded: 2, incomparable: 0, sameValueDifferentText: 0, displayCompared: 0 })
    const recorded = database.prepare(`select provider_id, value_before, conflict_with_provider_id
      from mi_calendar_value_revisions where decision = 'conflict:cross-source' order by provider_id`).all() as
      Array<{ provider_id: string; value_before: string; conflict_with_provider_id: string }>
    // 代表取该数值里最新的一条（bls 那条 4.10 与 narwhal 4.1 同一侧），对面一定是另一个数值。
    expect(recorded).toEqual([
      { provider_id: '0xrouter', value_before: '4.2', conflict_with_provider_id: 'macro-calendar-bls' },
      { provider_id: 'macro-calendar-bls', value_before: '4.10', conflict_with_provider_id: '0xrouter' }
    ])
  })
})
