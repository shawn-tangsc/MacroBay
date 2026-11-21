import { macroRatesSnapshotPublicPolicy } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import type {
  MacroRatesReading, MacroRatesSnapshotView, MacroRatesSpread
} from '../../../../contracts/macro/macroRatesSnapshotContracts'

/**
 * 国债收益率卡的数据模型：九行读数、四个变化窗口、曲线的窗口切片。
 *
 * 三条规则写在这里，组件只管画：
 *
 * 1. **变化一律 bp**，且只从窗口算：`1 日` 优先用契约的 `previous`（迁移期兜底读数只有一天、
 *    但 `previous` 仍在），其余档取窗口倒数第 6 / 22 / 253 个点。窗口不够就是 `null`，界面写 `—`。
 * 2. **最新列是水平值**：收益率写两位小数的百分数，价差写整数 bp 并带符号。方向色只给变化格。
 * 3. **曲线的四条窗口是同一份 260 点窗口的切片**（6 / 22 / 63 / 253 点），不新开查询；
 *    两条价差（bp、另一根轴）与实际利率（另一个市场）都不进五条线。
 */
export type UstTenorId = '3m' | '2y' | '5y' | '10y' | '30y'
export type UstChangeWindow = 'd1' | 'w1' | 'm1' | 'y1'
export type UstCurveRange = '1w' | '1m' | '3m' | '1y'
export type UstCurveMode = 'level' | 'normalized'

/** 五个期限：契约里按供应商序列指认，界面按期限叫它们。 */
export const ustTenors: readonly Readonly<{ id: UstTenorId; seriesId: string; labelKey: string }>[] = Object.freeze([
  { id: '3m', seriesId: macroRatesSnapshotPublicPolicy.series.us3m, labelKey: 'rows.3m' },
  { id: '2y', seriesId: macroRatesSnapshotPublicPolicy.series.us2y, labelKey: 'rows.2y' },
  { id: '5y', seriesId: macroRatesSnapshotPublicPolicy.series.us5y, labelKey: 'rows.5y' },
  { id: '10y', seriesId: macroRatesSnapshotPublicPolicy.series.us10y, labelKey: 'rows.10y' },
  { id: '30y', seriesId: macroRatesSnapshotPublicPolicy.series.us30y, labelKey: 'rows.30y' }
])

/** 四档变化：1 日 / 1 周 / 1 月 / 1 年（交易日）。 */
export const ustChangeWindows: readonly Readonly<{ id: UstChangeWindow; back: number; labelKey: string }>[] = Object.freeze([
  { id: 'd1', back: 1, labelKey: 'windows.d1' },
  { id: 'w1', back: 5, labelKey: 'windows.w1' },
  { id: 'm1', back: 21, labelKey: 'windows.m1' },
  { id: 'y1', back: 252, labelKey: 'windows.y1' }
])

/**
 * 曲线的四个周期档：**点数 = 回看交易日 + 1**，这样窗口第一点与表里那一列的基准是同一天，
 * 图上和表里不会差一天（v1 就栽在这上面）。
 */
export const ustCurveRanges: readonly Readonly<{ id: UstCurveRange; points: number; labelKey: string }>[] = Object.freeze([
  { id: '1w', points: 6, labelKey: 'periods.1w' },
  { id: '1m', points: 22, labelKey: 'periods.1m' },
  { id: '3m', points: 63, labelKey: 'periods.3m' },
  { id: '1y', points: 253, labelKey: 'periods.1y' }
])

export const ustSpreadRows: readonly Readonly<{ id: string; key: string; labelKey: string; long: UstTenorId; short: UstTenorId }>[] = Object.freeze([
  { id: '10y-2y', key: 'us10y-minus-us2y', labelKey: 'rows.10y2y', long: '10y', short: '2y' },
  { id: '10y-3m', key: 'us10y-minus-us3m', labelKey: 'rows.10y3m', long: '10y', short: '3m' }
])

export type UstWindowPoint = Readonly<{ period: string; value: number }>

export type UstRowGap = Readonly<{ kind: 'leg-missing'; legKey: string }> | Readonly<{ kind: 'dates-differ' }>

export type UstRowAvailability =
  | Readonly<{
      state: 'values'
      /** 最新列：收益率是两位小数百分数，价差是整数 bp。 */
      latest: Readonly<{ kind: 'percent' | 'basis-points'; value: number }>
      window: readonly UstWindowPoint[]
      changes: Readonly<Record<UstChangeWindow, number | null>>
      /** 这一行的观测日；与全表最新一天不同时，行名下写「截至 MM-DD」。 */
      lastPeriod: string
    }>
  /** 这一条不在契约的序列里（今天不会发生，契约里全都登记了；留着是为了以后删序列时不撒谎）。 */
  | Readonly<{ state: 'not-connected' }>
  /** 在契约里，但这次没读到。与「未接入」不互借。 */
  | Readonly<{ state: 'unreadable' }>
  /** 派生的价差没有数：缺一条腿，或两条腿的观测日不同。五个格留空，原因进可访问名。 */
  | Readonly<{ state: 'gap'; gap: UstRowGap }>

