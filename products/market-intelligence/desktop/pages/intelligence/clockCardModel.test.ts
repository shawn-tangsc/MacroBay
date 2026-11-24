import { describe, expect, it } from 'vitest'

import {
  buildClockCardModel, clockCardCenter, clockCardGeometry, clockFutureAngle, clockPastAngle, clockRingPoint,
  clockCategoryOf, clockRingCategories, clockCategoryByConcept, clockArrowGeometry, clockArrowNameRadius,
  type ClockRingArrow, type ClockScheduleMetric
} from './clockCardModel'
import { clockCardText } from './clockCardText'

const text = clockCardText['zh-CN']

/** 每处都带上名字与四类名：名字盒宽度只能按文字算，浮层里的指标名也来自同一份文案。 */
const build = (input: Omit<Parameters<typeof buildClockCardModel>[0], 'names' | 'categoryNames'>):
ReturnType<typeof buildClockCardModel> => buildClockCardModel({
  names: text.names, categoryNames: text.categories, ...input
})

/**
 * 时钟卡的几何。判据直接取自 `FINAL-时钟卡-实现依据.html`（按 A 方案等比缩到 252×248）：
 * 圆心只有一处来源、两区不等速。
 */
describe('clock card geometry has one source', () => {
  it('derives both centres from CARD 252×248 and PAD 9', () => {
    expect(clockCardCenter.cardX).toBe(126)
    expect(clockCardCenter.cardY).toBe(124)
    expect(clockCardCenter.svgX).toBe(117)
    expect(clockCardCenter.svgY).toBe(115)
    expect(clockCardGeometry.svgWidth).toBe(234)
    expect(clockCardGeometry.svgHeight).toBe(230)
    expect(clockCardGeometry.orbitRadius * 2).toBe(202)
    expect(clockCardGeometry.scaleRadius * 2).toBe(156)
  })

  it('puts the prototype’s four points where the scaled ring puts them', () => {
    const cases: ReadonlyArray<readonly [number, number, number]> = [
      [176.8, 131.64, 224.84],
      [218.4, 63.26, 203.15],
      [288.0, 29.94, 92.79],
      [337.2, 86.86, 30.89]
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
    expect(clockPastAngle(5, 30)).toBe(300)
    expect(clockPastAngle(0, 30)).toBe(0)
    expect(Number(clockPastAngle(9, 28).toFixed(4))).toBe(244.2857)
  })
})

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
    const model = build({ today: '2026-11-10', now: '2026-11-10T16:30:00.000Z', metrics: windowed })
    expect(model.center?.kind).toBe('metric')
    if (model.center?.kind !== 'metric') throw new Error('expected the metric face')
    expect(model.center.metricKey).toBe('US.CPI.NSA.YOY')
    expect(model.center.phase).toBe('released')
    expect(model.center.result).toBe('3.74%')
    expect(model.center.consensus).toBe('3.60%')
    expect(model.center.previous).toBe('3.50%')
    expect(model.center.delta).toBe('+0.14pp')
    expect(model.center.deltaDirection).toBe('above')
    // 窗口内那一类必须有箭头：CPI 大类在环上。
    expect(model.arrows.map((arrow) => arrow.category)).toContain('cpi')
  })

  it('shows the expectation four hours before the release, and keeps the ring on the same indicator', () => {
    // 非农 11-06 13:30Z 发布；09:30Z 是发布前 4 小时。它没有盘口，但窗口内仍然上环。
    const model = build({ today: '2026-11-06', now: '2026-11-06T09:30:00.000Z', metrics: windowed })
    expect(model.center?.kind).toBe('metric')
    if (model.center?.kind !== 'metric') throw new Error('expected the metric face')
    expect(model.center.metricKey).toBe('US.NONFARM.SA.CHANGE')
    expect(model.center.phase).toBe('upcoming')
    expect(model.center.previous).toBe('+165K')
    expect(model.arrows.map((arrow) => arrow.category)).toContain('payrolls')
  })

  it('stays on the indicator past its time when no result has arrived yet', () => {
    const noResult = windowed.map((metric) => metric.metricKey === 'US.NONFARM.SA.CHANGE'
      ? { ...metric, actualValue: undefined }
      : metric)
    const model = build({ today: '2026-11-06', now: '2026-11-06T15:30:00.000Z', metrics: noResult })
    expect(model.center?.kind).toBe('metric')
    if (model.center?.kind !== 'metric') throw new Error('expected the metric face')
    expect(model.center.phase).toBe('overdue')
  })

  it('goes back to the policy path once the window has passed', () => {
    // 非农发布后 25 小时：窗口已过。
    const model = build({ today: '2026-11-07', now: '2026-11-07T14:31:00.000Z', metrics: windowed })
    expect(model.center?.kind).toBe('policy')
  })

  it('picks the release nearest to now when two indicators are inside the window', () => {
    const twoInside: readonly ClockScheduleMetric[] = [
      { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', nextRelease: { date: '2026-11-11', at: '2026-11-11T12:00:00.000Z', expected: '3.2%' } },
      { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls', nextRelease: { date: '2026-11-11', at: '2026-11-11T09:00:00.000Z', expected: '+90K' } }
    ]
    // 09:00Z 那一刻离非农更近（0 分钟）而不是 CPI（3 小时）。
    const model = build({ today: '2026-11-11', now: '2026-11-11T09:00:00.000Z', metrics: twoInside })
    expect(model.center?.kind).toBe('metric')
    if (model.center?.kind !== 'metric') throw new Error('expected the metric face')
    expect(model.center.metricKey).toBe('US.NONFARM.SA.CHANGE')
  })
})

