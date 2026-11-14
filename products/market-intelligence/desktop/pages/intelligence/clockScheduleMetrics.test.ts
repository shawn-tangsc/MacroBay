import { expect, it } from 'vitest'

import { buildClockCardModel } from './clockCardModel'
import { clockScheduleMetrics, type ClockSourceEvent } from './clockScheduleMetrics'

/**
 * 日历读数 → 挂点输入。判据是真库里那几条日程（2026-11 的 CPI 与非农）：
 * 周期 P 取「上一期与再上一期间隔」，下一期的值取市场预期，取不到就不给。
 */
const event = (scheduledAt: string, input: Partial<ClockSourceEvent> = {}): ClockSourceEvent =>
  ({ scheduledAt, ...input })

it('reads the last two releases, the next one and the period between them', () => {
  const events = [
    // 上一期与再上一期都在过去：P 取这两条之间的间隔（30 天）。
    event('2026-10-10T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'], providerActual: { displayValue: '3.7%' } }),
    event('2026-11-10T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'], providerActual: { displayValue: '3.9%' } }),
    event('2026-12-10T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'], consensus: { displayValue: '4.0%' } })
  ]
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events })
  const cpi = metrics.find((metric) => metric.metricKey === 'US.CPI.NSA.YOY')!
  expect(cpi.lastRelease).toEqual({ date: '2026-11-10', value: '3.9%' })
  expect(cpi.nextRelease).toEqual({ date: '2026-12-10', expected: '4.0%' })
  expect(cpi.periodDays).toBe(31)
})

it('falls back to the last-to-next gap when only one release has happened', () => {
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events: [
    event('2026-11-06T13:30:00.000Z', { measureKeys: ['US.NONFARM.SA.CHANGE'], providerActual: { displayValue: '+165K' } }),
    event('2026-12-04T13:30:00.000Z', { measureKeys: ['US.NONFARM.SA.CHANGE'] })
  ] })
  const payrolls = metrics.find((metric) => metric.metricKey === 'US.NONFARM.SA.CHANGE')!
  expect(payrolls.periodDays).toBe(28)
  // 12-04 这期没有共识值：不许编一个「预期」。
  expect(payrolls.nextRelease?.expected).toBeUndefined()
})

it('carries the policy meeting date and the priced probability as the next value', () => {
  const metrics = clockScheduleMetrics({ today: '2026-11-15', events: [], policy: {
    meetingDate: '2026-12-09', probability: { value: 0.868 }
  } })
  const policy = metrics.find((metric) => metric.metricKey === 'US.TARGET_RATE.DECISION')!
  expect(policy.nextRelease).toEqual({ date: '2026-12-09', expected: '86.8%' })
  // 政策利率只有未来牌，不会因为它自己冒出一条「挂不上」；两条指标没有日程时照规则留交代。
  const unplaced = buildClockCardModel({ today: '2026-11-15', metrics }).unplaced
  expect(unplaced.some((entry) => entry.metricKey === 'US.TARGET_RATE.DECISION')).toBe(false)
  expect(unplaced).toEqual([
    { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', reason: 'no-next-release' },
    { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls', reason: 'no-next-release' }
  ])
})

it('gives the card today’s four plaques and one line for the crowded fifth', () => {
  const events = [
    event('2026-10-10T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'], providerActual: { displayValue: '3.7%' } }),
    event('2026-11-10T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'], providerActual: { displayValue: '3.9%' } }),
    event('2026-12-10T13:30:00.000Z', { measureKeys: ['US.CPI.NSA.YOY'] }),
    event('2026-10-09T13:30:00.000Z', { measureKeys: ['US.NONFARM.SA.CHANGE'], providerActual: { displayValue: '+60K' } }),
    event('2026-11-06T13:30:00.000Z', { measureKeys: ['US.NONFARM.SA.CHANGE'], providerActual: { displayValue: '+165K' } }),
    event('2026-12-04T13:30:00.000Z', { measureKeys: ['US.NONFARM.SA.CHANGE'] })
  ]
  const model = buildClockCardModel({
    today: '2026-11-15', metrics: clockScheduleMetrics({ today: '2026-11-15', events, policy: {
      meetingDate: '2026-12-09', probability: { value: 0.868 }
    } })
  })
  expect(model.plaques).toHaveLength(4)
  expect(model.unplaced).toEqual([expect.objectContaining({ metricKey: 'US.CPI.NSA.YOY', reason: 'crowded', daysUntil: 25 })])
})
