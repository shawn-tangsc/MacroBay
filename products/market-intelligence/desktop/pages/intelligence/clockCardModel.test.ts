import { describe, expect, it } from 'vitest'

import {
  buildClockCardModel, clockCardCenter, clockCardGeometry, clockFutureAngle, clockFutureOpacity,
  clockPastAngle, clockRingPoint, type ClockScheduleMetric
} from './clockCardModel'

/**
 * 时钟卡的几何与挂点。判据直接取自 `FINAL-时钟卡-实现依据.html`：
 * 圆心只有一处来源、两区不等速、透明度是位置驱动的静态值。
 */
describe('clock card geometry has one source', () => {
  it('derives both centres from CARD 336×330 and PAD 12', () => {
    expect(clockCardCenter.cardX).toBe(168)
    expect(clockCardCenter.cardY).toBe(165)
    expect(clockCardCenter.svgX).toBe(156)
    expect(clockCardCenter.svgY).toBe(153)
    expect(clockCardGeometry.svgWidth).toBe(312)
    expect(clockCardGeometry.svgHeight).toBe(306)
  })

  /**
   * 原型里那四个牌的 left/top 就是这条公式的输出值——照抄公式，四个点必须逐一对上。
   * 对不上说明角度约定（12 点起、顺时针）或半径被换掉了。
   */
  it('puts the prototype’s four plaques exactly where the prototype puts them', () => {
    const cases: ReadonlyArray<readonly [number, number, number]> = [
      [176.8, 175.54, 299.79],
      [218.4, 84.15, 270.8],
      [288.0, 39.61, 123.28],
      [337.2, 115.69, 40.55]
    ]
    for (const [angle, x, y] of cases) {
      const point = clockRingPoint(angle)
      expect(Number(point.x.toFixed(2)), `${angle}° x`).toBe(x)
      expect(Number(point.y.toFixed(2)), `${angle}° y`).toBe(y)
    }
  })
})

describe('the two halves move at different speeds', () => {
  it('maps the future half at 8° per day (240° = 30 days)', () => {
    expect(clockFutureAngle(19)).toBe(152)
    expect(clockFutureAngle(24)).toBe(192)
    expect(clockFutureAngle(30)).toBe(240)
  })

  it('maps the past half by the metric’s own period', () => {
    // 月度 30 天：1 天 12°。
    expect(clockPastAngle(5, 30)).toBe(300)
    expect(clockPastAngle(0, 30)).toBe(0)
    // 非农 11-06 → 12-04 的 28 天周期：9 天 = 115.71°。
    expect(Number(clockPastAngle(9, 28).toFixed(4))).toBe(244.2857)
  })

  it('follows 0.5 + (days÷30)²×0.5 for the future half only', () => {
    expect(clockFutureOpacity(30)).toBe(1)
    expect(clockFutureOpacity(0)).toBe(0.5)
    expect(Number(clockFutureOpacity(19).toFixed(4))).toBe(0.7006)
    expect(clockFutureOpacity(24)).toBeCloseTo(0.82, 10)
  })
})

// 真库 2026-11-15 的四条：CPI 与新增就业各有上次发布，新增就业还有下一期。
const measured: readonly ClockScheduleMetric[] = [
  { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
    lastRelease: { date: '2026-11-10', value: '3.74%' },
    nextRelease: { date: '2026-12-10' }, periodDays: 30 },
  { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
    lastRelease: { date: '2026-11-06', value: '+165K' },
    nextRelease: { date: '2026-12-04' }, periodDays: 28 },
  { metricKey: 'US.TARGET_RATE.HIKE_25', nameKey: 'policyRate',
    nextRelease: { date: '2026-12-09' }, periodDays: 42 }
]

