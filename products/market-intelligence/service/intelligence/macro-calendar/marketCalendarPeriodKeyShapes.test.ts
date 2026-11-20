import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'

import { zeroXRouterEventIdentities } from './marketCalendarEventIdentities'
import { zeroXRouterCanonicalIdentity, zeroXRouterIndicatorIdentities } from './marketCalendarMetricIdentity'
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