export type UstRow = Readonly<{
  id: string
  kind: 'tenor' | 'spread' | 'decomposition'
  /** 这一行前面要一条实线（价差段 / 分解段的开头）。 */
  block: boolean
  labelKey: string
  availability: UstRowAvailability
}>

export type UstRowsInput = Readonly<{
  snapshot?: MacroRatesSnapshotView
  /** 契约承认的序列；默认取公开契约那一份。 */
  admittedSeriesIds?: readonly string[]
}>

export function buildUstRows(input: UstRowsInput): readonly UstRow[] {
  const admitted = new Set(input.admittedSeriesIds ?? macroRatesSnapshotPublicPolicy.seriesIds)
  const view = input.snapshot && input.snapshot.state !== 'unavailable' ? input.snapshot : undefined
  const readings = new Map((view?.readings ?? []).map((reading) => [reading.seriesId, reading] as const))
  const spreads = new Map<string, MacroRatesSpread>((view?.spreads ?? []).map((spread) => [spread.key, spread] as const))

  const bySeries = (seriesId: string): UstRowAvailability => {
    if (!admitted.has(seriesId)) return { state: 'not-connected' }
    const reading = readings.get(seriesId)
    return reading ? readingAvailability(reading) : { state: 'unreadable' }
  }

  const rows: UstRow[] = []
  for (const tenor of ustTenors) {
    rows.push({ id: tenor.id, kind: 'tenor', block: false, labelKey: tenor.labelKey, availability: bySeries(tenor.seriesId) })
  }
  for (const [index, spread] of ustSpreadRows.entries()) {
    rows.push({
      id: spread.id, kind: 'spread', block: index === 0, labelKey: spread.labelKey,
      availability: spreadAvailability(spread, spreads.get(spread.key), readings, admitted)
    })
  }
  rows.push({
    id: 'real', kind: 'decomposition', block: true, labelKey: 'rows.real',
    availability: bySeries(macroRatesSnapshotPublicPolicy.series.real10y)
  })
  rows.push({
    id: 'breakeven', kind: 'decomposition', block: false, labelKey: 'rows.breakeven',
    availability: bySeries(macroRatesSnapshotPublicPolicy.series.breakeven10y)
  })
  return Object.freeze(rows)
}

function readingAvailability(reading: MacroRatesReading): UstRowAvailability {
  const window = Object.freeze(reading.window.map((point) => Object.freeze({ period: point.period, value: point.value })))
  const last = window[window.length - 1]
  if (!last) return { state: 'unreadable' }
  return Object.freeze({
    state: 'values',
    latest: Object.freeze({ kind: 'percent' as const, value: reading.actual }),
    window,
    changes: Object.freeze(changeSet(window, reading.previous)),
    lastPeriod: reading.period
  })
}

function spreadAvailability(
  row: (typeof ustSpreadRows)[number],
  spread: MacroRatesSpread | undefined,
  readings: ReadonlyMap<string, MacroRatesReading>,
  admitted: ReadonlySet<string>
): UstRowAvailability {
  const seriesFor = (id: UstTenorId) => ustTenors.find((tenor) => tenor.id === id)!
  const longSeries = seriesFor(row.long)
  const shortSeries = seriesFor(row.short)
  if (spread) {
    const window = Object.freeze(spread.window.map((point) => Object.freeze({ period: point.period, value: point.value })))
    const last = window[window.length - 1]
    if (!last) return { state: 'gap', gap: { kind: 'dates-differ' } }
    return Object.freeze({
      state: 'values',
      latest: Object.freeze({ kind: 'basis-points' as const, value: Math.round(spread.actual * 100) }),
      window,
      changes: Object.freeze(changeSet(window, spread.previous === undefined ? undefined : spread.previous)),
      lastPeriod: spread.period
    })
  }
  // 价差缺数只有两种事实：哪条腿这次没有读数，或两条腿的最后观测日不同。
  const longReading = readings.get(longSeries.seriesId)
  const shortReading = readings.get(shortSeries.seriesId)
  if (!admitted.has(shortSeries.seriesId)) return { state: 'gap', gap: { kind: 'leg-missing', legKey: shortSeries.labelKey } }
  if (!admitted.has(longSeries.seriesId)) return { state: 'gap', gap: { kind: 'leg-missing', legKey: longSeries.labelKey } }
  if (!shortReading) return { state: 'gap', gap: { kind: 'leg-missing', legKey: shortSeries.labelKey } }
  if (!longReading) return { state: 'gap', gap: { kind: 'leg-missing', legKey: longSeries.labelKey } }
  return { state: 'gap', gap: { kind: 'dates-differ' } }
}

