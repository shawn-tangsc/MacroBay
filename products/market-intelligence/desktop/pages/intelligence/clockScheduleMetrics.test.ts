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
  expect(cpi.lastRelease).toEqual({ date: '2026-11-10', value: '3.74%' })
  // 下一期来自读数里的 next（日程那边只读到过去两个月）。
  expect(cpi.nextRelease).toEqual({ date: '2026-12-10' })
  expect(cpi.periodDays).toBe(31)
})

it('keeps the expectation absent when the read has none, so the card writes 预期未提供', () => {
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events, facts })
  const payrolls = metrics.find((metric) => metric.metricKey === 'US.NONFARM.CHANGE')!
  expect(payrolls.lastRelease?.value).toBe('+165K')
  expect(payrolls.nextRelease?.expected).toBeUndefined()
  const model = buildClockCardModel({ today: '2026-11-15', metrics })
  expect(model.center?.expected).toBeUndefined()
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

it('rings only the policy plaque when no indicator carries a market-implied expectation', () => {
  const model = buildClockCardModel({ today: '2026-11-15', metrics: clockScheduleMetrics({
    today: '2026-11-15', events, facts, policy: { meetingDate: '2026-12-09', probability: { value: 0.868 } }
  }) })
  // 两个指标都没有盘口预期 → 都不上环（不硬挂），主位留空；政策牌照旧单独一块。
  expect(model.plaques.map((plaque) => plaque.metricKey)).toEqual(['US.TARGET_RATE.DECISION'])
  expect(model.center).toBeUndefined()
  // 没上环的原因写「没被选中」而不是「放不下」，并带上日期与天数供下沿那行列全。
  expect(model.unplaced.filter((entry) => entry.reason === 'not-selected').map((entry) => entry.metricKey).sort())
    .toEqual(['US.CPI.YOY', 'US.NONFARM.CHANGE'])
})

/**
 * 选法红证二：**只有 CPI 有盘口、PCE 没有**，且 PCE 更近（4 天）→ 环上必须是 CPI（19 天）。
 * 若选法退化成「取最近的指标」，这条立刻红——它证明的是「有盘口优先」，不是「永远挑某个指标」。
 */
it('picks the indicator with a market-implied expectation even when another is nearer', () => {
  const facts: readonly ClockCardFact[] = [
    { metricKey: 'US.CORE_PCE.SA.YOY', unit: 'percent' as const,
      next: { releaseAt: '2026-11-25T13:30:00.000Z' } },
    { metricKey: 'US.CPI.NSA.YOY', unit: 'percent' as const,
      next: { releaseAt: '2026-12-10T13:30:00.000Z', expected: { value: 3.2, provenance: 'market-implied' as const } } }
  ]
  const model = buildClockCardModel({ today: '2026-11-21',
    metrics: clockScheduleMetrics({ today: '2026-11-21', events: [], facts }) })
  expect(model.center?.metricKey).toBe('US.CPI.YOY')
  expect(model.center?.daysUntil).toBe(19)
})

/** 数据商问卷值（`source-survey`）不算盘口：不能拿它当「有预期」把指标顶上环。 */
it('does not treat a source-survey expectation as a market-implied one', () => {
  const surveyOnly: readonly ClockCardFact[] = [
    { ...facts[0]!, next: { releaseAt: '2026-12-10T13:30:00.000Z',
      expected: { value: 3.2, provenance: 'source-survey' as const } } }
  ]
  const model = buildClockCardModel({ today: '2026-11-15',
    metrics: clockScheduleMetrics({ today: '2026-11-15', events, facts: surveyOnly }) })
  expect(model.center).toBeUndefined()
})

/**
 * 选法红证一（用户 2026-11-21 的口径）：今天环上/主位必须是**核心 PCE 年率 · 4 天后 · 3.12%**，
 * 不是 13 天后的非农。三条候选都有一级码，只有 PCE 与 CPI 有盘口，PCE 更近。
 */
it('rings the nearest market-implied indicator: core PCE, four days out, with its odds', () => {
  const facts: readonly ClockCardFact[] = [
    { metricKey: 'US.CORE_PCE.SA.YOY', unit: 'percent' as const,
      next: { releaseAt: '2026-11-25T13:30:00.000Z', expected: { value: 3.12, provenance: 'market-implied' as const } } },
    { metricKey: 'US.CPI.NSA.YOY', unit: 'percent' as const,
      next: { releaseAt: '2026-12-10T13:30:00.000Z', expected: { value: 3.2, provenance: 'market-implied' as const } } },
    { metricKey: 'US.NONFARM.SA.CHANGE', next: { releaseAt: '2026-12-04T13:30:00.000Z' } }
  ]
  const model = buildClockCardModel({ today: '2026-11-21',
    metrics: clockScheduleMetrics({ today: '2026-11-21', events: [], facts }) })
  expect(model.center?.metricKey).toBe('US.CORE_PCE.YOY')
  expect(model.center?.daysUntil).toBe(4)
  expect(model.center?.expected).toBe('3.12%')
  // 环上那块与主位是同一个指标（不许主位一个、环上另一个）。
  expect(model.plaques.filter((plaque) => plaque.zone === 'future').map((plaque) => plaque.metricKey))
    .toEqual(['US.CORE_PCE.YOY'])
})
