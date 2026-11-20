import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { normalizeCalendarCountryCodes } from './marketCalendarCountryNormalization'
import { normalizeSourcePeriodsByShape } from './marketCalendarSourcePeriodMigration'
import { periodFromSourceTitle } from './marketCalendarSourcePeriodFromTitle'
import { ensureCalendarStandardTables } from './marketCalendarStandardTable'

/**
 * 两条「持续补齐」的判据都要按**差集**，不按版本标记（用户 2026-11-17，待办 #53）：
 * - 国家码归一：v15 跑完之后新进来的 `FRA`/`UK`/`USA` 也要归一；
 * - 期次从标题解析：英文 `(Nov)` 与中文 `11月` 必须解出同一个期次，否则同一事件「谁写入谁决定结果」。
 */
const now = '2026-11-17T21:00:00.000Z'

function setup(): DatabaseSync {
  const database = new DatabaseSync(':memory:')
  ensureCalendarStandardTables(database)
  database.exec('create table if not exists mi_macro_calendar_migrations (version integer primary key)')
  return database
}

function seed(database: DatabaseSync, countryCode: string, metricKey: string, periodKey: string): void {
  database.prepare(`insert into mi_calendar_events
    (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision, status,
     identity_kind, source_label, value_state, values_json, source_provider_id, source_event_id, parser_version,
     observed_at, first_seen_at, event_type, release_count)
    values (?, ?, ?, '2026-11-16', '2026-11-16', 'date', 'scheduled', 'source', 'x', 'missing', '{}',
      '0xrouter', ?, 'v1', ?, ?, 'economic-indicator', 1)`).run(countryCode, metricKey, periodKey,
    `${countryCode}-${metricKey}`, now, now)
}

describe('期次从标题解析：两种 locale 必须解出同一个期次', () => {
  it('英文 (Nov) 与中文 11月 得到同一个期次；季度与跨年也对', () => {
    expect(periodFromSourceTitle('New York Fed manufacturing index(Nov)', '2026-11-16')?.periodKey).toBe('2026-11')
    expect(periodFromSourceTitle('11月纽约联储制造业指数', '2026-11-16')?.periodKey).toBe('2026-11')
    expect(periodFromSourceTitle('第三季度实际GDP初值(年化季率)', '2026-11-16')?.periodKey).toBe('2026-Q3')
    // 标题里没有期次后缀 → 明确缺失，绝不用发布时刻顶。
    expect(periodFromSourceTitle('Empire State manufacturing survey', '2026-11-16')).toBeNull()
    // 跨年：12 月的数据在次年 1 月发布。
    expect(periodFromSourceTitle('Wholesale Price Index (MoM)(Dec)', '2027-01-14')?.periodKey).toBe('2026-12')
  })
})

