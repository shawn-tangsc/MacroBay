import { describe, expect, it } from 'vitest'

import {
  buildClockCardModel, clockCardCenter, clockCardGeometry, clockFutureAngle, clockFutureOpacity,
  clockPastAngle, clockPlaqueMaxWidth, clockRingPoint, type ClockScheduleMetric
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

/**
 * 真库 2026-11-15 的三条。**只有 CPI 有盘口预期**，按用户 2026-11-21 的口径，
 * 环上那一个就是它（非农虽然更近，但没有盘口，不进候选池）。
 */
const measured: readonly ClockScheduleMetric[] = [
  { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
    lastRelease: { date: '2026-11-10', value: '3.74%' },
    nextRelease: { date: '2026-12-10', expected: '3.2%', expectedFromMarket: true }, periodDays: 30 },
  { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
    lastRelease: { date: '2026-11-06', value: '+165K' },
    nextRelease: { date: '2026-12-04' }, periodDays: 28 },
  { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate',
    nextRelease: { date: '2026-12-09' }, periodDays: 42 }
]

describe('the model built from real schedule dates', () => {
  /**
   * 政策会议与 CPI 只差一天（真库 12-09 / 12-10）：盒子相交 → **合并成一块**，
   * 两行各写一个日期，距离写较近那个。非农在 12-04，离得够远，各自一块。
   */
  it('merges the policy meeting with the CPI date when they cannot both fit', () => {
    const model = buildClockCardModel({ today: '2026-11-21', metrics: [
      { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
        lastRelease: { date: '2026-11-19', value: '3.74%' },
        nextRelease: { date: '2026-12-10', expected: '3.2%', expectedFromMarket: true }, periodDays: 30 },
      { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
        lastRelease: { date: '2026-11-06', value: '+165K' }, nextRelease: { date: '2026-12-04' }, periodDays: 28 },
      { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate', nextRelease: { date: '2026-12-09' }, periodDays: 42 }
    ] })
    const merged = model.plaques.find((plaque) => plaque.merged !== undefined)!
    expect(merged.merged!.map((entry) => entry.date)).toEqual(['2026-12-09', '2026-12-10'])
    expect(merged.daysUntil).toBe(18)
    // 合并牌也留在卡内（宽按上限算）。
    expect(merged.x - clockPlaqueMaxWidth / 2).toBeGreaterThanOrEqual(0)
    expect(merged.x + clockPlaqueMaxWidth / 2).toBeLessThanOrEqual(clockCardGeometry.cardWidth)
    // 合并不是丢：两个日期都没有进交代行。
    expect(model.unplaced.filter((entry) => entry.reason === 'crowded')).toEqual([])
    expect(model.plaques.some((plaque) => plaque.metricKey === 'US.NONFARM.SA.CHANGE')).toBe(true)
  })

  /** 贴着环边的牌子要夹回卡内：276° 的挂点原值是 33.7，夹取后是 72。 */
  it('clamps a plaque near the ring edge back inside the card', () => {
    const model = buildClockCardModel({ today: '2026-11-21', metrics: [{
      metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
      lastRelease: { date: '2026-11-14', value: '3.74%' }, nextRelease: { date: '2026-12-10' }, periodDays: 30
    }] })
    const past = model.plaques.find((plaque) => plaque.id === 'US.CPI.NSA.YOY:past')!
    expect(Number(past.x.toFixed(2))).toBe(72)
  })

  /** 用户 2026-11-12 定：过去牌与未来牌各判各的，同一指标可以同时占两个位置。 */
  it('lets one metric hold a past plaque and a future plaque at the same time', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: [{
      metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
      lastRelease: { date: '2026-11-10', value: '3.74%' },
      nextRelease: { date: '2026-12-05', expected: '3.2%' }, periodDays: 30
    }] })
    expect(model.plaques.map((plaque) => plaque.id).sort()).toEqual(['US.CPI.NSA.YOY:future', 'US.CPI.NSA.YOY:past'])
  })

  /** 保留期 P/3 是规则：CPI 11-10 发布、P=30 → 10 天后撤掉过去牌（11-21 满 11 天）。 */
  it('retires the past plaque once the retention window has passed, without calling it a gap', () => {
    const model = buildClockCardModel({ today: '2026-11-21', metrics: [{
      metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
      lastRelease: { date: '2026-11-10', value: '3.74%' }, nextRelease: { date: '2026-12-10' }, periodDays: 30
    }] })
    expect(model.plaques.some((plaque) => plaque.id === 'US.CPI.NSA.YOY:past')).toBe(false)
    // 撤掉是规则到点，不是「挂不上去」：不许因此冒出一条交代。
    expect(model.unplaced.some((entry) => entry.metricKey === 'US.CPI.NSA.YOY')).toBe(false)
    // 未来牌不受影响：下一期还在。
    expect(model.plaques.some((plaque) => plaque.id === 'US.CPI.NSA.YOY:future')).toBe(true)
  })

  /**
   * 平时中央是**利率路径面**（用户 2026-11-21 拍板，42 号文件）：不在任何发布窗口内时，
   * 中央显示政策路径，而不是环上那一个指标——环记时间，中央记概率。
   */
  it('shows the policy path face outside the release window', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: measured })
    expect(model.center?.kind).toBe('policy')
    if (model.center?.kind !== 'policy') throw new Error('expected the policy face')
    expect(model.center.meetingDate).toBe('2026-12-09')
    expect(model.center.daysUntil).toBe(24)
    // 这一份夹具里政策读数没有概率：中央写「概率暂未提供」，绝不写 0%。
    expect(model.center.probability).toBeUndefined()
  })

  /**
   * 溢出清单只装**同一天里没被选为代表**的那些：每块牌代表一个发布日，
   * 同一天其余一级指标在这里列全（名字 · 日期 · 几天后）。
   */
  it('lists the same-day indicators that did not become the day’s representative', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: [
      { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy',
        nextRelease: { date: '2026-11-25', expected: '3.1%', expectedFromMarket: true } },
      { metricKey: 'US.CORE_PCE.MOM', nameKey: 'corePceMom', nextRelease: { date: '2026-11-25' } }
    ] })
    const overflow = model.unplaced.filter((entry) => entry.reason === 'not-selected')
    expect(overflow.map((entry) => entry.metricKey)).toEqual(['US.CORE_PCE.MOM'])
    expect(overflow[0]!.date).toBe('2026-11-25')
    expect(overflow[0]!.daysUntil).toBe(10)
  })

  /**
   * 没有盘口预期的日期**也挂**（用户最初就是「一级指标都要放」），只是牌上不显示数字——
   * 不许因为没盘口就把那一天从环上抹掉。
   */
  it('still rings a date whose indicator has no market expectation, without a number', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: measured.map((metric) => ({
      ...metric, nextRelease: metric.nextRelease === undefined ? undefined : { date: metric.nextRelease.date }
    })) })
    expect(model.center?.kind).toBe('policy')
    const payrolls = model.plaques.find((plaque) => plaque.metricKey === 'US.NONFARM.SA.CHANGE')
    expect(payrolls).toBeDefined()
    expect(payrolls!.value).toBeUndefined()
  })
})


