import { computeEtfCumulativeFlow, etfFlowPolicy, etfOutflowOutletPolicy, isEtfOutflowOutletOpen, type EtfOutflowOutletSwitch } from '../../../../contracts/etfFlows'
import type { ModuleSignal, SignalSeverity } from '../../../../contracts/moduleSignal'
import type { ModuleSignalRead, ModuleSignalReadFailureCode } from '../../../../contracts/moduleSignalRead'
import {
  capitalConditionsDailyFlowPolicy,
  capitalConditionsSnapshotPolicy,
  isCanonicalCapitalConditionsSnapshotTime,
  isValidCapitalConditionsDailyFlows,
  isVisibleEtfPublicSnapshot,
  type EtfPublicAssetSnapshot
} from '../../../../contracts/intelligenceQueryContracts'
import { selectVisibleFlowRows, type FlowChartRow } from './capitalFlowRows'

export const dashboardCapitalConditionsPresentationPolicy = {
  usd: {
    maximumFractionDigits: 1,
    compactUnits: [
      { suffix: 'B', threshold: 1_000_000_000 },
      { suffix: 'M', threshold: 1_000_000 },
      { suffix: 'K', threshold: 1_000 }
    ]
  },
  percent: { fractionDigits: 2, includePositiveSign: true },
  etfState: 'unavailable',
  flowChart: {
    defaultVisibleRows: 7,
    maximumMagnitudePercent: 100,
    minimumVisibleMagnitudePercent: 2,
    series: ['funds', 'btc', 'eth'],
    directions: { inflow: 'inflow', outflow: 'outflow', zero: 'zero' }
  }
} as const

type DashboardEtfFlowRow = { tradingDate: string; netFlowUsd: number; direction: 'inflow' | 'outflow' | 'zero'; magnitudePercent: number }
export type DashboardEtfCumulativeWindow = { windowDays: number; coveredDays: number; netFlowUsd: string; complete: boolean }
export type DashboardEtfFlowAsset = { asset: 'BTC' | 'ETH'; latestNetFlowUsd: string; observedAt: string; cumulative: readonly DashboardEtfCumulativeWindow[]; rows: readonly DashboardEtfFlowRow[] }
/** BTC/ETH rows are date-aligned by contract, so the table header can state one coverage per window. */
export type DashboardEtfCumulativeCoverage = { windowDays: number; coveredDays: number; complete: boolean }
type DashboardEtfFlow = { state: 'available'; btc: DashboardEtfFlowAsset; eth: DashboardEtfFlowAsset; coverage: readonly DashboardEtfCumulativeCoverage[]; verifiedAt: string }
/**
 * The chip the capital-conditions card may draw beside its title.
 *
 * Only one per card, and only from the module's own rule: the amount is read out of the signal's
 * `values`, never summed here. A rule that could not judge (window not complete, or the read
 * failed) is `insufficient` — a grey chip with no number, because a missing reading must not be
 * dressed as a small one. `hidden` is the normal state: nothing happened, so nothing is drawn.
 * `unreadable` is the fourth: the read itself did not happen, which the reader can retry and a quiet
 * market cannot.
 */
export type DashboardEtfSignalChip =
  | Readonly<{ state: 'hidden' }>
  | Readonly<{ state: 'insufficient' }>
  | Readonly<{ state: 'unreadable'; failureCode: ModuleSignalReadFailureCode }>
  | Readonly<{
      state: 'alert'
      asset: 'btc' | 'eth'
      /** The three-day outflow, as an unsigned amount: the chip's own word already says which way. */
      amountUsd: string
      /** The same sum signed, for the detail: `-$488.7M`, never a second total. */
      cumulativeUsd: string
      coveredDays: number
      requiredDays: number
      /** The trading day the flows belong to, not the instant this was read. */
      observedAt: string
    }>
type DashboardStablecoinFlow = { tradingDate: string; netFlowUsd: number }
/**
 * "No chart today" has two meanings and they must not read the same: the sources did not answer
 * (`unavailable`), or they answered with too few aligned days (`not-yet`, with the count).
 */
export type DashboardFlowHistory =
  | { state: 'available'; rows: readonly FlowChartRow[] }
  | { state: 'not-yet'; availableDays: number }

