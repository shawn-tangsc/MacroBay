import { expect, it } from 'vitest'

import { buildClockCardModel } from './clockCardModel'
import { clockScheduleMetrics, type ClockCardFact, type ClockScheduleEvent } from './clockScheduleMetrics'

/**
 * 挂点输入：**日程给日期与周期 P，卡片读数给值**。
 * 判据取真库 2026-11 的日程与读数，不是编出来的数字。
 */
const event = (scheduledAt: string, metricKey: string): ClockScheduleEvent =>
  ({ scheduledAt, measureKeys: [metricKey] })

const facts: readonly ClockCardFact[] = [
  { metricKey: 'US.CPI.NSA.YOY', releasedAt: '2026-11-10T13:30:00.000Z', previousAsPublished: 3.73768, unit: 'percent',
    next: { releaseAt: '2026-12-10T13:30:00.000Z' } },
  { metricKey: 'US.NONFARM.SA.CHANGE', releasedAt: '2026-11-06T13:30:00.000Z', value: 165, previousAsPublished: 60, unit: 'thousands',
    next: { releaseAt: '2026-12-04T13:30:00.000Z' } }
]

const events: readonly ClockScheduleEvent[] = [
  event('2026-10-10T13:30:00.000Z', 'US.CPI.NSA.YOY'),
  event('2026-11-10T13:30:00.000Z', 'US.CPI.NSA.YOY'),
  event('2026-10-09T13:30:00.000Z', 'US.NONFARM.SA.CHANGE'),
  event('2026-11-06T13:30:00.000Z', 'US.NONFARM.SA.CHANGE')
]

it('takes dates and the period from the schedule, values from the same read as the drawer', () => {
  // 牌的身份用**概念串**（`US.CPI.YOY`）：季调/未季调是同一概念的变体，匹配走 `metricConceptOf`。
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events, facts })
  const cpi = metrics.find((metric) => metric.metricKey === 'US.CPI.YOY')!
  // 本期 CPI 没有实际值 → 牌的数值位用上一期的结果，不编一个「本期」的。
  // `at` 是发布时刻：中央的 ±24 小时窗口按它算，不许在读取层丢掉。
  expect(cpi.lastRelease).toEqual({ date: '2026-11-10', at: '2026-11-10T13:30:00.000Z', value: '3.74%' })
  // 下一期来自读数里的 next（日程那边只读到过去两个月）；时刻同样保留给中央窗口用。
  expect(cpi.nextRelease).toEqual({ date: '2026-12-10', at: '2026-12-10T13:30:00.000Z' })
  expect(cpi.periodDays).toBe(31)
})

it('keeps the expectation absent when the read has none, so the card writes 预期未提供', () => {
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events, facts })
  const payrolls = metrics.find((metric) => metric.metricKey === 'US.NONFARM.CHANGE')!
  expect(payrolls.lastRelease?.value).toBe('+165K')
  expect(payrolls.nextRelease?.expected).toBeUndefined()
})

it('carries the policy meeting and the priced probability; no past plaque and no 挂不上 line for it', () => {
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events: [], facts: [], policy: {
    meetingDate: '2026-12-09', probability: { value: 0.868 }
  } })
  const policy = metrics.find((metric) => metric.metricKey === 'US.TARGET_RATE.DECISION')!
  expect(policy.nextRelease).toEqual({ date: '2026-12-09', expected: '86.8%' })
  const unplaced = buildClockCardModel({ today: '2026-11-15', metrics }).unplaced
  expect(unplaced.some((entry) => entry.metricKey === 'US.TARGET_RATE.DECISION')).toBe(false)
})

it('rings a date without a market expectation, and merges it with the adjacent policy date', () => {
  const model = buildClockCardModel({ today: '2026-11-21', metrics: clockScheduleMetrics({
    today: '2026-11-21',
    events: [event('2026-12-04T13:30:00.000Z', 'US.NONFARM.SA.CHANGE'), event('2026-12-10T13:30:00.000Z', 'US.CPI.NSA.YOY')],
    facts: [], policy: { meetingDate: '2026-12-09', probability: { value: 0.868 } }
  }) })
  // 没有盘口预期的日期**也上环**（用户 2026-11-21：一级指标都要放），只是牌上没有数字。
  const payrolls = model.plaques.find((plaque) => plaque.metricKey === 'US.NONFARM.CHANGE')!
  expect(payrolls).toBeDefined()
  expect(payrolls.value).toBeUndefined()
  // 政策 12-09 与 CPI 12-10 相交 → 合并一块，两行日期都在；中央仍是利率路径面。
  const merged = model.plaques.find((plaque) => plaque.merged !== undefined)!
  expect(merged.merged!.map((entry) => entry.date)).toEqual(['2026-12-09', '2026-12-10'])
  expect(model.center?.kind).toBe('policy')
})