/**
 * 环上只放一个指标之后，指标之间不再互相撞牌（撞牌只剩「指标牌 vs 政策牌」这一种情形）。
 * 政策牌照旧单独挂：它不是一级指标，不参与「那一个」的挑选，也不会抢主位。
 */
describe('the policy plaque and the single indicator plaque', () => {
  const policyOnly: readonly ClockScheduleMetric[] = [
    { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate', nextRelease: { date: '2026-12-09' } }
  ]

  it('keeps the policy plaque even when no indicator has a market-implied expectation', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: policyOnly })
    expect(model.plaques.map((plaque) => plaque.metricKey)).toEqual(['US.TARGET_RATE.DECISION'])
    // 没有一级指标候选时，中央就是**利率路径面**——政策牌本来就在讲这件事。
    expect(model.center?.kind).toBe('policy')
  })

  it('rings the market-implied indicator and the policy plaque, and nothing else', () => {
    const model = buildClockCardModel({ today: '2026-11-15', metrics: [
      { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy',
        nextRelease: { date: '2026-11-25', expected: '3.2%', expectedFromMarket: true } },
      { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate', nextRelease: { date: '2026-12-09' } }
    ] })
    expect(model.plaques.map((plaque) => plaque.metricKey).sort())
      .toEqual(['US.CORE_PCE.YOY', 'US.TARGET_RATE.DECISION'])
    // 不在窗口内：中央仍是利率路径面（窗口那条另有用例）。
    expect(model.center?.kind).toBe('policy')
  })
})