/** 四个变化窗口，一律 bp；窗口不够就是 `null`（界面写 `—`，并说清是历史不足）。 */
export function changeSet(window: readonly UstWindowPoint[], previous: number | undefined): Record<UstChangeWindow, number | null> {
  const last = window[window.length - 1]
  const change = (back: number): number | null => {
    const from = window[window.length - 1 - back]
    if (!last || !from) return null
    return Math.round((last.value - from.value) * 100)
  }
  return {
    // 契约的 `previous` 是上一个交易日的收盘，可能不在窗口里（迁移期兜底只有一天）。
    d1: previous === undefined ? change(1) : Math.round((last!.value - previous) * 100),
    w1: change(5),
    m1: change(21),
    y1: change(252)
  }
}

export type UstCurveSeries = Readonly<{ id: UstTenorId; labelKey: string; values: readonly (number | null)[] }>

export type UstCurveView = Readonly<{
  /** 横轴：这几条线在这个窗口里出现过的全部交易日（并集，升序）。 */
  days: readonly string[]
  series: readonly UstCurveSeries[]
  /** 归一模式的基准日（第一条可用线的窗口首日）；水平模式为 undefined。 */
  basePeriod?: string
}>

/**
 * 曲线的窗口切片：只取五条期限（价差进不来、实际利率也不进来），并按同一组交易日对齐——
 * 两条腿的日期可能差一天，缺的那天该是空档，不是把别的日子顶上。
 */
export function buildUstCurve(input: Readonly<{ rows: readonly UstRow[]; range: UstCurveRange; mode: UstCurveMode }>): UstCurveView {
  const points = ustCurveRanges.find((range) => range.id === input.range)?.points ?? 63
  const windows = new Map<UstTenorId, readonly UstWindowPoint[]>()
  for (const tenor of ustTenors) {
    const row = input.rows.find((candidate) => candidate.id === tenor.id)
    if (row?.availability.state !== 'values') continue
    windows.set(tenor.id, row.availability.window.slice(-points))
  }

  const days = [...new Set([...windows.values()].flatMap((window) => window.map((point) => point.period)))].sort()
  const series: UstCurveSeries[] = []
  let basePeriod: string | undefined
  for (const tenor of ustTenors) {
    const window = windows.get(tenor.id)
    if (!window) continue
    const byPeriod = new Map(window.map((point) => [point.period, point.value] as const))
    const levels = days.map((day) => byPeriod.get(day) ?? null)
    const base = levels.find((level): level is number => level !== undefined && level !== null)
    if (base === undefined) continue
    basePeriod ??= window[0]?.period
    series.push(Object.freeze({
      id: tenor.id,
      labelKey: tenor.labelKey,
      values: Object.freeze(levels.map((level) => level === null ? null : (input.mode === 'normalized' ? roundBp((level - base) * 100) : level)))
    }))
  }
  return Object.freeze({ days: Object.freeze(days), series: Object.freeze(series), ...(basePeriod === undefined ? {} : { basePeriod }) })
}

function roundBp(value: number): number {
  return Math.round(value * 10) / 10
}

/** 页脚的观测日：只有画出来的那七条序列（五个期限 + 两条分解）都同一天才写一个日期。 */
export function ustObservationDates(rows: readonly UstRow[]): readonly string[] {
  const dates = new Set<string>()
  for (const row of rows) {
    if (row.kind === 'spread') continue
    if (row.availability.state === 'values') dates.add(row.availability.lastPeriod)
  }
  return Object.freeze([...dates].sort())
}

/** 全表最新的一天：某行的观测日比它早，就在行名下写「截至 MM-DD」。 */
export function ustLatestPeriod(rows: readonly UstRow[]): string | undefined {
  return ustObservationDates(rows).at(-1)
}

/** 一条线都没有（五个期限全缺）但表里还有数：图那一块换空态，表照留。 */
export function ustHasCurveLines(curve: UstCurveView): boolean {
  return curve.series.length > 0
}

/** 表里一条有数的行都没有：整卡空态，不画一张九行都写「未接入」的表。 */
export function ustHasAnyReading(rows: readonly UstRow[]): boolean {
  return rows.some((row) => row.availability.state === 'values')
}
