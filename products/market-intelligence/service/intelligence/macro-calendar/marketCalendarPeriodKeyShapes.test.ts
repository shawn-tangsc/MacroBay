import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { zeroXRouterEventIdentities } from './marketCalendarEventIdentities'
import { zeroXRouterCanonicalIdentity, zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'
import { derivePublishWindow } from './marketCalendarPublishWindow'
import { backfillStandardRowsFromObservations } from './marketCalendarStandardBackfill'
import { zeroXRouterSourceMetricMappings } from './marketCalendarZeroXRouterSourceMappings'
import { normalizeOfficialPeriodKey } from './marketCalendarOfficialSourceRows'
import { normalizeCalendarStandardRows } from './marketCalendarStartupNormalization'
import { ensureCalendarStandardTables, upsertCalendarStandardRow } from './marketCalendarStandardTable'

/**
 * **期次键的五种形状与「同一期」判定**（PRD R38 §3.1，产品 2026-11-21 定）。
 *
 * 同一期 = 国家 + 指标 + **归一后的期次键**三者相同。期次键只许五种形状：
 * 年 `YYYY`、季 `YYYY-Qn`、月 `YYYY-MM`、周＝截止日 `YYYY-MM-DD`、事件＝当天 `YYYY-MM-DD`。
 *
 * 两条别踩的：
 * - **周不用「第几周」**（无统一定义、ISO 周跨年错位）；
 * - **当月型调查/景气指标**（帝国州、费城联储、密歇根）发布月发的是**当月值**，按「上月」会错记，
 *   所以它们在建映射表时单独声明 `current_month`，不是默认值。
 *
 * **期次键只用于「是不是同一期」的判定，不是合并行的依据**：存储主键含首次排期日，排期不同
 * 就是两行（Chief 2026-11-21）；同期不同修订在展示/比较层读作「同一期的多条修订」。
 */
const now = '2026-11-21T03:00:00.000Z'

describe('期次键的五条可红判据', () => {
  it('判据 1：官方 `2026-M10` 与统计月型源（11-17 发布）归一出同一个键', () => {
    const official = normalizeOfficialPeriodKey('2026-M10')
    // 建筑支出：月率、统计月型（发布的是上一月）
    const source = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '9413', scheduledAt: '2026-11-17T13:30:00.000Z'
    })
    expect(official).toBe('2026-10')
    expect(source?.periodKey).toBe('2026-10')
    // 把 `M` 当字母（原样透传）、或把发布时刻原样当期次，两种都算红。
    expect(source?.periodKey).not.toContain('M')
    expect(source?.periodKey).not.toContain('T')
  })

  it('判据 2：周度按「截止日」；标题写了（至MMDD）以标题为准；不用「第几周」', () => {
    // Redbook 零售：周度。2026-11-17（周二）发布，上一个周六是 2026-11-14。
    const derived = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '9417', scheduledAt: '2026-11-17T13:00:00.000Z'
    })
    expect(derived?.periodKey).toBe('2026-11-14')
    // 标题自带截止日（源头自己说的优先）：发布 11-17、标题写「至1107」→ 用 11-07。
    const fromTitle = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '9417', scheduledAt: '2026-11-17T13:00:00.000Z',
      title: 'Redbook retail sales (to 1107)'
    })
    expect(fromTitle?.periodKey).toBe('2026-11-07')
    // 「第 46 周」这种写法不许出现（跨年必错位）。
    expect(derived?.periodKey).not.toMatch(/W\d{2}|第\s*\d+\s*周/u)
  })

  it('判据 3：当月型调查（帝国州 11-17 发布）必须落 2026-11；声明成统计月会落成 2026-10', () => {
    const empire = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '214790', scheduledAt: '2026-11-17T12:30:00.000Z'
    })
    expect(empire?.periodKey).toBe('2026-11')
    const philly = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '214905', scheduledAt: '2026-11-20T12:30:00.000Z'
    })
    expect(philly?.periodKey).toBe('2026-11')
    // 对照：同样 11-17 发布的统计月型指标落上一月（CPI 2026-10 就是 11 月发的）。
    const monthly = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '9413', scheduledAt: '2026-11-17T12:30:00.000Z'
    })
    expect(monthly?.periodKey).toBe('2026-10')
  })

  it('判据 3（数据侧）：五类调查/景气指标的映射声明了当月，不许漏回统计月', () => {
    const families = ['US.EMPIRE_STATE_MANUFACTURING.', 'US.PHILLY_FED_MANUFACTURING.',
      'US.DALLAS_FED_MANUFACTURING.', 'US.KANSAS_FED_MANUFACTURING.', 'US.RICHMOND_FED_MANUFACTURING.',
      'US.MICHIGAN_']
    const entries = Object.values(zeroXRouterIndicatorIdentities)
    const inFamilies = entries.filter((entry) => families.some((family) => entry.metricKey.startsWith(family)))
    expect(inFamilies.length).toBeGreaterThan(0)
    expect(inFamilies.filter((entry) => entry.periodRule !== 'current_month')
      .map((entry) => entry.metricKey)).toEqual([])
  })

  it('「产品点名中」的三类：要么按统计月且带标记，要么已改当月且无标记——不许悄悄悬着', () => {
    // CB 消费者信心、芝加哥 PMI、S&P Global 两类 PMI：产品还在点名，先按统计月处理但必须留痕。
    // 这条不是断言「值是 month」，而是断言「悬着的必须可见」：改成 current_month 的那天，
    // 标记必须同时删掉；留着标记不改、或改了不删标记，都会红。
    const pendingFamilies = ['US.CONSUMER_CONFIDENCE.', 'US.CHICAGO_PMI.',
      'US.SP_MANUFACTURING_PMI.', 'US.SP_SERVICES_PMI.']
    const entries = [...Object.values(zeroXRouterIndicatorIdentities),
      ...Object.values(zeroXRouterSourceMetricMappings)]
      .filter((entry) => pendingFamilies.some((family) => entry.metricKey.startsWith(family)))
    expect(entries.length).toBeGreaterThan(0)
    const inconsistent = entries.filter((entry) => entry.periodRule === 'month'
      ? entry.periodRuleReview !== 'pending-product'
      : entry.periodRule !== 'current_month' || entry.periodRuleReview !== undefined)
    expect(inconsistent.map((entry) => entry.metricKey)).toEqual([])
  })

  it('判据 4：凑不出期次的行记 unknown，且 unknown 与任何行都不同行（不参与合并）', () => {
    // 没有映射的源内身份：期次算不出，落 `unknown:<源内 id>`——每行唯一。
    expect(zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '999999', scheduledAt: '2026-11-17T12:30:00.000Z'
    })).toBeUndefined()
    const database = new DatabaseSync(':memory:')
    ensureCalendarStandardTables(database)
    const seed = (sourceEventId: string) => upsertCalendarStandardRow(database, {
      countryCode: 'US', metricKey: '["999999",1]', periodKey: `unknown:${sourceEventId}`,
      scheduledDate: '2026-11-17', timePrecision: 'date', status: 'published',
      valuesJson: JSON.stringify({ actual: '1' }), sourceProviderId: '0xrouter', sourceEventId,
      parserVersion: 'v1', observedAt: now, firstSeenAt: now, identityKind: 'source'
    })
    seed('["999999",1]')
    seed('["999999",2]')
    normalizeCalendarStandardRows(database, { nowIso: now })
    const rows = database.prepare("select period_key from mi_calendar_events where metric_key = '[\"999999\",1]' order by period_key")
      .all() as unknown as { period_key: string }[]
    // 两条都在、期次键各不相同——把 unknown 合并成一条就是错。
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((row) => row.period_key)).size).toBe(2)
  })

  it('判据 5：同月两场讲话按「当天」各成一条，不并成一条', () => {
    const first = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '44656', scheduledAt: '2026-11-05T14:00:00.000Z'
    })
    const second = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '44656', scheduledAt: '2026-11-19T14:00:00.000Z'
    })
    expect(first?.periodKey).toBe('2026-11-05')
    expect(second?.periodKey).toBe('2026-11-19')
    expect(first?.periodKey).not.toBe(second?.periodKey)
    // 事件码身份本身也要是事件码（不是把讲话记成指标）。
    expect(zeroXRouterEventIdentities['44656']?.metricKey).toBe('evt.central-bank-speech')
  })
})