export type DashboardCapitalConditionsState =
  | { state: 'loading' }
  | {
      state: 'available'
      /**
       * These are the readings from before a failed re-read, not a fresh copy.
       *
       * A transient failure must not take the numbers off the screen: the reader keeps what they
       * had and is told it is old, which is a different fact from "the data is gone".
       */
      stale?: true
      conclusion: 'partial' | 'unavailable'
      etf: DashboardEtfFlow | 'unavailable'
      /** Absent when the card could not read at all; `hidden` when the rule had nothing to say. */
      etfSignal?: DashboardEtfSignalChip
      flowHistory?: DashboardFlowHistory
      observedAt: string
      currentUsd: string
      change1dUsd: string
      change1dPercent: string
      change7dUsd: string
      change7dPercent: string
      change30dUsd: string
      change30dPercent: string
      dailyFlows?: readonly DashboardStablecoinFlow[]
    }
  | { state: 'empty' }
  | { state: 'unavailable' }

export function projectDashboardCapitalConditionsSnapshot(value: unknown, asOf: string): Exclude<DashboardCapitalConditionsState, { state: 'loading' }> {
  try {
    if (!isCanonicalCapitalConditionsSnapshotTime(asOf)) return { state: 'unavailable' }
    if (isExactRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === asOf) return { state: 'empty' }
    if (isExactRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === capitalConditionsSnapshotPolicy.unavailableFailureCode) return { state: 'unavailable' }
    if (!isAvailable(value, asOf)) return { state: 'unavailable' }
    const core = value.coreStablecoins
    const currentUsd = formatUsd(core.currentUsd, false)
    const change1dUsd = formatUsd(core.change1dUsd, true)
    const change1dPercent = formatPercent(core.change1dPercent)
    const change7dUsd = formatUsd(core.change7dUsd, true)
    const change7dPercent = formatPercent(core.change7dPercent)
    const change30dUsd = formatUsd(core.change30dUsd, true)
    const change30dPercent = formatPercent(core.change30dPercent)
    if (!currentUsd || !change1dUsd || !change1dPercent || !change7dUsd || !change7dPercent || !change30dUsd || !change30dPercent) return { state: 'unavailable' }
    const dailyFlows = isValidCapitalConditionsDailyFlows(core.dailyFlows, asOf) ? core.dailyFlows : undefined
    const etf = projectEtf(value.etf, asOf)
    const flowHistory = projectFlowHistory(dailyFlows, etf)
    return {
      state: 'available', conclusion: value.conclusion, etf, ...(flowHistory === 'unavailable' ? {} : { flowHistory }), observedAt: core.observedAt,
      currentUsd, change1dUsd, change1dPercent, change7dUsd, change7dPercent, change30dUsd, change30dPercent,
      ...(dailyFlows ? { dailyFlows } : {})
    }
  } catch {
    return { state: 'unavailable' }
  }
}

function isAvailable(value: unknown, asOf: string): value is {
  coreStablecoins: {
    observedAt: string
    verifiedAt: string
    currentUsd: number
    change1dUsd: number
    change1dPercent: number
    change7dUsd: number
    change7dPercent: number
    change30dUsd: number
    change30dPercent: number
    dailyFlows?: unknown
  }
  etf: unknown
  conclusion: 'partial' | 'unavailable'
} {
  if (!isExactRecord(value, ['state', 'asOf', 'etf', 'coreStablecoins', 'conclusion'])) return false
  if (value.state !== 'available' || value.asOf !== asOf || value.conclusion !== 'partial' && value.conclusion !== 'unavailable') return false
  const core = value.coreStablecoins
  if ((!isExactRecord(core, ['observedAt', 'verifiedAt', 'currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent']) &&
    !isExactRecord(core, ['observedAt', 'verifiedAt', 'currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent', 'dailyFlows'])) || !isCanonicalCapitalConditionsSnapshotTime(core.observedAt) || !isCanonicalCapitalConditionsSnapshotTime(core.verifiedAt) || core.observedAt > core.verifiedAt || core.verifiedAt > asOf) return false
  if (!['currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent'].every((key) => isDisplayNumber(core[key]))) return false
  return true
}

function projectEtf(value: unknown, asOf: string): DashboardEtfFlow | 'unavailable' {
  if (!isVisibleEtfPublicSnapshot(value, asOf)) return dashboardCapitalConditionsPresentationPolicy.etfState
  const btc = projectEtfAsset(value.btc)
  const eth = projectEtfAsset(value.eth)
  if (!btc || !eth) return dashboardCapitalConditionsPresentationPolicy.etfState
  const coverage = projectEtfCoverage(btc, eth)
  return coverage ? { state: 'available', btc, eth, coverage, verifiedAt: value.verifiedAt } : dashboardCapitalConditionsPresentationPolicy.etfState
}

