import type { ModuleSignal, SignalCadence, SignalSeverity } from '../../../contracts/moduleSignal'
import { buildSignalDedupeKey, isModuleSignal, moduleSignalPolicy, signalTriggerKey, signalWindow, type SignalWindow } from '../../../contracts/moduleSignal'
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
  const newest = newestByTradingDate(input.rows)
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

/**
 * 这一路读不到时，两个资产各出一条 `unavailable` 信号。
 *
 * 与「安静」不是一件事：安静是根本没有信号，读不到是「不知道有没有」。给一个空列表，牌子就
 * 只能消失，读者会把它读成「没事」——这正是要防的那句话。覆盖写 0/3 是如实的分母：契约要求
 * 求和的规则必须交代分母，一行都没有时它确实是 0。这里**不写任何读数**（累计金额那两个数字
 * 一个都不出现），拿不到时给数字就是猜。
 */
export function etfOutflowUnavailableSignals(asOf: string): readonly ModuleSignal[] {
  return Object.freeze((['btc', 'eth'] as const)
    .map(asset => unavailableSignal(asset, asOf))
    .filter((signal): signal is ModuleSignal => signal !== undefined))
}

function unavailableSignal(asset: 'btc' | 'eth', asOf: string): ModuleSignal | undefined {
  const dedupeKey = buildSignalDedupeKey({
    moduleId: etfOutflowSignalPolicy.moduleId,
    ruleId: etfOutflowSignalPolicy.ruleId,
    asset,
    observedAt: asOf,
    cadence: etfOutflowSignalPolicy.cadence
  })
  if (!dedupeKey) return undefined
  return build({
    values: { coveredDays: 0, requiredDays: etfFlowPolicy.signalWindowDays },
    observedAt: asOf,
    dedupeKey,
    severity: 'low',
    readiness: 'unavailable',
    input: { asset, rows: [], asOf }
  })
}

/**
 * The row with the latest trading date, regardless of the order the caller handed them in.
 *
 * Not `.at(-1)`: the rows are only sorted by the sum below, which does nothing to the array itself,
 * and nothing in this rule's input promises an order. A caller that lists the newest arrival last
 * would hand a late-arriving flow the "newest" slot, move the bucket to the day it landed, and the
 * chip would still render — with the wrong date on it. Taking the maximum is the difference between
 * reading the data's own trading day and trusting whoever assembled the list.
 */
function newestByTradingDate(rows: EtfFlowRows): EtfFlowRows[number] | undefined {
  let newest: EtfFlowRows[number] | undefined
  for (const row of rows) {
    if (!newest || row.tradingDate > newest.tradingDate) newest = row
  }
  return newest
}

/** The UTC midnight of a trading date, so the signal's instant is the day it describes. */
function canonicalTradingDayInstant(tradingDate: string): string | undefined {
  if (!etfFlowPolicy.tradingDatePattern.test(tradingDate)) return undefined
  const parsed = Date.parse(`${tradingDate}T00:00:00.000Z`)
  if (!Number.isFinite(parsed)) return undefined
  return new Date(parsed).toISOString().slice(0, 10) === tradingDate ? `${tradingDate}T00:00:00.000Z` : undefined
}

/**
 * 一条成立的三日净流出信号，转成一次分析请求。
 *
 * 形状就是接收端声明的那个：**信号本身 + 规则自己的窗口 + 板子**。触发键、模块、规则、资产、
 * 严重度、数据时刻、去重键都从信号取，不再各带一份标量副本——同一件事在两个字段里说两句话，
 * 迟早会有一句落后。窗口也不由接收端推：三天是这条规则自己的单位。
 */
export type EtfOutflowAnalysisRequest = Readonly<{
  signal: ModuleSignal
  /** 规则判的那三个交易日；`ModuleSignal` 故意不携窗口。 */
  window: SignalWindow
  /** 牌子所属的板子：现货是资金面。 */
  groupType: 'capital'
}>

/**
 * 这一批信号里，哪些值得递交一次分析。
 *
 * 只递成立的（`readiness: 'available'`）：窗口没凑齐是「还判不了」，不是一件已经发生的事。
 * 低档只打牌子、不叫分析，这里先挡掉。一条信号一个请求：同一天 BTC 与 ETH 是两条读数，
 * 靠各自的去重键区分，合并与单飞归接收端。
 */
export function etfOutflowAnalysisRequests(signals: readonly ModuleSignal[]): readonly EtfOutflowAnalysisRequest[] {
  const requests: EtfOutflowAnalysisRequest[] = []
  for (const signal of signals) {
    if (signal.moduleId !== etfOutflowSignalPolicy.moduleId || signal.readiness !== 'available') continue
    if (signal.severity === 'low') continue
    // 键拼不出来就不花额度：宁可不叫这次分析，也不匿名记账（接收端还会再拒一次）。
    if (!signalTriggerKey(signal.moduleId, signal.ruleId)) continue
    const window = signalWindow(signal.cadence, etfFlowPolicy.signalWindowDays)
    if (!window) continue
    requests.push(Object.freeze({ signal, window, groupType: 'capital' as const }))
  }
  return Object.freeze(requests)
}
