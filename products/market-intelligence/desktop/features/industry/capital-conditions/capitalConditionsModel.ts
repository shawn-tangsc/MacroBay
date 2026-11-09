import { computeEtfCumulativeFlow, etfFlowPolicy, etfOutflowOutletPolicy, isEtfOutflowOutletOpen, type EtfOutflowOutletSwitch } from '../../../../contracts/etfFlows'
import type { ModuleSignal, SignalSeverity } from '../../../../contracts/moduleSignal'
import type { ModuleSignalRead, ModuleSignalReadFailureCode } from '../../../../contracts/moduleSignalRead'
import type { ModuleSignalAnalysisRead } from '../../../../service/intelligence/analysis/signalAnalysisRead'
import type { SignalAnalysisStateView } from '../../../../service/intelligence/analysis/signalAnalysisState'
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

/**
 * 资金面那两格的**读数**：每支资产各自有没有值，缺的时候缺什么，以及两支能不能对比。
 *
 * 这是架构师定的三档拆分的本侧一半（判定口径归架构师，展示归组件线）：
 * - `state` 只说这张表的整体可信度：两支都有值 `available`、只有一支 `partial`、一支都没有 `unreadable`；
 * - **缺必须带原因**，不许画 0，也不许因为另一支有值就把这一支补成 0；
 * - `comparison` 只影响**对比列**：两支都对不上时，格子里的数字照旧，只是不能并列比较。
 */
export type DashboardEtfMissingReason = 'source-unreadable' | 'asset-missing' | 'value-missing'
export type DashboardEtfComparison =
  | { state: 'aligned' }
  /**
   * 一支有值、另一支没有：不可比的原因就是缺的原因，落后天数无意义，所以那两个字段不出现。
   */
  | { state: 'unaligned'; reason: DashboardEtfMissingReason }
  /**
   * 两支都有值，但最新交易日不同。
   *
   * `laggingDays` **与众数同源**：领先一方在落后一方最新交易日**之后**还有几个交易日，
   * 按两边的 `rows[].tradingDate` 数（`rows` 由契约保证升序），**不按自然日**——周末与休市不算落后。
   * 日期不同 ⇒ 至少 1；算出来 0 就是这条的契约被破坏，不是「刚好没落后」。
   */
  | { state: 'unaligned'; reason: 'latest-trading-day-differs'; lagging: 'btc' | 'eth'; laggingDays: number }
export type DashboardEtfReading = Readonly<{
  state: 'available' | 'partial' | 'unreadable'
  btc?: DashboardEtfFlowAsset
  eth?: DashboardEtfFlowAsset
  missing?: Readonly<{ btc?: DashboardEtfMissingReason; eth?: DashboardEtfMissingReason }>
  comparison: DashboardEtfComparison
  /**
   * 表头「5 天里覆盖了 4 天」的那组数：**跨两支取 `min(coveredDays)`、`complete` 相与**。
   *
   * 这是比较，不是读自己那一行——展示层自己算就是第二次实现。只有一支有值时 `min` 退化成那一支、
   * `complete` 取那一支；不可比由 `comparison` 单独说，**不靠把覆盖数藏起来**。读不到时是空数组。
   */
  coverage: readonly DashboardEtfCumulativeCoverage[]
  /** 快照的读取时刻：读得到才有，读不到就不是「旧」，而是「不知道」。 */
  verifiedAt?: string
}>

/**
 * 卡片整体读不出来时的**原因**。原来这里一个字都没有，5 种完全不同的失败都画成同一块「读取失败 + 重试」，
 * 而其中三种点了重试也不会好——给一个必然再失败的按钮，比没有按钮更坏。
 *
 * `retryable` 的判据只有一条：**读者点一下会不会有不同结果**。只有「读了但没读成」会；
 * 形状/版本不符、时钟不合法、客户端没接上，重试一万次也一样。
 */
export type DashboardCapitalConditionsUnavailableReason =
  | 'contract-mismatch'
  | 'invalid-clock'
  | 'client-unavailable'
  | 'snapshot-unavailable'
  | 'value-unformattable'
  | 'query-failed'