function projectEtfCoverage(btc: DashboardEtfFlowAsset, eth: DashboardEtfFlowAsset): readonly DashboardEtfCumulativeCoverage[] | undefined {
  if (btc.cumulative.length !== eth.cumulative.length) return undefined
  const coverage: DashboardEtfCumulativeCoverage[] = []
  for (let index = 0; index < btc.cumulative.length; index += 1) {
    const btcWindow = btc.cumulative[index]!
    const ethWindow = eth.cumulative[index]!
    if (btcWindow.windowDays !== ethWindow.windowDays ||
      btcWindow.complete !== (btcWindow.coveredDays === btcWindow.windowDays) ||
      ethWindow.complete !== (ethWindow.coveredDays === ethWindow.windowDays)) return undefined
    coverage.push({
      windowDays: btcWindow.windowDays,
      coveredDays: Math.min(btcWindow.coveredDays, ethWindow.coveredDays),
      complete: btcWindow.complete && ethWindow.complete
    })
  }
  return coverage
}

function projectFlowHistory(stablecoinHistory: readonly DashboardStablecoinFlow[] | undefined, etf: DashboardEtfFlow | 'unavailable'): DashboardFlowHistory | 'unavailable' {
  if (!stablecoinHistory || etf === 'unavailable') return 'unavailable'
  const funds = new Map(stablecoinHistory.map((row) => [row.tradingDate, row.netFlowUsd]))
  const eth = new Map(etf.eth.rows.map((row) => [row.tradingDate, row.netFlowUsd]))
  const rows = etf.btc.rows.flatMap((btc) => {
    const fund = funds.get(btc.tradingDate)
    const ether = eth.get(btc.tradingDate)
    return fund === undefined || ether === undefined ? [] : [{ tradingDate: btc.tradingDate, funds: fund, btc: btc.netFlowUsd, eth: ether }]
  })
  if (rows.length === 0) return { state: 'not-yet', availableDays: 0 }
  if (rows.length < capitalConditionsDailyFlowPolicy.minimumChartRows) return { state: 'not-yet', availableDays: rows.length }
  return { state: 'available', rows: selectVisibleFlowRows(rows, dashboardCapitalConditionsPresentationPolicy.flowChart.defaultVisibleRows) }
}

function projectEtfAsset(value: EtfPublicAssetSnapshot): DashboardEtfFlowAsset | undefined {
  const latest = value.rows.at(-1)
  if (!latest) return undefined
  const latestNetFlowUsd = formatUsd(latest.netFlowUsd, true)
  const largestAbsoluteFlow = Math.max(...value.rows.map((row) => Math.abs(row.netFlowUsd)))
  const cumulative = projectEtfCumulativeWindows(value)
  if (!latestNetFlowUsd || !Number.isFinite(largestAbsoluteFlow) || !cumulative) return undefined
  const rows = value.rows.map((row) => ({
    tradingDate: row.tradingDate,
    netFlowUsd: row.netFlowUsd,
    direction: row.netFlowUsd > 0 ? dashboardCapitalConditionsPresentationPolicy.flowChart.directions.inflow : row.netFlowUsd < 0 ? dashboardCapitalConditionsPresentationPolicy.flowChart.directions.outflow : dashboardCapitalConditionsPresentationPolicy.flowChart.directions.zero,
    magnitudePercent: row.netFlowUsd === 0 ? 0 : Math.max(1, Math.min(dashboardCapitalConditionsPresentationPolicy.flowChart.maximumMagnitudePercent, Math.round(Math.abs(row.netFlowUsd) / largestAbsoluteFlow * dashboardCapitalConditionsPresentationPolicy.flowChart.maximumMagnitudePercent)))
  }))
  return { asset: value.asset, latestNetFlowUsd, observedAt: latest.observedAt, cumulative, rows }
}

/**
 * Sums the same validated rows the chart already uses. The window lengths live in the
 * contract-level helper; this projection only formats each already-summed amount, and fails
 * closed when a window cannot be represented as a display number.
 */
function projectEtfCumulativeWindows(value: EtfPublicAssetSnapshot): readonly DashboardEtfCumulativeWindow[] | undefined {
  const windows = computeEtfCumulativeFlow(value.rows, etfFlowPolicy.cumulativeWindows)
  if (!windows) return undefined
  const projected: DashboardEtfCumulativeWindow[] = []
  for (const window of windows) {
    if (!Number.isInteger(window.windowDays) || !Number.isInteger(window.coveredDays) || window.coveredDays < 1 || window.coveredDays > window.windowDays) return undefined
    const netFlowUsd = formatUsd(window.netFlowUsd, true)
    if (!netFlowUsd) return undefined
    projected.push({ windowDays: window.windowDays, coveredDays: window.coveredDays, netFlowUsd, complete: window.complete })
  }
  return projected
}

