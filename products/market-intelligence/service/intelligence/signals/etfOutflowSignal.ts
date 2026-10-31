import type { ModuleSignal, SignalCadence, SignalSeverity } from '../../../contracts/moduleSignal'
import { buildSignalDedupeKey, isModuleSignal, moduleSignalPolicy } from '../../../contracts/moduleSignal'
import { computeEtfCumulativeFlow, etfFlowPolicy } from '../../../contracts/etfFlows'

/**
 * The ETF outflow rule: three consecutive trading days of net outflow, read as one signal.
 *
 * The rule owns three things and nothing else — which window it judges, where the severity
 * boundaries are, and how a signal is built from a complete window. Everything that must be the
 * same everywhere (the sum, the dedupe bucket, the window's unit, the coverage check) comes from
 * the contract, so a second reader cannot disagree about what "three days" means.
 *
 * `readiness: 'unavailable'` is a real outcome, not a failure: the source may hold two days of
 * flows, and the honest answer is that three days have not happened yet. It is deliberately not
 * expressed as a smaller sum wearing the three-day name.
 */

/** One asset's daily ETF flows, already ordered as the source delivers them. */
export type EtfFlowRows = readonly Readonly<{ tradingDate: string; netFlowUsd: number; observedAt: string }>[]

export const etfOutflowSignalPolicy = Object.freeze({
  moduleId: 'etf-flows',
  ruleId: 'etf-outflow-3d',
  cadence: Object.freeze({ kind: 'trading-day' }) satisfies SignalCadence,
  /**
   * Where the rule changes what it says. The threshold is the contract's, not a second copy: the
   * three-day total is compared against the one number that defines "large outflow".
   *
   * `medium` is the threshold itself; `high` is three times it, so the escalation is a multiple of
   * the same number rather than a second judgement someone has to keep in sync.
   */
  highMultiple: 3
} as const)

export type EtfOutflowSignalInput = Readonly<{
  asset: 'btc' | 'eth'
  rows: EtfFlowRows
  /** The instant the reading is for. Never the instant this function ran. */
  asOf: string
}>

/**
 * Builds the signal for one asset, or `undefined` when there is nothing to say.
 *
 * Three outcomes, and they are different on purpose:
 * - no complete window (fewer than three trading days) → `readiness: 'unavailable'`, no severity
 *   claim, because the rule has not been given a window to judge;
 * - a complete window that does not clear the threshold → `undefined`, because a quiet three days
 *   is not a signal;
 * - a complete window that clears it → a `medium`/`high` signal.
 */
export function buildEtfOutflowSignal(input: EtfOutflowSignalInput): ModuleSignal | undefined {
  const windows = computeEtfCumulativeFlow(input.rows, [etfFlowPolicy.signalWindowDays])
  const window = windows?.find(candidate => candidate.windowDays === etfFlowPolicy.signalWindowDays)
  const newest = input.rows.at(-1)
  if (!window || !newest) return undefined

  const values = Object.freeze({
    cumulativeNetFlowUsd: window.netFlowUsd,
    coveredDays: window.coveredDays,
    requiredDays: window.windowDays,
    thresholdUsd: etfFlowPolicy.signalOutflowUsd
  })
  // The instant the signal describes is the trading day the flows belong to, not the hour the
  // source stamped the row: a flow that arrives a day late is still about the day it describes.
  const observedAt = canonicalTradingDayInstant(newest.tradingDate)
  if (!observedAt) return undefined
  const dedupeKey = buildSignalDedupeKey({
    moduleId: etfOutflowSignalPolicy.moduleId,
    ruleId: etfOutflowSignalPolicy.ruleId,
    asset: input.asset,
    // The bucket is the same trading date, so a late-arriving flow deduplicates against its own day.
    observedAt,
    cadence: etfOutflowSignalPolicy.cadence
  })
  if (!dedupeKey) return undefined

  if (!window.complete) {
    return build({ values, observedAt, dedupeKey, severity: 'low', readiness: 'unavailable', input })
  }
  const severity = severityFor(window.netFlowUsd)
  if (!severity) return undefined
  return build({ values, observedAt, dedupeKey, severity, readiness: 'available', input })
}

/**
 * How bad this window is, or `undefined` when it is not an outflow worth naming.
 *
 * A helper rather than an inline ternary because the boundary is the whole rule: `>=` on the
 * threshold means exactly the threshold is already a signal, and the escalation multiplies that
 * same number instead of introducing a second one.
 */
function severityFor(netFlowUsd: number): SignalSeverity | undefined {
  if (netFlowUsd > etfFlowPolicy.signalOutflowUsd) return undefined
  return netFlowUsd <= etfFlowPolicy.signalOutflowUsd * etfOutflowSignalPolicy.highMultiple ? 'high' : 'medium'
}

function build(input: Readonly<{
  values: Readonly<Record<string, number>>
  observedAt: string
  dedupeKey: string
  severity: SignalSeverity
  readiness: 'available' | 'unavailable'
  input: EtfOutflowSignalInput
}>): ModuleSignal | undefined {
  const signal = Object.freeze({
    version: moduleSignalPolicy.version,
    moduleId: etfOutflowSignalPolicy.moduleId,
    ruleId: etfOutflowSignalPolicy.ruleId,
    asset: input.input.asset,
    severity: input.severity,
    observedAt: input.observedAt,
    cadence: etfOutflowSignalPolicy.cadence,
    values: input.values,
    dedupeKey: input.dedupeKey,
    readiness: input.readiness,
    triggerOwner: 'module-signal'
  }) satisfies ModuleSignal
  // The contract check runs on the way out, not only in tests: a rule that publishes a shape the
  // reader refuses would leave the chip blank with nothing failing.
  return isModuleSignal(signal) ? signal : undefined
}

/** The UTC midnight of a trading date, so the signal's instant is the day it describes. */
function canonicalTradingDayInstant(tradingDate: string): string | undefined {
  if (!etfFlowPolicy.tradingDatePattern.test(tradingDate)) return undefined
  const parsed = Date.parse(`${tradingDate}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed).toISOString().slice(0, 10) === tradingDate ? `${tradingDate}T00:00:00.000Z` : undefined
}
