import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { normalizeCalendarCountryCodes } from './marketCalendarCountryNormalization'
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
})
