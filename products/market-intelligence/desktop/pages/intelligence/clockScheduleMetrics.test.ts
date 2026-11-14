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
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events, facts })
  const cpi = metrics.find((metric) => metric.metricKey === 'US.CPI.NSA.YOY')!
  // 本期 CPI 没有实际值 → 牌的数值位用上一期的结果，不编一个「本期」的。
  expect(cpi.lastRelease).toEqual({ date: '2026-11-10', value: '3.74%' })
  // 下一期来自读数里的 next（日程那边只读到过去两个月）。
  expect(cpi.nextRelease).toEqual({ date: '2026-12-10' })
  expect(cpi.periodDays).toBe(31)
})

it('keeps the expectation absent when the read has none, so the card writes 预期未提供', () => {
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events, facts })
  const payrolls = metrics.find((metric) => metric.metricKey === 'US.NONFARM.SA.CHANGE')!
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

it('gives today’s four plaques and one line for the crowded fifth', () => {
  const model = buildClockCardModel({ today: '2026-11-15', metrics: clockScheduleMetrics({
    today: '2026-11-15', events, facts, policy: { meetingDate: '2026-12-09', probability: { value: 0.868 } }
  }) })
  expect(model.plaques).toHaveLength(4)
  expect(model.unplaced).toEqual([expect.objectContaining({ metricKey: 'US.CPI.NSA.YOY', reason: 'crowded', daysUntil: 25 })])
})