describe('国家码归一是差集，不是版本标记', () => {
  it('v15 跑过一次之后，新进来的不合形状的行仍然会被归一', () => {
    const database = setup()
    seed(database, 'USA', 'US.CPI.NSA.YOY', '2026-10')
    const first = normalizeCalendarCountryCodes(database)
    expect(first.renamed + first.merged).toBeGreaterThan(0)
    // 模拟「v15 之后又采进来一条 UK 行」：版本标记已经记过 15，旧写法会永远跳过它。
    seed(database, 'UK', 'US.OTHER.SA.MOM', '2026-11')
    const second = normalizeCalendarCountryCodes(database)
    expect(second.pending).toBe(1)
    expect(second.renamed).toBe(1)
    const countries = database.prepare('select distinct country_code from mi_calendar_events order by 1')
      .all() as unknown as { country_code: string }[]
    expect(countries.map((row) => row.country_code)).toEqual(['GB', 'US'])
    // 没有缺口时返回 0，且**不留版本标记**（否则下一批新行又被它挡掉）。
    expect(normalizeCalendarCountryCodes(database).pending).toBe(0)
    const markers = database.prepare('select count(*) n from mi_macro_calendar_migrations where version = 15').get() as { n: number }
    expect(markers.n).toBe(0)
  })

  /**
   * 真库副本上撞过的那个坑：**改名撞主键**。旧实现「查目标键上有没有一行」用的是 `=`，改名用
   * `update ... where 四元组`——两处都依赖主键列非空。真库那张表是迁出来的，主键列**允许 NULL**
   * （代码新建的表不允许，这也是一处 schema 漂移），`= NULL` 永远不成立，于是它以为目标键空着，
   * 接着改名撞上真实存在的那一行，整笔迁移 `constraint failed` 回滚。现在按 `rowid` 定位、
   * 用 `is` 做 null 安全比较。
   */
  it('目标键上已有同名行时合并成一行，值保留有值的那份', () => {
    const database = setup()
    seed(database, 'FR', 'FR.CPI.NSA.YOY', '2026-11')
    // 已有行补一个实际值，合并后不许丢。
    database.prepare(`update mi_calendar_events set values_json = '{"actual":"1.9"}', value_state = 'present'
      where country_code = 'FR'`).run()
    seed(database, 'FRA', 'FR.CPI.NSA.YOY', '2026-11')
    const report = normalizeCalendarCountryCodes(database)
    expect(report.merged).toBe(1)
    expect(report.renamed).toBe(0)
    const rows = database.prepare('select country_code, values_json from mi_calendar_events').all() as
      { country_code: string; values_json: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.country_code).toBe('FR')
    expect(JSON.parse(rows[0]!.values_json)).toEqual({ actual: '1.9' })
  })
})

describe('期次按形状归一：按 rowid 两阶段，不按四元组拼串', () => {
  /**
   * 真库副本上这条归一**从来没生效过**：它按「国家|指标|期次|首发布日」拼串再 `update ... where 四元组`。
   * 主键列在迁出来的表上允许 `NULL`，`String(null)` 会拼成 `"null"`；更关键的是归一后的目标键上
   * 可能已经有一行**不在扫描范围里**的行（它不是发布时刻形状——比如已经是 `2026-09`），
   * 于是改名撞主键、整笔回滚，连日志都只有一句「历史回放失败（已忽略）」。
   */
  it('目标键上已有正常期次的行时合并成一行，不撞主键', () => {
    const database = setup()
    const insert = (periodKey: string, sourceEventId: string, values: string): void => {
      database.prepare(`insert into mi_calendar_events
        (country_code, metric_key, period_key, scheduled_date, first_scheduled_date, time_precision, status,
         identity_kind, source_label, source_label_en, value_state, values_json, source_provider_id, source_event_id,
         parser_version, observed_at, first_seen_at, event_type, release_count)
        values ('US', 'US.CONSUMER_CREDIT.SA.CHANGE', ?, '2026-11-06', '2026-11-06', 'date', 'published',
          'source', '', 'Changes in consumer credit (billions of dollars)(Sep)', 'present', ?,
          '0xrouter', ?, 'v1', '2026-11-17T00:00:00.000Z', '2026-11-17T00:00:00.000Z', 'economic-indicator', 1)`)
        .run(periodKey, values, sourceEventId)
    }
    // 已经是对的期次（不在扫描范围里）；另一行还是发布时刻形状，归一后与它同键。
    insert('2026-09', 'ok-1', '{"actual":"9.9"}')
    insert('2026-11-06T13:30', 'stray-1', '{}')
    const report = normalizeSourcePeriodsByShape(database)
    expect(report.droppedRows).toBe(1)
    const rows = database.prepare('select period_key, values_json from mi_calendar_events').all() as
      { period_key: string; values_json: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0]!.period_key).toBe('2026-09')
    // 有值的一方不被空值盖掉。
    expect(JSON.parse(rows[0]!.values_json)).toEqual({ actual: '9.9' })
  })
})
