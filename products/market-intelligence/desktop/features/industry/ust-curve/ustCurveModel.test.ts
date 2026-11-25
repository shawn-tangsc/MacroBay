import { describe, expect, it } from 'vitest'

import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroRatesReading, MacroRatesSnapshotView } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import { tooltipLeft } from '../../../shared/chart/tooltipPlacement'
import {
  buildUstCurve, buildUstRows, changeSet, UST_TOOLTIP_EDGE, UST_TOOLTIP_OFFSET, UST_TOOLTIP_WIDTH,
  ustCurveRanges, ustObservationDates, ustTablePeriod, ustTooltipLeft
} from './ustCurveModel'

const series = macroRatesSnapshotPublicPolicy.series

/** `count` 个交易日，从 2026-01-02 起每个工作日一个；值按传入函数递增，便于读回 bp。 */
function window(count: number, valueAt: (index: number) => number, start = '2026-01-02') {
  const days: string[] = []
  const cursor = new Date(`${start}T00:00:00.000Z`)
  while (days.length < count) {
    const weekday = cursor.getUTCDay()
    if (weekday !== 0 && weekday !== 6) days.push(cursor.toISOString().slice(0, 10))
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return days.map((period, index) => ({ period, value: valueAt(index) }))
}

function reading(seriesId: string, overrides: Partial<MacroRatesReading> = {}): MacroRatesReading {
  const points = overrides.window ?? window(3, (index) => 4 + index / 100)
  const last = points[points.length - 1]!
  return {
    seriesId,
    metricKey: (macroRatesSnapshotPublicPolicy.metricKeys as Record<string, string>)[seriesId]!,
    actual: last.value,
    period: last.period,
    window: points,
    ...overrides
  }
}

function snapshot(overrides: Partial<Extract<MacroRatesSnapshotView, { state: 'available' | 'empty' }>> = {}): MacroRatesSnapshotView {
  return {
    state: 'available', asOf: '2026-11-22T00:00:00.000Z',
    readings: [reading(series.us10y)], spreads: [], caveats: ['official-daily-close'], ...overrides
  }
}

describe('ust curve model: rows', () => {
  it('lays out nine rows in the order the card reads them', () => {
    const rows = buildUstRows({ snapshot: snapshot() })

    expect(rows.map((row) => row.id)).toEqual([
      '3m', '2y', '5y', '10y', '30y', '10y-2y', '10y-3m', 'real', 'breakeven'
    ])
    // 价差段与分解段各起一条实线；其余行不画。
    expect(rows.filter((row) => row.block).map((row) => row.id)).toEqual(['10y-2y', 'real'])
  })

  it('says 未接入 only when the series is not admitted, and 暂时读不到 when it is admitted but absent', () => {
    const rows = buildUstRows({ snapshot: snapshot(), admittedSeriesIds: [series.us10y, series.us2y] })
    const byId = new Map(rows.map((row) => [row.id, row]))
    // 契约里没有 3M：这是「未接入」。
    expect(byId.get('3m')?.availability.state).toBe('not-connected')
    // 2Y 在契约里，但这次快照没有它：这是「暂时读不到」，不许写成未接入。
    expect(byId.get('2y')?.availability.state).toBe('unreadable')
    expect(byId.get('10y')?.availability.state).toBe('values')
  })

  it('puts the latest level in the newest cell and every change in bp', () => {
    // 窗口末值 4.32；1 日前 4.28（+4bp）、1 周前 4.10（+22bp）、1 月前 4.10、1 年前 4.05（+27bp）。
    const points = window(260, () => 4.32)
    const at = (backFromEnd: number) => points.length - 1 - backFromEnd
    points[at(1)] = { period: points[at(1)]!.period, value: 4.28 }
    points[at(5)] = { period: points[at(5)]!.period, value: 4.1 }
    points[at(21)] = { period: points[at(21)]!.period, value: 4.1 }
    points[at(252)] = { period: points[at(252)]!.period, value: 4.05 }
    const rows = buildUstRows({ snapshot: snapshot({ readings: [reading(series.us10y, { window: points })] }) })
    const availability = rows[3]!.availability

    expect(availability.state).toBe('values')
    if (availability.state !== 'values') throw new Error('expected values')
    expect(availability.latest).toEqual({ kind: 'percent', value: 4.32 })
    expect(availability.changes).toEqual({ d1: 4, w1: 22, m1: 22, y1: 27 })
  })

  it('prefers the contract previous for the one-day change, and leaves a short window empty', () => {
    const points = window(2, () => 4.2)
    const changes = changeSet(points, 4.16)

    expect(changes.d1).toBe(4)
    // 周/月/年窗口不够：是「还没有这么久的历史」，不是 0。
    expect(changes.w1).toBeNull()
    expect(changes.m1).toBeNull()
    expect(changes.y1).toBeNull()
  })

  it('states a spread in basis points, and leaves it empty when a leg is missing or the days differ', () => {
    const points = window(3, (index) => 5 + index / 100)
    const twoYear = window(3, () => 4.6)
    const withSpread = buildUstRows({
      snapshot: snapshot({
        readings: [reading(series.us10y, { window: points }), reading(series.us2y, { window: twoYear }), reading(series.us3m, { window: window(3, () => 4.3) })],
        spreads: [{
          key: 'us10y-minus-us2y', actual: 0.42, previous: 0.4, period: points[2]!.period,
          window: [{ period: points[1]!.period, value: 0.4 }, { period: points[2]!.period, value: 0.42 }]
        }]
      })
    })
    const spread = withSpread.find((row) => row.id === '10y-2y')!.availability
    expect(spread.state).toBe('values')
    if (spread.state !== 'values') throw new Error('expected values')
    expect(spread.latest).toEqual({ kind: 'basis-points', value: 42 })

    // 缺 3M 那条腿 → 10Y−3M 留空，原因指向那条腿。
    const missingLeg = buildUstRows({
      snapshot: snapshot({ readings: [reading(series.us10y, { window: points }), reading(series.us2y, { window: twoYear })] })
    }).find((row) => row.id === '10y-3m')!.availability
    expect(missingLeg).toEqual({ state: 'gap', gap: { kind: 'leg-missing', legKey: 'rows.3m' } })

    // 两条腿都在，但最后观测日不同 → 日期不一致。
    const differ = buildUstRows({
      snapshot: snapshot({
        readings: [
          reading(series.us10y, { window: points }),
          reading(series.us2y, { window: window(3, () => 4.6, '2026-02-02') })
        ]
      })
    }).find((row) => row.id === '10y-2y')!.availability
    expect(differ).toEqual({ state: 'gap', gap: { kind: 'dates-differ' } })
  })
})

describe('ust curve model: windows and footer dates', () => {
  const fiveTenors = snapshot({
    readings: [
      reading(series.us3m, { window: window(300, () => 4.3) }),
      reading(series.us2y, { window: window(300, () => 4.1) }),
      reading(series.us5y, { window: window(300, () => 4.2) }),
      reading(series.us10y, { window: window(300, (index) => 4 + index / 100) }),
      reading(series.us30y, { window: window(300, () => 4.5) }),
      reading(series.real10y, { window: window(300, () => 1.9) }),
      reading(series.breakeven10y, { window: window(3, () => 2.4) })
    ]
  })

  it('slices the same window for all four periods, one point more than the look-back', () => {
    const rows = buildUstRows({ snapshot: fiveTenors })
    expect(ustCurveRanges.map((range) => range.points)).toEqual([6, 22, 63, 253])

    for (const [range, points] of [['1w', 6], ['1m', 22], ['3m', 63], ['1y', 253]] as const) {
      const curve = buildUstCurve({ rows, range, mode: 'level' })
      expect(curve.series).toHaveLength(5)
      expect(curve.days).toHaveLength(points)
      // 1 年窗口的第一点＝表里 1 年列的基准那一天（同一份窗口，不差一天）。
      const full = window(300, () => 4.3)
      expect(curve.days[0]).toBe(full[full.length - points]!.period)
      // 水平模式没有基准：那是归一才有的口径。
      expect(curve.baseline).toBeUndefined()
    }
  })

  it('draws the five tenors only: spreads and the real yield stay out of the curve', () => {
    const rows = buildUstRows({ snapshot: fiveTenors })
    const curve = buildUstCurve({ rows, range: '1m', mode: 'level' })

    expect(curve.series.map((entry) => entry.id)).toEqual(['3m', '2y', '5y', '10y', '30y'])
  })

  it('normalizes from the earliest day every drawn line has a value, in basis points', () => {
    const rows = buildUstRows({ snapshot: fiveTenors })
    const normalized = buildUstCurve({ rows, range: '1m', mode: 'normalized' })
    const ten = normalized.series.find((entry) => entry.id === '10y')!

    expect(normalized.baseline).toEqual({ kind: 'common', period: normalized.days[0] })
    expect(ten.values[0]).toBe(0)
    // 每点 +0.01 个百分点，末点相对首点是 21bp（四舍五入到 0.1bp）。
    expect(ten.values.at(-1)).toBe(21)
    expect(normalized.days).toHaveLength(22)
  })

  it('starts the normalized curve at the common base, never at one line\'s earlier first day', () => {
    // 10Y 的历史比 3M 短：两条线的窗口尾端同一天，首日不同。
    const shortTen = snapshot({
      readings: [
        reading(series.us3m, { window: window(120, () => 4.3) }),
        reading(series.us10y, { window: window(40, (index) => 4 + index / 100, '2026-06-01') })
      ]
    })
    const rows = buildUstRows({ snapshot: shortTen })
    const normalized = buildUstCurve({ rows, range: '3m', mode: 'normalized' })
    const base = window(40, () => 4, '2026-06-01')[0]!.period

    // 基准日＝所有画出来的线都有值的最早一天；页脚只有一格，写别的日期就是在说谎。
    expect(normalized.baseline).toEqual({ kind: 'common', period: base })
    // 五条线都从这天起画：横轴不再包含 10Y 还没有数据的那些日子。
    expect(normalized.days[0]).toBe(base)
    for (const line of normalized.series) expect(line.values[0]).toBe(0)
    const ten = normalized.series.find((entry) => entry.id === '10y')!
    expect(ten.values.at(-1)).toBe(39) // 每点 +0.01 个百分点 → 39bp
  })

  it('falls back to each line\'s own first day only when the lines share no day at all', () => {
    const split = snapshot({
      readings: [
        reading(series.us3m, { window: window(30, () => 4.3, '2026-01-02') }),
        reading(series.us10y, { window: window(30, (index) => 4 + index / 100, '2026-06-01') })
      ]
    })
    const normalized = buildUstCurve({ rows: buildUstRows({ snapshot: split }), range: '1m', mode: 'normalized' })

    expect(normalized.baseline).toEqual({ kind: 'per-line' })
    const three = normalized.series.find((entry) => entry.id === '3m')!
    const ten = normalized.series.find((entry) => entry.id === '10y')!
    // 各自从自己的首点归零；中间没有它的那些日子仍是空档，不是 0。
    expect(three.values[0]).toBe(0)
    expect(three.values[22]).toBeNull()
    expect(ten.values[21]).toBeNull()
    expect(ten.values[22]).toBe(0)
  })

  it('reports one observation date only when every drawn series agrees, otherwise the sorted range', () => {
    const rows = buildUstRows({ snapshot: fiveTenors })
    // 通胀补偿慢一天：页脚写区间，那一行自己带「截至」。
    expect(ustObservationDates(rows)).toEqual([window(3, () => 2.4).at(-1)!.period, window(300, () => 4.3).at(-1)!.period].sort())
    expect(rows.find((row) => row.id === 'breakeven')?.availability.state).toBe('values')
  })

  it('takes the table day from the rows that share it, not from the one series that prints a day later', () => {
    // 真实库形状：六条（五个期限 + 实际利率）在 11-19，通胀补偿在 11-20。全表那一天是 11-19，
    // 只有通胀补偿那一行与它不同——不是反过来把六行逐行标成「截至 11-19」。
    const at = (seriesId: string, days: readonly [string, string]) =>
      reading(seriesId, { window: [{ period: days[0], value: 4.2 }, { period: days[1], value: 4.3 }] })
    const rows = buildUstRows({
      snapshot: snapshot({
        readings: [
          at(series.us3m, ['2026-11-13', '2026-11-19']),
          at(series.us2y, ['2026-11-13', '2026-11-19']),
          at(series.us5y, ['2026-11-13', '2026-11-19']),
          at(series.us10y, ['2026-11-13', '2026-11-19']),
          at(series.us30y, ['2026-11-13', '2026-11-19']),
          at(series.real10y, ['2026-11-13', '2026-11-19']),
          at(series.breakeven10y, ['2026-11-13', '2026-11-20'])
        ]
      })
    })
    expect(ustTablePeriod(rows)).toBe('2026-11-19')
    // 两个观测日都真实存在，页脚照旧写区间。
    expect(ustObservationDates(rows)).toEqual(['2026-11-19', '2026-11-20'])
  })

  it('falls back to the later day when the table day is a tie', () => {
    const at = (seriesId: string, end: string) =>
      reading(seriesId, { window: [{ period: '2026-11-13', value: 4.2 }, { period: end, value: 4.3 }] })
    const rows = buildUstRows({
      snapshot: snapshot({ readings: [at(series.us10y, '2026-11-19'), at(series.breakeven10y, '2026-11-20')] })
    })
    // 一半一半时不把「更新的那一天」标成异常：基准取较晚的那天，慢的那行才该带 as-of。
    expect(ustTablePeriod(rows)).toBe('2026-11-20')
  })
})

/**
 * 这张卡只报三个数，翻转规则在 `shared/chart/tooltipPlacement`（那一整套用例跟着搬过去了）。
 * 这里钉「传的是哪三个数」，免得有人把 offset 与 inset 传反、或哪天规则搬回来又长出一份。
 */
describe('光字牌定位的入参', () => {
  it('传的是 210 宽、12 偏移、6 边距，并原样交给共用规则', () => {
    expect(UST_TOOLTIP_WIDTH).toBe(210)
    expect(UST_TOOLTIP_OFFSET).toBe(12)
    expect(UST_TOOLTIP_EDGE).toBe(6)
    const cases = [[300, 800], [572, 800], [573, 800], [688, 800], [200, 400], [228, 400], [227, 400]] as const
    for (const [x, boxWidth] of cases) {
      expect(ustTooltipLeft(x, boxWidth), `x=${x} W=${boxWidth}`).toBe(tooltipLeft({
        x, boxWidth, width: UST_TOOLTIP_WIDTH, offset: UST_TOOLTIP_OFFSET, inset: UST_TOOLTIP_EDGE
      }))
    }
    // 图表真正的最右一列（800 宽、图右缘 688）：翻到左侧 466。
    expect(ustTooltipLeft(688, 800)).toBe(466)
  })
})