describe('判据 6：当月型的反向坑（下月头 7 天发布的终值回退一期）', () => {
  const window = { startDay: 15, endDay: 27, samples: 12 }

  it('11-17 的闪值与 12-01 的 11 月终值落同一个期次键（落成 2026-12 即红）', () => {
    const flash = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '214232', scheduledAt: '2026-11-17T14:00:00.000Z', window
    })
    const final = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '214232', scheduledAt: '2026-12-01T14:00:00.000Z', window
    })
    expect(flash?.periodKey).toBe('2026-11')
    expect(final?.periodKey).toBe('2026-11')
    expect(final?.periodKey).toBe(flash?.periodKey)
    // 两条是两行（排期不同），但读作同一期——期次键只用来判「是不是同一期」，不是合并依据。
  })

  it('窗口从历史发布日现算：分位区间把「终值那天」排除在外', () => {
    expect(derivePublishWindow(['2026-11-01', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20']))
      .toEqual({ startDay: 17, endDay: 19, samples: 5 })
  })

  it('越窗但不在头 7 天 → 期次记缺（空），不默认按当月', () => {
    const late = zeroXRouterCanonicalIdentity({
      countryCode: 'US', indicatorId: '214232', scheduledAt: '2026-11-28T14:00:00.000Z',
      window: { startDay: 15, endDay: 20, samples: 10 }
    })
    expect(late?.periodKey).toBe('')
    expect(late?.metricKey).toBe('US.CONSUMER_CONFIDENCE.SA.LEVEL')
  })

  it('源自报期次优先：标题（Oct）用 10 月；滞后两月的序列（Sep）仍按源，不被声明规则覆盖', () => {
    const database = new DatabaseSync(':memory:')
    database.exec(`create table mi_macro_calendar_market_event_observations (
      source_event_id text not null, provider_id text not null, market_fact_key text,
      display_name text not null, country_code text, indicator_id text, event_kind text not null,
      scheduled_date text not null, scheduled_at text not null,
      consensus_json text, provider_previous_json text, provider_actual_json text,
      importance text not null, measure_keys_json text, last_seen_at text)`)
    ensureCalendarStandardTables(database)
    const insert = (sourceEventId: string, title: string) => database.prepare(`insert into
      mi_macro_calendar_market_event_observations
      (source_event_id, provider_id, market_fact_key, display_name, country_code, indicator_id, event_kind,
       scheduled_date, scheduled_at, consensus_json, provider_previous_json, provider_actual_json,
       importance, measure_keys_json, last_seen_at)
      values (?, '0xrouter', null, ?, 'USA', '9413', 'economic-indicator', '2026-11-17',
        '2026-11-17T15:00:00.000Z', null, null, '{"displayValue":"1.2"}', 'high', '[]', '2026-11-18')`)
      .run(sourceEventId, title)
    // 建筑支出月率：规则反推 2026-10。
    insert('ok-1', 'Construction spending (Oct)')       // 源说 10 月 → 与规则一致
    insert('lagged-1', 'Construction spending (Sep)')   // 源说 9 月（滞后两个月发布）→ 仍按源
    const report = backfillStandardRowsFromObservations(database, { providerId: '0xrouter', observedAt: now })
    // 不一致要**计数上屏**、不丢行：标题 (Sep) 与兜底规则（上一月 10 月）不同，记一次。
    expect(report.periodRuleConflicts).toBe(1)
    expect(report.periodRuleConflictIdentities).toEqual(['US.CONSTRUCTION_SPENDING.SA.MOM'])
    const rows = database.prepare("select source_event_id, period_key from mi_calendar_events where metric_key = 'US.CONSTRUCTION_SPENDING.SA.MOM' order by source_event_id")
      .all() as unknown as { source_event_id: string; period_key: string }[]
    // 源自报期次是事实；声明规则只是「没给期次时」的兜底，不许反过来覆盖源。
    expect(rows).toEqual([
      { source_event_id: 'lagged-1', period_key: '2026-09' },
      { source_event_id: 'ok-1', period_key: '2026-10' }
    ])
  })
})