/**
 * 中央的 ±24 小时窗口（用户 2026-11-21 拍板，42 号文件 §二）。
 *
 * 判据是**发布时刻**前后各 24 小时，不是日期；窗口内环上那一个跟随中央，
 * 窗口外恢复「有盘口预期优先」。两个窗口不是同一个数，别混。
 */
describe('the centre switches to the indicator only inside the release window', () => {
  /** CPI 11-10 14:30Z 发布，有结果；下一期 12-10 也只有日期（不参与窗口）。 */
  const windowed: readonly ClockScheduleMetric[] = [
    { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
      lastRelease: { date: '2026-11-10', at: '2026-11-10T14:30:00.000Z', value: '3.74%' },
      nextRelease: { date: '2026-12-10', expected: '3.2%', expectedFromMarket: true },
      periodDays: 30,
      actualValue: '3.74%', previousValue: '3.50%', consensusValue: '3.60%',
      deltaAmount: '+0.14pp', deltaDirection: 'above' },
    { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
      lastRelease: { date: '2026-11-06', at: '2026-11-06T13:30:00.000Z', value: '+165K' },
      nextRelease: { date: '2026-12-04', at: '2026-12-04T13:30:00.000Z' }, periodDays: 28 },
    { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate', nextRelease: { date: '2026-12-09' }, periodDays: 42 }
  ]

  it('takes the indicator face two hours after its release, with the result', () => {
    const model = buildClockCardModel({ today: '2026-11-10', now: '2026-11-10T16:30:00.000Z', metrics: windowed })
    expect(model.center?.kind).toBe('metric')
    if (model.center?.kind !== 'metric') throw new Error('expected the metric face')
    expect(model.center.metricKey).toBe('US.CPI.NSA.YOY')
    expect(model.center.phase).toBe('released')
    expect(model.center.result).toBe('3.74%')
    expect(model.center.consensus).toBe('3.60%')
    expect(model.center.previous).toBe('3.50%')
    expect(model.center.delta).toBe('+0.14pp')
    expect(model.center.deltaDirection).toBe('above')
    // 窗口内环上跟随中央：CPI 必须在环上。
    expect(model.plaques.some((plaque) => plaque.metricKey === 'US.CPI.NSA.YOY')).toBe(true)
  })

  it('shows the expectation four hours before the release, and keeps the ring on the same indicator', () => {
    // 非农 11-06 13:30Z 发布；09:30Z 是发布前 4 小时。它没有盘口，但窗口内仍然上环。
    const model = buildClockCardModel({ today: '2026-11-06', now: '2026-11-06T09:30:00.000Z', metrics: windowed })
    expect(model.center?.kind).toBe('metric')
    if (model.center?.kind !== 'metric') throw new Error('expected the metric face')
    expect(model.center.metricKey).toBe('US.NONFARM.SA.CHANGE')
    expect(model.center.phase).toBe('upcoming')
    expect(model.center.previous).toBe('+165K')
    expect(model.plaques.some((plaque) => plaque.metricKey === 'US.NONFARM.SA.CHANGE')).toBe(true)
  })

  it('stays on the indicator past its time when no result has arrived yet', () => {
    const noResult = windowed.map((metric) => metric.metricKey === 'US.NONFARM.SA.CHANGE'
      ? { ...metric, actualValue: undefined }
      : metric)
    const model = buildClockCardModel({ today: '2026-11-06', now: '2026-11-06T15:30:00.000Z', metrics: noResult })
    expect(model.center?.kind).toBe('metric')
    if (model.center?.kind !== 'metric') throw new Error('expected the metric face')
    expect(model.center.phase).toBe('overdue')
  })

  it('goes back to the policy path once the window has passed', () => {
    // 非农发布后 25 小时：窗口已过。
    const model = buildClockCardModel({ today: '2026-11-07', now: '2026-11-07T14:31:00.000Z', metrics: windowed })
    expect(model.center?.kind).toBe('policy')
  })

  it('picks the release nearest to now when two indicators are inside the window', () => {
    const twoInside: readonly ClockScheduleMetric[] = [
      { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', nextRelease: { date: '2026-11-11', at: '2026-11-11T12:00:00.000Z', expected: '3.2%' } },
      { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls', nextRelease: { date: '2026-11-11', at: '2026-11-11T09:00:00.000Z', expected: '+90K' } }
    ]
    // 09:00Z 那一刻离非农更近（0 分钟）而不是 CPI（3 小时）。
    const model = buildClockCardModel({ today: '2026-11-11', now: '2026-11-11T09:00:00.000Z', metrics: twoInside })
    expect(model.center?.kind).toBe('metric')
    if (model.center?.kind !== 'metric') throw new Error('expected the metric face')
    expect(model.center.metricKey).toBe('US.NONFARM.SA.CHANGE')
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
  // 同一个指标（环上那一个，必须有盘口才会上环）的过去牌与未来牌跨着 8 点断口相接：
  // 过去 P=33、10 天前发布 → 250.9°；未来 30 天 → 240°。不分区才判得出，只许留一块。
  const model = buildClockCardModel({ today: '2026-11-15', metrics: [{
    metricKey: 'RING.METRIC', nameKey: 'cpiYoy',
    lastRelease: { date: '2026-11-05', value: '1' }, periodDays: 33,
    nextRelease: { date: '2026-12-15', expected: '1.0%', expectedFromMarket: true }
  }] })
  expect(model.plaques).toHaveLength(1)
})

/**
 * 环上**每个发布日一块牌**（用户 2026-11-21 更正：CPI、非农不能因为 PCE 更近就消失）。
 * 「只一个」指同一天里只留一个；没有盘口的日期也挂，只是不显示数字。
 */
describe('the ring hangs one plaque per release date', () => {
  const threeDays: readonly ClockScheduleMetric[] = [
    { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy',
      nextRelease: { date: '2026-11-25', expected: '3.12%', expectedFromMarket: true } },
    { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls',
      nextRelease: { date: '2026-12-04' } },
    { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy',
      nextRelease: { date: '2026-12-10', expected: '2.9%', expectedFromMarket: true } }
  ]

  it('rings core PCE, payrolls and CPI on their own dates', () => {
    const model = buildClockCardModel({ today: '2026-11-21', metrics: threeDays })
    expect(model.plaques.filter((plaque) => plaque.zone === 'future').map((plaque) => plaque.metricKey).sort())
      .toEqual(['US.CORE_PCE.YOY', 'US.CPI.NSA.YOY', 'US.NONFARM.SA.CHANGE'])
    // 三块都在环上：谁也不是「不在环上」。
    expect(model.unplaced.filter((entry) => entry.reason === 'not-selected')).toEqual([])
  })

  it('keeps one plaque per day and prefers the one with a market expectation', () => {
    const model = buildClockCardModel({ today: '2026-11-21', metrics: [
      { metricKey: 'US.CORE_PCE.MOM', nameKey: 'corePceMom',
        nextRelease: { date: '2026-11-25', expected: '0.2%', expectedFromMarket: true } },
      { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy', nextRelease: { date: '2026-11-25' } }
    ] })
    expect(model.plaques.filter((plaque) => plaque.zone === 'future').map((plaque) => plaque.metricKey))
      .toEqual(['US.CORE_PCE.MOM'])
    // 同一天没被选为代表的那个进溢出行（不是「放不下」）。
    expect(model.unplaced.filter((entry) => entry.reason === 'not-selected').map((entry) => entry.metricKey))
      .toEqual(['US.CORE_PCE.YOY'])
  })

  it('still rings a date whose indicator has no market expectation, without a value', () => {
    const model = buildClockCardModel({ today: '2026-11-21', metrics: [threeDays[1]!] })
    const plaque = model.plaques.find((entry) => entry.metricKey === 'US.NONFARM.SA.CHANGE')!
    expect(plaque).toBeDefined()
    expect(plaque.value).toBeUndefined()
  })

  /** 长名字（`核心 PCE 年率（季调）`）不许顶出卡边：牌宽按上限算，位置再夹一次。 */
  it('keeps a long plaque name inside the card', () => {
    const model = buildClockCardModel({ today: '2026-11-21', metrics: [
      { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy', nextRelease: { date: '2026-11-25' } }
    ] })
    const plaque = model.plaques[0]!
    expect(plaque.x - clockPlaqueMaxWidth / 2).toBeGreaterThanOrEqual(0)
    expect(plaque.x + clockPlaqueMaxWidth / 2).toBeLessThanOrEqual(clockCardGeometry.cardWidth)
  })
})
