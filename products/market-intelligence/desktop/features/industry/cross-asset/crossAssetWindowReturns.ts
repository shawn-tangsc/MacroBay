import { crossAssetContractPolicy, crossAssetCurveStrideMs as contractCurveStrideMs } from '../../../../contracts/crossAssetObservationContracts'
import type { CrossAssetMetric, CrossAssetRange } from '../../../../contracts/crossAssetObservationContracts'

/**
 * The window ladder the 市场状态 table shows. Three of the four are the design's own：15m 由宏观序列
 * 的存储粒度决定（见下），1h/24h 既在闭合收益阶梯上、也在曲线上，7d 只在选中 7d range 的曲线上有
 * 覆盖。
 *
 * The closed-return ladder answers 5m/15m/1h/4h/24h; the curve answers what the ladder cannot, at the
 * granularity of the selected range. Two of the ladder's windows are deliberately not shown: 5m cannot
 * be answered by the macro series, whose stored granularity is fifteen minutes, and 4h is simply not
 * one of the four the table is specified to print.
 */
export type CrossAssetWindow = '15m' | '1h' | '24h' | '7d'
export const crossAssetWindows: readonly CrossAssetWindow[] = Object.freeze(['15m', '1h', '24h', '7d'])

/**
 * Curve point spacing per admitted range: every five minutes on the two short ranges, hourly on `7d`,
 * four-hourly on `30d` (the retention cold tier keeps one bar an hour out there, so a finer stride would
 * only draw the same value twice). Deriving the stride from the range keeps the label honest in each case.
 */
export const crossAssetCurveStrideMs: Readonly<Record<CrossAssetRange, number>> = Object.freeze(
  // 网格规则只有一处推导（契约），这里不再自行算一遍。
  Object.fromEntries(crossAssetContractPolicy.ranges.map(range => [range, contractCurveStrideMs(range)])) as Record<CrossAssetRange, number>
)
const windowMs: Readonly<Record<CrossAssetWindow, number>> = Object.freeze({
  '15m': 900_000, '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000
})

type CurvePoint = Readonly<{ returnPercent: number | null }>
const unavailable = (reason: 'missing' | 'insufficient'): CrossAssetMetric => ({ state: 'unavailable', reason })

/**
 * The four table windows for one asset. The snapshot's closed-return ladder (5m/15m/1h/4h/24h) wins
 * wherever it answers; the normalised curve is the fallback for a window the ladder could not read.
 * A window neither can answer is `unavailable`, never zero — the table prints 无数据 for it.
 *
 * The 7d window is the one that leans on the range: only a 7d curve reaches back seven days, so on the
 * 1h/24h ranges it is honestly 无数据 rather than a shorter move wearing a seven-day label.
 */
export function crossAssetWindowReturns(input: Readonly<{
  range: CrossAssetRange
  curves: readonly CurvePoint[]
  closedReturns: Readonly<Partial<Record<'5m' | '15m' | '1h' | '4h' | '24h' | '7d', CrossAssetMetric>>>
}>): Readonly<Record<CrossAssetWindow, CrossAssetMetric>> {
  const strideMs = crossAssetCurveStrideMs[input.range]
  const fromCurve = (window: CrossAssetWindow): CrossAssetMetric => curveReturn(input.curves, strideMs, window)
  // A close-to-close window needs two bars and nothing else, while the curve needs the ranged anchor
  // as well — and an instrument that is shut part of the day often has no bar at that anchor. The
  // closed ladder is therefore tried first for every window, and the curve answers only where the
  // ladder has nothing. Both are `unavailable`, never zero, when neither can answer.
  const closedOrCurve = (window: CrossAssetWindow): CrossAssetMetric => {
    const metric = input.closedReturns[window]
    return metric && metric.state === 'available' ? metric : fromCurve(window)
  }
  return Object.freeze({ '15m': closedOrCurve('15m'), '1h': closedOrCurve('1h'), '24h': closedOrCurve('24h'), '7d': closedOrCurve('7d') })
}

function curveReturn(curves: readonly CurvePoint[], strideMs: number, window: CrossAssetWindow): CrossAssetMetric {
  const steps = windowMs[window] / strideMs
  // A window shorter than one curve step cannot be read off that curve at all (15m on the hourly
  // 7d curve). Reporting a step would mislabel an hour as fifteen minutes.
  if (!Number.isSafeInteger(steps) || steps < 1) return unavailable('insufficient')
  const newest = curves[curves.length - 1]
  if (!newest) return unavailable('missing')
  if (newest.returnPercent === null) return unavailable('missing')
  const older = curves[curves.length - 1 - steps]
  if (!older) return unavailable('insufficient')
  if (older.returnPercent === null) return unavailable('insufficient')
  // Both figures are anchored to the window start, so the move between them is the ratio of the two
  // anchored returns, not their difference: +10% then +5% over the window is 4.76% over the sub-window.
  const value = ((1 + newest.returnPercent / 100) / (1 + older.returnPercent / 100) - 1) * 100
  return Number.isFinite(value) ? { state: 'available', value: Object.is(value, -0) ? 0 : value } : unavailable('insufficient')
}