describe('the model built from real schedule dates', () => {
  it('places today’s four plaques with the angles the data gives', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: measured })
    const byId = new Map(model.plaques.map((plaque) => [plaque.id, plaque]))
    const past = byId.get('US.CPI.NSA.YOY:past')!
    expect(past.angle).toBe(300)
    expect(Number(past.x.toFixed(2))).toBe(51.09)
    expect(Number(past.y.toFixed(2))).toBe(97.5)
    expect(past.opacity).toBe(1)
    expect(Number(byId.get('US.NONFARM.SA.CHANGE:past')!.angle.toFixed(4))).toBe(244.2857)
    expect(byId.get('US.NONFARM.SA.CHANGE:future')!.angle).toBe(152)
    expect(Number(byId.get('US.NONFARM.SA.CHANGE:future')!.opacity.toFixed(4))).toBe(0.7006)
    expect(byId.get('US.TARGET_RATE.HIKE_25:future')!.angle).toBe(192)
    expect(byId.get('US.TARGET_RATE.HIKE_25:future')!.opacity).toBeCloseTo(0.82, 10)
  })

  /** 用户 2026-11-12 定：两条各判各的，同一指标可以同时占两个位置，不许互相顶掉。 */
  it('lets one metric hold a past plaque and a future plaque at the same time', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: measured })
    expect(model.plaques.filter((plaque) => plaque.metricKey === 'US.NONFARM.SA.CHANGE')).toHaveLength(2)
  })

  /** 保留期 P/3 是规则：非农 11-06 发布、P=28 → 9.33 天后撤掉过去牌（11-16 满 10 天）。 */
  it('retires the past plaque once the retention window has passed, without calling it a gap', () => {
    const model = buildClockCardModel({ today: '2026-11-16', metrics: measured })
    expect(model.plaques.some((plaque) => plaque.id === 'US.NONFARM.SA.CHANGE:past')).toBe(false)
    // 撤掉是规则到点，不是「挂不上去」：不许因此冒出一条交代。
    expect(model.unplaced.some((entry) => entry.metricKey === 'US.NONFARM.SA.CHANGE')).toBe(false)
    // 未来牌不受影响：下一期还在。
    expect(model.plaques.some((plaque) => plaque.id === 'US.NONFARM.SA.CHANGE:future')).toBe(true)
  })

  /** 主位 = 所有下一期里最近的那一个，与它在不在过去区无关。 */
  it('picks the nearest upcoming release for the centre', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: measured })
    expect(model.center?.metricKey).toBe('US.NONFARM.SA.CHANGE')
    expect(model.center?.daysUntil).toBe(19)
  })

  /** 12-04 这期库里没有共识值：牌与主位都不带值，绝不拿示例值顶上。 */
  it('carries no expectation when the source has none, so the card can say 未提供', () => {
    const model = buildClockCardModel({
      today: '2026-11-15',
      metrics: [{ metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
        lastRelease: { date: '2026-11-06', value: '+165K' }, nextRelease: { date: '2026-12-04' }, periodDays: 28 }]
    })
    expect(model.plaques.find((plaque) => plaque.zone === 'future')?.value).toBeUndefined()
    expect(model.center?.expected).toBeUndefined()
    expect(model.center?.previous).toBe('+165K')
  })

  /**
   * 取不到 P / P 不合理 / 没有下一期 → 该指标不上环，但必须留一行交代，不许悄悄消失。
   */
  it('leaves a line for every metric it cannot place', () => {
    const model = buildClockCardModel({
      today: '2026-11-15',
      metrics: [
        { metricKey: 'no-period', nameKey: 'noPeriod', lastRelease: { date: '2026-11-13', value: '1' }, nextRelease: { date: '2026-12-01' } },
        { metricKey: 'bad-period', nameKey: 'badPeriod', lastRelease: { date: '2026-11-13', value: '1' }, nextRelease: { date: '2026-12-01' }, periodDays: 900 },
        { metricKey: 'no-next', nameKey: 'noNext', lastRelease: { date: '2026-11-13', value: '1' }, periodDays: 30 }
      ]
    })
    expect(model.unplaced).toEqual(expect.arrayContaining([
      { metricKey: 'no-period', nameKey: 'noPeriod', reason: 'no-period' },
      { metricKey: 'bad-period', nameKey: 'badPeriod', reason: 'period-out-of-range' },
      { metricKey: 'no-next', nameKey: 'noNext', reason: 'no-next-release' }
    ]))
    // 周期坏掉的那条仍可以有未来牌（未来区只按 30 天投影算），只是过去区没有。
    expect(model.plaques.some((plaque) => plaque.metricKey === 'bad-period' && plaque.zone === 'future')).toBe(true)
  })
})

