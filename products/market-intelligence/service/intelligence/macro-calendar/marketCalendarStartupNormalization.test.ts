import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { normalizeCalendarStandardRows } from './marketCalendarStartupNormalization'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * 启动链幂等规范化（用户 2026-11-19 批）：重算 `value_state` → 桶一 → 期次解析 → 桶二。
 *
 * 用例按六条约束写：只做三类动作、删改都进审计、第二遍 0 变更、三类行不许误伤
 * （有 actual 的行 / 事件行 / 期次解不出的行）。
 */
const now = '2026-11-19T03:20:00.000Z'
const nowIso = '2026-11-19T03:20:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  return database
}

type Seed = Readonly<{
  countryCode?: string
  metricKey: string
  periodKey: string
  firstScheduledDate: string
  valuesJson?: string
  valueState?: string
  status?: string
  eventType?: string
  identityKind?: 'code' | 'source'
  providerId?: string
  sourceEventId?: string
}>

let seq = 0
function seed(database: DatabaseSync, over: Seed): void {
  seq += 1
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision,
     status, identity_kind, value_state, values_json, source_provider_id, source_event_id,
     parser_version, observed_at, first_seen_at, event_type, release_count)
    values (?, ?, ?, ?, ?, 'date', ?, ?, ?, ?, ?, ?, 'v1', ?, ?, ?, 1)`)
    .run(over.countryCode ?? 'US', over.metricKey, over.periodKey, over.firstScheduledDate,
      over.firstScheduledDate, over.status ?? 'published', over.identityKind ?? 'code',
      over.valueState ?? 'missing', over.valuesJson ?? '{}', over.providerId ?? 'test',
      over.sourceEventId ?? `x-${seq}`, now, now, over.eventType ?? null)
}

const run = (database: DatabaseSync) => normalizeCalendarStandardRows(database, { nowIso })
const rows = (database: DatabaseSync) =>
  database.prepare('select rowid, * from mi_calendar_events order by rowid').all() as Array<Record<string, unknown>>

describe('启动链幂等规范化', () => {
  it('虚标 present（只有前值）→ 重算成 missing；真正的 actual 一行不动', () => {
    const database = setup()
    seed(database, { metricKey: 'US.A.NONE.LEVEL', periodKey: '2026-10', firstScheduledDate: '2026-11-01',
      valuesJson: '{"previous":"1.0"}', valueState: 'present' })
    seed(database, { metricKey: 'US.B.NONE.LEVEL', periodKey: '2026-10', firstScheduledDate: '2026-11-01',
      valuesJson: '{"actual":"0%"}', valueState: 'present' })
    const report = run(database)
    expect(report.valueStateToMissing).toBe(1)
    const after = rows(database)
    const flagged = after.find((row) => row.metric_key === 'US.A.NONE.LEVEL')!
    expect(flagged.value_state).toBe('missing')
    const real = after.find((row) => row.metric_key === 'US.B.NONE.LEVEL')!
    // `0%` 是真值：状态与数值都不许被动。
    expect(real.value_state).toBe('present')
    expect(real.values_json).toBe('{"actual":"0%"}')
    expect(run(database)).toMatchObject({ valueStateToMissing: 0, periodsResolved: 0, droppedRows: 0 })
  })

  it('事件行的 unknown 期次按活动日期解；行还在、不被并', () => {
    const database = setup()
    seed(database, { metricKey: '["45051",79090]', periodKey: 'unknown:["45051",79090]',
      firstScheduledDate: '2026-11-17', eventType: 'central-bank-activity', identityKind: 'source' })
    const report = run(database)
    expect(report.periodsResolved).toBe(1)
    const after = rows(database)
    expect(after).toHaveLength(1)
    expect(after[0]!.period_key).toBe('2026-11-17')
  })

  /**
   * **同一期、不同首发布日 → 两条不同的发布，都留**（Chief 2026-11-24 改契约）。
   *
   * 旧桶二按（国家+码+期次）合并、忽略首发布日：CA 经济信心 2026-09 源上发了三条
   * （10-05 50.5 / 10-13 51.3 / 10-19 51.7），启动后只剩最后一条，前两条的值只留在审计表里——
   * 那不是 churn 的小账，是**丢值**。主键含 `first_scheduled_date` 本来就是「排期不同＝两行」。
   */
  it('同一期、三条不同排期（各带不同值）→ 三行都在、三个值都在，一条都不删', () => {
    const database = setup()
    const one = (firstScheduledDate: string, actual: string) => seed(database, {
      metricKey: 'CA.ECONOMIC_CONFIDENCE.NONE.LEVEL', periodKey: '2026-09', firstScheduledDate,
      valuesJson: JSON.stringify({ actual }), valueState: 'present', providerId: '0xrouter' })
    one('2026-10-05', '50.50')
    one('2026-10-13', '51.30')
    one('2026-10-19', '51.70')
    const report = run(database)
    const after = rows(database)
    expect(after).toHaveLength(3)
    expect(after.map((row) => JSON.parse(String(row.values_json)).actual).sort())
      .toEqual(['50.50', '51.30', '51.70'])
    expect(report.droppedRows).toBe(0)
    // 审计表不许有删行记录：这三条不是重复。
    expect((database.prepare('select count(*) c from mi_calendar_events__merge_audit_v1').get() as { c: number }).c).toBe(0)
    // 幂等：第二遍 0 变更。
    expect(run(database)).toMatchObject({ droppedRows: 0, periodsResolved: 0 })
    expect(rows(database)).toHaveLength(3)
  })

  /**
   * 跨源冲突不许被「并成一行」抹掉（Chief 2026-11-21，0.4.5 #18）：
   * 两家对同一期给出不同的数，合并会挑一个留下、另一个消失——那正是「谁也说不清哪来的」。
   * 同源的两行仍按老规则合并（二读/三读是同一家的一次修订）。
   */
  it('两家两条行、actual 不同 → 两行都留（值不同，任何一侧都不许被抹掉）', () => {
    const database = setup()
    seed(database, { metricKey: 'US.E.NONE.RATE', periodKey: '2026-09', firstScheduledDate: '2026-10-03',
      valuesJson: '{"actual":"4.1"}', valueState: 'present', providerId: 'narwhal' })
    seed(database, { metricKey: 'US.E.NONE.RATE', periodKey: '2026-09', firstScheduledDate: '2026-10-04',
      valuesJson: '{"actual":"4.2"}', valueState: 'present', providerId: '0xrouter' })
    const report = run(database)
    expect(report.droppedRows).toBe(0)
    const after = rows(database)
    expect(after).toHaveLength(2)
    expect(after.map((row) => row.source_provider_id).sort()).toEqual(['0xrouter', 'narwhal'])
    // 第二遍仍保留两行：这是持久语义，不是「第一次不并、第二次并」。
    expect(run(database)).toMatchObject({ droppedRows: 0 })
    expect(rows(database)).toHaveLength(2)
  })

  it('期次解不出的行原样保留（不删、不改期次），第二遍 0 变更', () => {
    const database = setup()
    seed(database, { metricKey: '["999999",1]', periodKey: 'unknown:["999999",1]',
      firstScheduledDate: '2026-11-10', identityKind: 'source' })
    const report = run(database)
    expect(report.unresolvedPeriods).toBe(1)
    expect(report.droppedRows).toBe(0)
    const after = rows(database)
    expect(after).toHaveLength(1)
    expect(after[0]!.period_key).toBe('unknown:["999999",1]')
    expect(run(database)).toMatchObject({
      valueStateToPresent: 0, valueStateToMissing: 0, periodsResolved: 0,
      mergedRows: 0, droppedRows: 0, unresolvedPeriods: 1
    })
  })

  it('桶一：有正常期次行的 unknown 重复 → 先并值后删，正常行不动其已有值', () => {
    const database = setup()
    seed(database, { metricKey: 'US.D.NONE.LEVEL', periodKey: '2026-10', firstScheduledDate: '2026-11-05',
      valuesJson: '{"previous":"4.6%"}' })
    seed(database, { metricKey: 'US.D.NONE.LEVEL', periodKey: 'unknown:US~US.D.NONE.LEVEL~2026-11-05',
      firstScheduledDate: '2026-11-05', valuesJson: '{"previous":"9.9%","actual":"4.85%"}' })
    const report = run(database)
    expect(report.droppedRows).toBe(1)
    const after = rows(database)
    expect(after).toHaveLength(1)
    // 保留行原来有 previous，不许被覆盖；actual 是保留行没有的，必须补上。
    expect(after[0]!.values_json).toBe('{"previous":"4.6%","actual":"4.85%"}')
    expect(after[0]!.value_state).toBe('present')
    const rule = (database.prepare('select rule from mi_calendar_events__merge_audit_v1').get() as { rule: string }).rule
    expect(rule).toBe('merged-value-then-delete')
  })
})

describe('期次解析带发布窗口（PRD R38 §3.1 v4）', () => {
  it('当月型序列下月头 7 天发布的终值：规范化也解成上一期，不是发布月', () => {
    const database = setup()
    // 该序列的历史发布日（15/16/17 日）→ 窗口 15..17；12-01 越窗且在头 7 天。
    database.exec(`create table mi_macro_calendar_market_event_observations (
      observation_id text primary key, provider_id text not null, source_event_id text not null,
      indicator_id text, display_name text, scheduled_date text not null, last_seen_at text not null)`)
    const observe = (id: string, date: string) => database.prepare(`insert into
      mi_macro_calendar_market_event_observations
      (observation_id, provider_id, source_event_id, indicator_id, display_name, scheduled_date, last_seen_at)
      values (?, '0xrouter', ?, '214232', 'CB Consumer Confidence', ?, ?)`).run(id, `e-${id}`, date, `${date}T00:00:00.000Z`)
    observe('o1', '2026-09-16'); observe('o2', '2026-10-16'); observe('o3', '2026-11-17')
    seed(database, { metricKey: '["214232",1]', periodKey: 'unknown:["214232",1]',
      firstScheduledDate: '2026-12-01', identityKind: 'source' })
    run(database)
    const [row] = rows(database)
    expect(row!.period_key).toBe('2026-11')
  })
})

/**
 * #52：**非令牌期次当未解析处理**。回放曾把 `US.GDP.2026-Q3.SECOND` 的末段（二读序号）当
 * 期次写成 `SECOND`，与 BEA 的 `2026-Q3` 主键相差一期 → 同一次发布两行。
 *
 * 放宽第 2 步的捞取条件（unknown **或** 不是合法令牌）后：那行被解析成 `2026-Q3`，
 * 撞上已有那行 → 走**已存在**的 `period-resolve-collision`（补缺字段→归档→删重复），
 * 不新增任何合并逻辑，也**不碰来源**。
 */
describe('#52 非令牌期次（SECOND）→ 解析成真期次并合到已有那行', () => {
  it('`SECOND` + `2026-Q3` 两行 → 跑完只剩 `2026-Q3` 一行，来源仍是 BEA', () => {
    const database = setup()
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: '2026-Q3',
      firstScheduledDate: '2026-11-25', providerId: 'macro-calendar-bea' })
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: 'SECOND',
      firstScheduledDate: '2026-11-25', providerId: 'macro-calendar-official-replay' })
    run(database)
    const kept = rows(database)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.period_key).toBe('2026-Q3')
    // 合并留的是已有那行：来源不被回放顶掉。
    expect(kept[0]!.source_provider_id).toBe('macro-calendar-bea')
  })

  it('第二遍 0 变更（放宽条件不破坏幂等）', () => {
    const database = setup()
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: '2026-Q3',
      firstScheduledDate: '2026-11-25', providerId: 'macro-calendar-bea' })
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: 'SECOND',
      firstScheduledDate: '2026-11-25', providerId: 'macro-calendar-official-replay' })
    run(database)
    const second = run(database)
    expect(second.periodsResolved).toBe(0)
    expect(second.droppedRows).toBe(0)
    expect(rows(database)).toHaveLength(1)
  })
})

/**
 * #53：**同一身份的「已解析」与「unknown」重复，要在本次启动内合掉**，不等下一次重启。
 *
 * 真库那对：`["44994",78258]` 一条 2026-10-28（带 `event_type`，第 2 步按事件日期解析）、
 * 一条 `unknown:["44994",78258]`（没有 `event_type`，解不出）。桶一原来只在期次解析**之前**跑，
 * 那时两条都还是 unknown，合不到；解析之后新出现的正常行没有第二遍桶一去收拾——于是读者在
 * 下一次重启之前一直看到两行。
 */
describe('#53 解析之后当场再跑一遍桶一（不动原顺序）', () => {
  it('一条能解析成事件日、一条解不出 → 本次启动后只剩解析出来的那一行', () => {
    const database = setup()
    seed(database, { metricKey: '["44994",78258]', periodKey: 'unknown:["44994",78258]',
      firstScheduledDate: '2026-10-28', identityKind: 'source', eventType: 'central-bank-activity' })
    seed(database, { metricKey: '["44994",78258]', periodKey: 'unknown:["44994",78258]-dup',
      firstScheduledDate: '2026-10-28', identityKind: 'source' })
    run(database)
    const kept = rows(database)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.period_key).toBe('2026-10-28')
  })
})

/**
 * **改名撞车不许让整段规范化停摆**（架构师 2026-11-24 复核）。
 *
 * 第 2 步把「本来不是期次」的 `period_key` 改成 `unknown:<源内发布 id>` 是**裸 update**，而主键
 * 含 `period_key`。同桶里若已有一行正好叫这个 key，就会抛 UNIQUE——而整段规范化在一个
 * `try/catch` 里，catch 只留一行「启动规范化失败（已忽略）」，于是**这一轮清理整段不跑**，
 * 日志看起来还像「没事可做」。今天库里的数据没撞上，但这是静默停摆的口子。
 *
 * 修法：撞上就是「目标行已存在」——把值并进那一行、删本条（与正常期次撞车同一个动作），
 * 计数上报告。**不新造合并逻辑、不动来源、不删保留方**。
 */
describe('改名 unknown 撞上已有同名行：并进去，不抛', () => {
  it('两行 `SECOND` + `unknown:<同一个 id>`：桶一先接手合掉，最终 1 行', () => {
    const database = setup()
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: 'SECOND',
      firstScheduledDate: '2026-11-25', sourceEventId: 'US.GDP.2026-Q3.SECOND',
      providerId: 'macro-calendar-bea' })
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: 'unknown:US.GDP.2026-Q3.SECOND',
      firstScheduledDate: '2026-11-25', sourceEventId: 'US.GDP.2026-Q3.SECOND',
      providerId: 'macro-calendar-official-replay', valuesJson: '{"actual":"3.2%"}' })
    const report = run(database)
    const kept = rows(database)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.period_key).toBe('unknown:US.GDP.2026-Q3.SECOND')
    // 被删那条的值并进保留行；保留行自己没有值，不存在覆盖。
    expect(JSON.parse(String(kept[0]!.values_json))).toEqual({ actual: '3.2%' })
    expect(kept[0]!.value_state).toBe('present')
    // 这一形态在桶一就被合掉，走不到改名那一步。
    expect(report.renameCollisions).toBe(0)
  })

  it('真会撞的形态：正常期次 + `SECOND` + 同名 `unknown:` 三行 → 不抛、最终 1 行、撞车计数 1', () => {
    const database = setup()
    // 桶一不接手（同桶有两条「不像 unknown」的行，`normals.length !== 1`），于是改名那一步才撞上。
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: '2026-Q3',
      firstScheduledDate: '2026-11-25', sourceEventId: 'US.GDP.2026-Q3.SECOND',
      providerId: 'macro-calendar-bea' })
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: 'SECOND',
      firstScheduledDate: '2026-11-25', sourceEventId: 'US.GDP.2026-Q3.SECOND',
      providerId: 'macro-calendar-official-replay' })
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: 'unknown:US.GDP.2026-Q3.SECOND',
      firstScheduledDate: '2026-11-25', sourceEventId: 'US.GDP.2026-Q3.SECOND',
      providerId: 'macro-calendar-official-replay', valuesJson: '{"actual":"3.2%"}' })
    // 改前这里抛 `UNIQUE constraint failed`，整段回滚（`SECOND` 那行还在）。
    const report = run(database)
    const kept = rows(database)
    expect(kept).toHaveLength(1)
    expect(kept[0]!.period_key).toBe('2026-Q3')
    expect(JSON.parse(String(kept[0]!.values_json))).toEqual({ actual: '3.2%' })
    expect(kept[0]!.value_state).toBe('present')
    expect(report.renameCollisions).toBe(1)
    // 幂等：第二遍不再撞、也不再删。
    expect(run(database)).toMatchObject({ renameCollisions: 0, droppedRows: 0, periodsResolved: 0 })
    expect(rows(database)).toHaveLength(1)
  })

  it('改名成功时把原 period_key 记进报告（distinct，前几条）', () => {
    const database = setup()
    seed(database, { metricKey: 'US.GDP.SA.ANNUALIZED_QOQ', periodKey: 'SECOND',
      firstScheduledDate: '2026-11-25', sourceEventId: 'US.GDP.2026-Q3.SECOND' })
    seed(database, { metricKey: 'US.OTHER.NONE.LEVEL', periodKey: 'ADVANCE',
      firstScheduledDate: '2026-11-20', sourceEventId: 'US.OTHER.2026-Q3.ADVANCE' })
    const report = run(database)
    expect(report.renamedToUnknown).toBe(2)
    // 将来漏认一种形状时，日志里能看出**是谁被改名了**，而不是只显示「解析 N 条」。
    expect([...report.renamedFromPeriods].sort()).toEqual(['ADVANCE', 'SECOND'])
    expect(rows(database).map((row) => row.period_key).sort()).toEqual([
      'unknown:US.GDP.2026-Q3.SECOND', 'unknown:US.OTHER.2026-Q3.ADVANCE'
    ])
  })
})