export function isCapitalConditionsRetryable(reason: DashboardCapitalConditionsUnavailableReason): boolean {
  return reason === 'snapshot-unavailable' || reason === 'query-failed'
}

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
      /**
       * 旧出口：两支都有值才给形状，否则 `'unavailable'`。**只保留给还没切换的展示侧**，
       * 新读数走 `etfReading`；等组件线切完这一格删掉（加字段 → 换消费方 → 删旧字段）。
       */
      etf: DashboardEtfFlow | 'unavailable'
      /**
       * 那两格真正的读数：逐资产的值、缺的原因、能不能对比。
       *
       * **本阶段可选**：模型总是填它，但展示侧还没切换——在这条三段式的第一段（加字段）里把它写成必填，
       * 等于强制改动展示侧的每一处夹具。组件线切到 `etfReading`、旧的 `etf` 删掉时，这里转必填。
       */
      etfReading?: DashboardEtfReading
      /** Absent when the card could not read at all; `hidden` when the rule had nothing to say. */
      etfSignal?: DashboardEtfSignalChip
      /**
       * 这条信号的分析到哪一步。**与信号并列**，不塞进 `etfSignal`：信号是规则的产物，分析状态
       * 是运行的产物，嵌套进去以后信号一变这两处就得一起改。
       */
      etfSignalAnalysis?: SignalAnalysisStateView
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
  | { state: 'unavailable'; reason: DashboardCapitalConditionsUnavailableReason }