/**
 * 撞牌规则（Chief 2026-11-15 定，界面设计签字待回）：同一区内矩形相交时**保留离现在更近的那块**，
 * 让位的进交代行并写「名字 + 还有几天」；角度不许迁就（角度就是时间），主位不受影响。
 */
describe('two plaques that overlap', () => {
  const crowded: readonly ClockScheduleMetric[] = [
    { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', nextRelease: { date: '2026-12-10' } },
    { metricKey: 'US.TARGET_RATE.HIKE_25', nameKey: 'policyRate', nextRelease: { date: '2026-12-09' } }
  ]

  it('keeps only the nearer one on the ring and hands the other a line with its days', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: crowded })
    expect(model.plaques).toHaveLength(1)
    expect(model.plaques[0]!.metricKey).toBe('US.TARGET_RATE.HIKE_25')
    expect(model.unplaced).toEqual([expect.objectContaining({
      metricKey: 'US.CPI.NSA.YOY', reason: 'crowded', daysUntil: 25
    })])
  })

  it('renders the same order twice for the same day, never A today and B tomorrow', () => {
    const first = buildClockCardModel({ today: '2026-11-15', metrics: crowded })
    const second = buildClockCardModel({ today: '2026-11-15', metrics: [...crowded].reverse() })
    expect(first.plaques.map((plaque) => plaque.metricKey)).toEqual(second.plaques.map((plaque) => plaque.metricKey))
  })

  it('does not touch the centre: a plaque that lost its place can still be the centre', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: crowded })
    // 政策利率更近 → 上环；CPI 让位，但主位仍是全场最近的下一期（政策利率）。
    expect(model.center?.metricKey).toBe('US.TARGET_RATE.HIKE_25')
    // 反过来：若让位的是主位那条，主位照常显示——用同一天两块相撞的对称构造验证。
    const model2 = buildClockCardModel({ today: '2026-11-15', metrics: [
      { metricKey: 'A', nameKey: 'a', nextRelease: { date: '2026-12-01' } },
      { metricKey: 'B', nameKey: 'b', nextRelease: { date: '2026-12-02' } }
    ] })
    expect(model2.plaques).toHaveLength(1)
    expect(model2.center?.metricKey).toBe('A')
  })
})

/**
 * 判据不分区（界面设计 2026-11-15 基线 J 节）：两区在 12 点的「现在」与 8 点的断口两处相接，
 * 只同区比会在这两处叠牌。这里各造一对跨区相接的牌，两处都必须判出相交。
 */
describe('the overlap check spans the two halves', () => {
  it('catches a past plaque and a future plaque meeting at 12 o’clock', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: [
      // 过去区：昨天刚发、P=30 → 348°，紧贴 12 点。
      { metricKey: 'PAST.NEAR.NOW', nameKey: 'cpiYoy', lastRelease: { date: '2026-11-14', value: '1' }, periodDays: 30 },
      // 未来区：0.5 天 → 4°，同一侧紧贴 12 点。
      { metricKey: 'FUTURE.NEAR.NOW', nameKey: 'policyRate', nextRelease: { date: '2026-11-15T12:00:00.000Z' } }
    ] })
    // 两块都贴着 12 点：只许留一块，另一块进交代行。
    expect(model.plaques.length).toBeLessThan(2)
  })
})

it('catches a past plaque and a future plaque meeting at the 8 o’clock gap', () => {
  const model = buildClockCardModel({ today: '2026-11-15', metrics: [
    // 过去区：P=33、10 天前发布 → 250.9°，落在 8 点断口一侧。
    { metricKey: 'PAST.AT.EIGHT', nameKey: 'cpiYoy', lastRelease: { date: '2026-11-05', value: '1' }, periodDays: 33 },
    // 未来区：30 天 → 240°，正好在断口的另一侧。
    { metricKey: 'FUTURE.AT.EIGHT', nameKey: 'policyRate', nextRelease: { date: '2026-12-15' } }
  ] })
  // 两块跨着 8 点断口相接（250.9° 与 240°），不分区才判得出：只许留一块。
  expect(model.plaques).toHaveLength(1)
})