const signalSeverityRank: Readonly<Record<SignalSeverity, number>> = Object.freeze({ high: 3, medium: 2, low: 1 })

/**
 * Picks the one chip this card may draw, from the module's own rule.
 *
 * The rule already decided everything: which asset, how much, over how many complete trading days.
 * This projection only formats what it was handed — a three-day sum computed here would be a second
 * implementation of the threshold, and the card would start disagreeing with the notification.
 *
 * The panel switch is the master switch: while it is closed nothing is drawn, not even the grey
 * chip, because there is no outlet yet. A signal that could not judge is `insufficient` and carries
 * no number: "we could not look" is not "a small outflow".
 */
export function projectEtfOutflowChip(
  read: ModuleSignalRead | undefined,
  switchState: EtfOutflowOutletSwitch = etfOutflowOutletPolicy
): DashboardEtfSignalChip {
  if (!isEtfOutflowOutletOpen(switchState, 'panel')) return { state: 'hidden' }
  // No read yet is "not yet"; a failed read is its own state — the reader retries one and waits for
  // the other.
  if (read === undefined) return { state: 'hidden' }
  if (read.state === 'unavailable') return { state: 'unreadable', failureCode: read.failureCode }
  const mine = read.signals.map(entry => entry.signal).filter(signal => signal.moduleId === 'etf-flows')
  if (mine.length === 0) return { state: 'hidden' }
  // One chip per card: the loudest speaks, the rest stay in its detail. Two chips side by side
  // invite a comparison the product says is meaningless.
  const loudest = mine.reduce((best, signal) => signalSeverityRank[signal.severity] > signalSeverityRank[best.severity] ? signal : best)
  if (loudest.readiness !== 'available' || loudest.asset === null) return { state: 'insufficient' }
  const netFlowUsd = loudest.values.cumulativeNetFlowUsd
  const coveredDays = loudest.values.coveredDays
  const requiredDays = loudest.values.requiredDays
  // An outflow is negative; a zero or positive reading is not this rule's event, and a window
  // without its denominator cannot be read. Either way: no number on the chip.
  if (typeof netFlowUsd !== 'number' || !Number.isFinite(netFlowUsd) || netFlowUsd >= 0) return { state: 'insufficient' }
  if (!Number.isInteger(coveredDays) || !Number.isInteger(requiredDays) || coveredDays < 1 || requiredDays < 1 || coveredDays > requiredDays) return { state: 'insufficient' }
  const amountUsd = formatUsd(-netFlowUsd, false)
  const cumulativeUsd = formatUsd(netFlowUsd, true)
  if (!amountUsd || !cumulativeUsd) return { state: 'insufficient' }
  return { state: 'alert', asset: loudest.asset, amountUsd, cumulativeUsd, coveredDays, requiredDays, observedAt: loudest.observedAt }
}

function isDisplayNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 999_999_999_999_999
}

function formatUsd(value: number, signed: boolean): string | undefined {
  if (!isDisplayNumber(value)) return undefined
  const normalized = Object.is(value, -0) ? 0 : value
  const absolute = Math.abs(normalized)
  const unit = dashboardCapitalConditionsPresentationPolicy.usd.compactUnits.find((candidate) => absolute >= candidate.threshold)
  const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: dashboardCapitalConditionsPresentationPolicy.usd.maximumFractionDigits, useGrouping: false }).format(absolute / (unit?.threshold ?? 1))
  return `${signed && normalized > 0 ? '+' : normalized < 0 ? '-' : ''}$${number}${unit?.suffix ?? ''}`
}

function formatPercent(value: number): string | undefined {
  if (!isDisplayNumber(value)) return undefined
  const normalized = Object.is(value, -0) ? 0 : value
  const number = new Intl.NumberFormat('en-US', { minimumFractionDigits: dashboardCapitalConditionsPresentationPolicy.percent.fractionDigits, maximumFractionDigits: dashboardCapitalConditionsPresentationPolicy.percent.fractionDigits, useGrouping: false }).format(Math.abs(normalized))
  return `${normalized > 0 ? '+' : normalized < 0 ? '-' : ''}${number}%`
}

function isExactRecord(value: unknown, fields: readonly string[]): value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) return false
  const names = Object.getOwnPropertyNames(value)
  return names.length === fields.length && fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}