export function projectDashboardCapitalConditionsSnapshot(value: unknown, asOf: string): Exclude<DashboardCapitalConditionsState, { state: 'loading' }> {
  try {
    if (!isCanonicalCapitalConditionsSnapshotTime(asOf)) return { state: 'unavailable', reason: 'invalid-clock' }
    if (isExactRecord(value, ['state', 'asOf']) && value.state === 'empty' && value.asOf === asOf) return { state: 'empty' }
    if (isExactRecord(value, ['state', 'failureCode']) && value.state === 'unavailable' && value.failureCode === capitalConditionsSnapshotPolicy.unavailableFailureCode) return { state: 'unavailable', reason: 'snapshot-unavailable' }
    // 两种失败都不要重试，但原因不同：形状/版本不符（旧版 DTO 多/少键、答案不是这次 asOf 的）该重开应用；
    // 形状对、只是数字超出显示策略（Infinity / MAX_VALUE）是值本身没法显示。
    if (!isAvailable(value, asOf)) {
      return { state: 'unavailable', reason: numbersOutsideDisplayPolicy(value) ? 'value-unformattable' : 'contract-mismatch' }
    }
    const core = value.coreStablecoins
    const currentUsd = formatUsd(core.currentUsd, false)
    const change1dUsd = formatUsd(core.change1dUsd, true)
    const change1dPercent = formatPercent(core.change1dPercent)
    const change7dUsd = formatUsd(core.change7dUsd, true)
    const change7dPercent = formatPercent(core.change7dPercent)
    const change30dUsd = formatUsd(core.change30dUsd, true)
    const change30dPercent = formatPercent(core.change30dPercent)
    if (!currentUsd || !change1dUsd || !change1dPercent || !change7dUsd || !change7dPercent || !change30dUsd || !change30dPercent) return { state: 'unavailable', reason: 'value-unformattable' }
    const dailyFlows = isValidCapitalConditionsDailyFlows(core.dailyFlows, asOf) ? core.dailyFlows : undefined
    const etfReading = projectEtf(value.etf, asOf)
    const etf = legacyEtfProjection(etfReading)
    const flowHistory = projectFlowHistory(dailyFlows, etfReading)
    return {
      state: 'available', conclusion: value.conclusion, etf, etfReading, ...(flowHistory === 'unavailable' ? {} : { flowHistory }), observedAt: core.observedAt,
      currentUsd, change1dUsd, change1dPercent, change7dUsd, change7dPercent, change30dUsd, change30dPercent,
      ...(dailyFlows ? { dailyFlows } : {})
    }
  } catch {
    return { state: 'unavailable', reason: 'query-failed' }
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

/** 两支都对不上时的原因：读不到 → 缺一支 → 最新交易日不同（落后的一方是 `lagging`）。 */
function projectEtf(value: unknown, asOf: string): DashboardEtfReading {
  if (!isVisibleEtfPublicSnapshot(value, asOf)) {
    return {
      state: 'unreadable',
      missing: { btc: 'source-unreadable', eth: 'source-unreadable' },
      comparison: { state: 'unaligned', reason: 'source-unreadable' },
      coverage: []
    }
  }
  const btc = projectEtfAsset(value.btc)
  const eth = projectEtfAsset(value.eth)
  const missing: { btc?: DashboardEtfMissingReason; eth?: DashboardEtfMissingReason } = {}
  // 「一行都没有」与「有行但最新一行给不出可显示的值」是两种缺法：前者从来没发生过，后者发生过但读不出来。
  if (!btc) missing.btc = value.btc.rows.length === 0 ? 'asset-missing' : 'value-missing'
  if (!eth) missing.eth = value.eth.rows.length === 0 ? 'asset-missing' : 'value-missing'
  const state = btc && eth ? 'available' as const : btc || eth ? 'partial' as const : 'unreadable' as const
  return {
    state,
    ...(btc ? { btc } : {}),
    ...(eth ? { eth } : {}),
    ...(missing.btc || missing.eth ? { missing } : {}),
    comparison: etfComparison(btc, eth, missing),
    coverage: etfCoverage(btc, eth),
    verifiedAt: value.verifiedAt
  }
}

/**
 * 能不能并列比较，只看两支**最新交易日**是否同一天。
 *
 * 原来这里比的是 `cumulative.length`，而合法的快照里两支都恰好有两个窗口（5/20 天），那个比较
 * 永远相等——真正的「ETH 晚一天」根本没被它发现，反而靠「任一支缺值就整块作废」掩盖过去。
 */
function etfComparison(
  btc: DashboardEtfFlowAsset | undefined,
  eth: DashboardEtfFlowAsset | undefined,
  missing: Readonly<{ btc?: DashboardEtfMissingReason; eth?: DashboardEtfMissingReason }>
): DashboardEtfComparison {
  if (!btc || !eth) {
    // 缺因就是不可比的原因：`source-unreadable` 优先——连快照都没读到，谈不上哪一支缺。
    const reason = missing.btc === 'source-unreadable' || missing.eth === 'source-unreadable'
      ? 'source-unreadable' as const
      : (missing.btc ?? missing.eth ?? 'asset-missing')
    return { state: 'unaligned', reason }
  }
  const btcDay = btc.rows.at(-1)!.tradingDate
  const ethDay = eth.rows.at(-1)!.tradingDate
  if (btcDay === ethDay) return { state: 'aligned' }
  const lagging = btcDay < ethDay ? 'btc' as const : 'eth' as const
  const [laggingAsset, leadingAsset] = lagging === 'btc' ? [btc, eth] : [eth, btc]
  const laggingLatest = laggingAsset.rows.at(-1)!.tradingDate
  // 按领先一方自己的交易日数，不按自然日：日期不同 ⇒ 至少 1。
  const laggingDays = leadingAsset.rows.filter((row) => row.tradingDate > laggingLatest).length
  return { state: 'unaligned', reason: 'latest-trading-day-differs', lagging, laggingDays }
}

/**
 * 跨两支的窗口覆盖：按 `windowDays` 配对（不是按下标），`min(coveredDays)` + `complete` 相与。
 *
 * 某一侧在但**缺这个窗口** → 那条窗口按「没覆盖」算（`coveredDays: 0`），不整块作废；
 * 某一支整个没有值时只用有值的那一支，`min` 自然退化成它。
 */
function etfCoverage(
  btc: DashboardEtfFlowAsset | undefined,
  eth: DashboardEtfFlowAsset | undefined
): readonly DashboardEtfCumulativeCoverage[] {
  const sides = [btc, eth]
  const present = sides.filter((asset): asset is DashboardEtfFlowAsset => asset !== undefined)
  if (present.length === 0) return []
  const windowDays = [...new Set(present.flatMap((asset) => asset.cumulative.map((window) => window.windowDays)))].sort((left, right) => left - right)
  return windowDays.map((days) => {
    const windows = sides.map((asset) => asset?.cumulative.find((window) => window.windowDays === days))
    const covered = windows.filter((window): window is DashboardEtfCumulativeWindow => window !== undefined)
    const missingWindow = sides.some((asset, index) => asset !== undefined && windows[index] === undefined)
    const coveredDays = missingWindow ? 0 : Math.min(...covered.map((window) => window.coveredDays))
    return { windowDays: days, coveredDays, complete: !missingWindow && covered.every((window) => window.complete) }
  })
}

/** 旧出口只从「两支都有值」的读数派生，别的状态一律 `'unavailable'`（现面板就认这一个词）。 */
function legacyEtfProjection(reading: DashboardEtfReading): DashboardEtfFlow | 'unavailable' {
  if (reading.state !== 'available' || !reading.btc || !reading.eth || !reading.verifiedAt) return dashboardCapitalConditionsPresentationPolicy.etfState
  // 旧出口不再自己算覆盖：直接从读数派生，旧字段删除时这份派生一起收掉。
  return { state: 'available', btc: reading.btc, eth: reading.eth, coverage: reading.coverage, verifiedAt: reading.verifiedAt }
}

function projectFlowHistory(stablecoinHistory: readonly DashboardStablecoinFlow[] | undefined, etf: DashboardEtfReading): DashboardFlowHistory | 'unavailable' {
  if (!stablecoinHistory) return 'unavailable'
  // 只有「快照根本读不到」才算取不到；缺一支时按日交集自然变空，报 `not-yet` 而不是 `unavailable`——
  // 那是「这几天凑不齐同一批日子」，不是「读不到」。
  if (etf.missing?.btc === 'source-unreadable' && etf.missing?.eth === 'source-unreadable') return 'unavailable'
  const funds = new Map(stablecoinHistory.map((row) => [row.tradingDate, row.netFlowUsd]))
  const eth = new Map((etf.eth?.rows ?? []).map((row) => [row.tradingDate, row.netFlowUsd]))
  const rows = (etf.btc?.rows ?? []).flatMap((btc) => {
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
/** The state that belongs to the chip this card draws: the loudest etf-flows signal, same rule as the chip. */
export function etfChipAnalysisOf(read: ModuleSignalAnalysisRead | ModuleSignalRead | undefined): SignalAnalysisStateView | undefined {
  if (!read || read.state !== 'available') return undefined
  const mine = read.signals.filter(entry => entry.signal.moduleId === 'etf-flows')
  if (mine.length === 0) return undefined
  const loudest = mine.reduce((best, entry) =>
    signalSeverityRank[entry.signal.severity] > signalSeverityRank[best.signal.severity] ? entry : best)
  const analysis = (read as { analysis?: Readonly<Record<string, SignalAnalysisStateView>> }).analysis
  return analysis?.[loudest.signal.dedupeKey]
}

/**
 * 形状对、字段齐全，但数字超出显示策略（`Infinity`、`MAX_VALUE`）：与「版本不符」分开，
 * 因为读者看到的动作相同（都不给重试），但排障时要知道是喂来的数不对、不是版本错。
 */
function numbersOutsideDisplayPolicy(value: unknown): boolean {
  if (!isExactRecord(value, ['state', 'asOf', 'etf', 'coreStablecoins', 'conclusion'])) return false
  const core = value.coreStablecoins
  if (!isExactRecord(core, ['observedAt', 'verifiedAt', 'currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent']) &&
    !isExactRecord(core, ['observedAt', 'verifiedAt', 'currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent', 'dailyFlows'])) return false
  const numeric = ['currentUsd', 'change1dUsd', 'change1dPercent', 'change7dUsd', 'change7dPercent', 'change30dUsd', 'change30dPercent']
  return numeric.every((key) => typeof core[key] === 'number') && numeric.some((key) => !isDisplayNumber(core[key]))
}

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