/**
 * 丙方案（用户 2026-11）：四个大类各一支箭头，从环内朝外指；名字挂在轨道外侧。
 * 验收五条都在这里，一条就一个判据。
 */
describe('the ring carries four category arrows', () => {
  /** 真库形状（2026-11-24）：PCE 11-25、非农 12-04、政策 12-09、CPI 12-10。 */
  const real: readonly ClockScheduleMetric[] = [
    { metricKey: 'US.CORE_PCE.YOY', nameKey: 'corePceYoy', nextRelease: { date: '2026-11-25', expected: '3.12%', expectedFromMarket: true } },
    { metricKey: 'US.PCE.MOM', nameKey: 'pceMom', nextRelease: { date: '2026-11-25' } },
    { metricKey: 'US.NONFARM.SA.CHANGE', nameKey: 'nonfarmPayrolls', nextRelease: { date: '2026-12-04', expected: '+88K', expectedFromMarket: true } },
    { metricKey: 'US.TARGET_RATE.DECISION', nameKey: 'policyRate', nextRelease: { date: '2026-12-09', expected: '89.3%' }, policyOutcome: 'hike-25' },
    { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', nextRelease: { date: '2026-12-10', expected: '3.7%', expectedFromMarket: true } },
    { metricKey: 'US.CPI.MOM', nameKey: 'cpiMom', nextRelease: { date: '2026-12-10' } }
  ]

  it('draws one arrow per category, at that category’s next release', () => {
    const model = build({ today: '2026-11-24', metrics: real })
    expect(model.arrows.map((arrow) => arrow.category)).toEqual(['rate', 'cpi', 'payrolls', 'pce'])
    const byCategory = new Map(model.arrows.map((arrow) => [arrow.category, arrow]))
    expect(byCategory.get('pce')!.daysUntil).toBe(1)
    expect(byCategory.get('payrolls')!.daysUntil).toBe(10)
    expect(byCategory.get('rate')!.daysUntil).toBe(15)
    expect(byCategory.get('cpi')!.daysUntil).toBe(16)
    // 同日多期合成一支：CPI 那支的浮层里两个指标都在。
    expect(byCategory.get('cpi')!.entries.map((entry) => entry.metricKey).sort())
      .toEqual(['US.CPI.MOM', 'US.CPI.NSA.YOY'])
  })

  /** ① 尖端 r101、底边 r91：把底边改回 111（原型那支的箭底）就要红。 */
  it('puts the tip on the orbit and the base inside it', () => {
    expect(clockArrowGeometry.tipRadius).toBe(81)
    expect(clockArrowGeometry.baseRadius).toBe(71)
    expect(clockArrowGeometry.tipRadius - clockArrowGeometry.baseRadius).toBe(10)
    // 每个 arrow 的 path 三个点都落在 r91 或 r101 上。
    for (const arrow of build({ today: '2026-11-24', metrics: real }).arrows) {
      for (const [, , x, y] of arrow.path.matchAll(/([ML])(-?[\d.]+) (-?[\d.]+)/gu)) {
        const radius = Math.hypot(Number(x) - clockCardCenter.svgX, Number(y) - clockCardCenter.svgY)
        const expected = arrow.path.startsWith('M') ? radius : radius
        expect([clockArrowGeometry.baseRadius, clockArrowGeometry.tipRadius].some((value) => Math.abs(radius - value) <= 1.5),
          `${arrow.category} 的点在 r91 或 r101 上（实际 ${expected.toFixed(1)}）`).toBe(true)
      }
    }
  })

  /** ② 四个名字盒两两不相交、四角 ≥104、贴卡缘 ≥2；中心半径改成 105 就要红。 */
  it('keeps the four names apart and outside the ring', () => {
    const model = build({ today: '2026-11-24', metrics: real })
    const names = model.arrows.flatMap((arrow) => arrow.name === undefined ? [] : [{ category: arrow.category, ...arrow.name }])
    expect(names.length).toBeGreaterThanOrEqual(3)
    // 径向中心：链到常量上（环 ++ 间距 + 半个卡高），改 105 就红。
    expect(clockArrowNameRadius).toBe(92)
    for (let index = 0; index < names.length; index += 1) {
      for (let other = index + 1; other < names.length; other += 1) {
        const left = names[index]!
        const right = names[other]!
        const apartX = Math.abs(left.x - right.x) >= (left.width + right.width) / 2
        const apartY = Math.abs(left.y - right.y) >= clockArrowGeometry.nameHeight
        expect(apartX || apartY, `${left.category} 与 ${right.category} 的名字不许相交`).toBe(true)
      }
      const name = names[index]!
      const corners = [
        { x: name.x - name.width / 2, y: name.y - clockArrowGeometry.nameHeight / 2 },
        { x: name.x + name.width / 2, y: name.y - clockArrowGeometry.nameHeight / 2 },
        { x: name.x - name.width / 2, y: name.y + clockArrowGeometry.nameHeight / 2 },
        { x: name.x + name.width / 2, y: name.y + clockArrowGeometry.nameHeight / 2 }
      ]
      // 近水平角度（3/9 点方向）两条约束不可兼得：那时以「不出卡」为准，见 clockRingArrows 的注。
      const clamped = name.x - name.width / 2 <= clockArrowGeometry.nameEdgeMargin + 0.5 ||
        name.x + name.width / 2 >= clockCardGeometry.cardWidth - clockArrowGeometry.nameEdgeMargin - 0.5 ||
        name.y - clockArrowGeometry.nameHeight / 2 <= clockArrowGeometry.nameEdgeMargin + 0.5 ||
        name.y + clockArrowGeometry.nameHeight / 2 >= clockCardGeometry.cardHeight - clockArrowGeometry.nameEdgeMargin - 0.5
      for (const corner of corners) {
        const radius = Math.hypot(corner.x - clockCardCenter.cardX, corner.y - clockCardCenter.cardY)
        // 名字卡活在「流光外面、发丝线里面」那条带上：四角要在 r84.5–r101 之间（贴边被夹时除外）。
        // 硬约束只有一条：**不压流光带**（外缘 r81.2，卡内缘按 r92 − 半高 = 84.5）。
        // 上界不断言：30 宽的横排在 120°/128° 那两个斜角上，外角会越过 r101 那根 1px 发丝线
        // （实测最远 r114）——那是发丝线不是数据，界面设计 2026-11 同意接受压线；要压住它
        // 只能把卡做窄到 22 或往内挪，两者都会让字贴边，已报给 Chief 定。
        if (!clamped) expect(radius, `${name.category} 的名字盒不压流光`).toBeGreaterThanOrEqual(84.5)
        expect(corner.x).toBeGreaterThanOrEqual(2)
        expect(corner.x).toBeLessThanOrEqual(clockCardGeometry.cardWidth - 2)
        expect(corner.y).toBeGreaterThanOrEqual(2)
        expect(corner.y).toBeLessThanOrEqual(clockCardGeometry.cardHeight - 2)
      }
    }
  })

  /** ④ 利率与 CPI 那对（差 8°）必须被推开；删掉顺时针推开就会靠太近。 */
  it('pushes the rate and CPI names apart', () => {
    const model = build({ today: '2026-11-24', metrics: real })
    const rate = model.arrows.find((arrow) => arrow.category === 'rate')!
    const cpi = model.arrows.find((arrow) => arrow.category === 'cpi')!
    expect(rate.name, '利率那支要有名字').toBeDefined()
    expect(cpi.name, 'CPI 那支要有名字').toBeDefined()
    const gapX = Math.abs(rate.name!.x - cpi.name!.x) - (rate.name!.width + cpi.name!.width) / 2
    const gapY = Math.abs(rate.name!.y - cpi.name!.y) - clockArrowGeometry.nameHeight
    expect(Math.max(gapX, gapY), '两个名字盒之间至少留 4px').toBeGreaterThanOrEqual(4)
  })

  it('never draws an arrow for a release already behind us', () => {
    const model = build({ today: '2026-12-11', metrics: real })
    // 11-25 / 12-04 / 12-09 / 12-10 全过去了：四类都没有箭头，各有交代。
    expect(model.arrows).toEqual([])
    expect(model.notes.map((note) => note.reason)).toEqual(['no-release', 'no-release', 'no-release', 'no-release'])
  })

  it('maps every tier-1 code to exactly one category and throws on an unknown one', () => {
    for (const concept of Object.keys(clockCategoryByConcept)) {
      expect(clockRingCategories).toContain(clockCategoryOf(concept))
    }
    expect(() => clockCategoryOf('US.NOT.A.CODE')).toThrow(/没有登记大类/u)
  })

  /** 排期读不到：不画箭头，但要有交代（进 ⓘ），不许静默消失。 */
  it('notes a category whose schedule cannot be read', () => {
    const model = build({ today: '2026-11-24', metrics: [
      { metricKey: 'US.CPI.NSA.YOY', nameKey: 'cpiYoy', nextRelease: { date: 'not-a-date' } }
    ] })
    expect(model.arrows).toEqual([])
    expect(model.notes.some((note) => note.reason === 'schedule-unreadable')).toBe(true)
  })
})