/**
 * 同一天有盘口的先上牌：**只有 CPI 有盘口、PCE 没有**，且 PCE 更近（4 天）。
 * 两块牌都要在环上（每个日期一块），但只有 CPI 那块带数字——不是「有盘口才配挂」。
 */
it('rings every date, and only the one with a market expectation carries a number', () => {
  const facts: readonly ClockCardFact[] = [
    { metricKey: 'US.CORE_PCE.SA.YOY', unit: 'percent' as const,
      next: { releaseAt: '2026-11-25T13:30:00.000Z' } },
    { metricKey: 'US.CPI.NSA.YOY', unit: 'percent' as const,
      next: { releaseAt: '2026-12-10T13:30:00.000Z', expected: { value: 3.2, provenance: 'market-implied' as const } } }
  ]
  const model = buildClockCardModel({ today: '2026-11-21',
    metrics: clockScheduleMetrics({ today: '2026-11-21', events: [], facts }) })
  expect(model.plaques.filter((plaque) => plaque.zone === 'future').map((plaque) => plaque.metricKey).sort())
    .toEqual(['US.CORE_PCE.YOY', 'US.CPI.YOY'])
  expect(model.plaques.find((plaque) => plaque.metricKey === 'US.CORE_PCE.YOY')!.value).toBeUndefined()
  expect(model.plaques.find((plaque) => plaque.metricKey === 'US.CPI.YOY')!.value).toBe('3.20%')
  expect(model.center).toBeUndefined()
})

/** 数据商问卷值（`source-survey`）不算盘口：牌上不出现它，也不拿它当「有预期」。 */
it('does not treat a source-survey expectation as a market-implied one', () => {
  const surveyOnly: readonly ClockCardFact[] = [
    { ...facts[0]!, next: { releaseAt: '2026-12-10T13:30:00.000Z',
      expected: { value: 3.2, provenance: 'source-survey' as const } } }
  ]
  const model = buildClockCardModel({ today: '2026-11-15',
    metrics: clockScheduleMetrics({ today: '2026-11-15', events, facts: surveyOnly }) })
  expect(model.center).toBeUndefined()
  // 问卷值照旧显示在牌上，但它不算盘口：不影响「谁当代表」的优先级，也不进中央的窗口判定。
  expect(model.plaques.find((plaque) => plaque.metricKey === 'US.CPI.YOY')!.value).toBe('3.20%')
})

/**
 * 真库形状（2026-11-21）：核心 PCE 4 天后、非农 13 天后、CPI 19 天后——**三块牌都在环上**，
 * 核心 PCE 那块带 3.12% 盘口。（用户「CPI 非农怎么没了」就是这一条。）
 */
it('rings core PCE, payrolls and CPI on their own dates, with the odds on PCE', () => {
  const facts: readonly ClockCardFact[] = [
    { metricKey: 'US.CORE_PCE.SA.YOY', unit: 'percent' as const,
      next: { releaseAt: '2026-11-25T13:30:00.000Z', expected: { value: 3.12, provenance: 'market-implied' as const } } },
    { metricKey: 'US.CPI.NSA.YOY', unit: 'percent' as const,
      next: { releaseAt: '2026-12-10T13:30:00.000Z', expected: { value: 3.2, provenance: 'market-implied' as const } } },
    { metricKey: 'US.NONFARM.SA.CHANGE', next: { releaseAt: '2026-12-04T13:30:00.000Z' } }
  ]
  const model = buildClockCardModel({ today: '2026-11-21',
    metrics: clockScheduleMetrics({ today: '2026-11-21', events: [], facts }) })
  const ring = model.plaques.filter((plaque) => plaque.zone === 'future')
  expect(ring.map((plaque) => plaque.metricKey).sort())
    .toEqual(['US.CORE_PCE.YOY', 'US.CPI.YOY', 'US.NONFARM.CHANGE'])
  const pce = ring.find((plaque) => plaque.metricKey === 'US.CORE_PCE.YOY')!
  expect(pce.daysUntil).toBe(4)
  expect(pce.value).toBe('3.12%')
  expect(model.center).toBeUndefined()
})
