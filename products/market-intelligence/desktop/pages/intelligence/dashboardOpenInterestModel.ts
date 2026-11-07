import {
  isCanonicalOpenInterestTime,
  isOpenInterestHistoryResult,
  type OpenInterestHistoryResult,
  type OpenInterestWindow
} from '../../../contracts/openInterestHistory'
import {
  resolvePositioningState,
  type PositioningState
} from '../../../contracts/openInterestPositioning'
import type { ModuleSignal, SignalSeverity } from '../../../contracts/moduleSignal'
import type { ModuleSignalRead, ModuleSignalReadFailureCode } from '../../../contracts/moduleSignalRead'
import type { ModuleSignalAnalysisRead } from '../../../service/intelligence/analysis/signalAnalysisRead'
import type { SignalAnalysisStateView } from '../../../service/intelligence/analysis/signalAnalysisState'

/**
 * The card's view of the positioning series.
 *
 * Validation happens once, here, against the same contract function the IPC layer uses; below
 * this line the panel deals in plain numbers and never re-checks a shape.
 */
export type DashboardPositioningPoint = Readonly<{ observedAt: string; notionalUsd: number }>

/**
 * 图上的一个「疑似强平」点：账本里这一格命中了，就画一个。
 *
 * 它跟着**卡片的窗口**走（7 天视图画 7 天内的全部命中，24 小时画 24 小时内的），
 * 与牌子同源、与通知不同源：通知永远只按 24 小时判。
 */
export type DashboardLiquidationMark = Readonly<{
  asset: 'btc' | 'eth'
  /**
   * 哪一边被清。**从 DTO 原样带过来，绝不由跌幅正负去猜**：方向是规则的属性，空头那条判的是
   * 价格上涨；按读数符号反推，某天阈值或符号约定变一次就会把两头说反。
   */
  direction: 'long' | 'short'
  observedAt: string
  /** 判定那一格的持仓名义额：点就画在这个高度上。 */
  notionalUsd: number
  dropPct: number
  volumeMultiple: number
}>

export type DashboardPositioningViewState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'empty'; onReload: () => void }>
  | Readonly<{ state: 'unavailable'; onReload: () => void }>
  | Readonly<{
      state: 'available'
      window: OpenInterestWindow
      btc: readonly DashboardPositioningPoint[]
      eth: readonly DashboardPositioningPoint[]
      changeBtc?: Readonly<{ h1Pct?: number; h24Pct?: number }>
      changeEth?: Readonly<{ h1Pct?: number; h24Pct?: number }>
      /** Set when the newest reading is older than the staleness bound. */
      staleSince?: string
      /** 当前窗口内的全部命中，图上逐个画点（查询已按 window 裁剪）。 */
      hints: readonly DashboardLiquidationMark[]
      /** 窗口内有、但没画出来的命中数（查询只给最近 8 条）。0 表示「都画出来了」。 */
      hiddenHits: number
      /** What the module's rule says right now. Hidden means "nothing to say" — no chip at all. */
      signal: DashboardSignalChip
      /** 这条信号的分析到哪一步；与信号并列，不塞进 `signal`。 */
      signalAnalysis?: SignalAnalysisStateView
      /**
       * Re-reads the card. Carried on the view state because the error surface needs a recovery
       * action and the panel is the component that draws it, not the page that owns the hook.
       */
      onReload: () => void
    }>

/**
 * The card's chip, as a state rather than a string.
 *
 * Four shapes and no fifth: a normal market draws nothing, a rule that fired draws its own words and
 * numbers, a rule that could not read its data says so without a single digit, and a read that never
 * happened says that instead — the reader's next move is a retry, not a wait. Severity is
 * deliberately absent — the panel may order two signals by it, the reader must not compare two
 * modules by it.
 */
export type DashboardSignalChip =
  | Readonly<{ state: 'hidden' }>
  | Readonly<{ state: 'insufficient' }>
  | Readonly<{
      /** The signal read itself failed; the code decides whether a retry is offered. */
      state: 'unreadable'
      failureCode: ModuleSignalReadFailureCode
      /** Re-reads the card, the only action a failed read suggests. */
      onReload: () => void
    }>
  | Readonly<{
      state: 'alert'
      asset: 'btc' | 'eth'
      /** 哪一边被清：由规则 id 决定（方向是规则的属性），读者看到的词从它映射。 */
      direction: 'long' | 'short'
      dropPct: number
      /** 判定那一格的带符号涨跌；老记录没有就不带，牌子改用降幅。 */
      pricePct?: number
      volumeMultiple: number
      observedAt: string
    }>

/** Two polling ticks: one missed tick is noise, three is a故障. */
export const dashboardPositioningPresentationPolicy = Object.freeze({
  staleAfterMs: 30 * 60_000,
  chart: Object.freeze({ minimumNotionalSpan: 1, minimumVisibleHeightPercent: 4, maximumHeightPercent: 100 })
})

export function projectDashboardPositioning(value: unknown, asOf: string, window: OpenInterestWindow, onReload: () => void = () => undefined): DashboardPositioningViewState {
  try {
    if (!isCanonicalOpenInterestTime(asOf)) return { state: 'unavailable', onReload }
    if (!isOpenInterestHistoryResult(value, asOf, window)) return { state: 'unavailable', onReload }
    if (value.state === 'empty') return { state: 'empty', onReload }
    if (value.state === 'unavailable') return { state: 'unavailable', onReload }

    const latest = value.btc.at(-1)?.observedAt ?? value.eth.at(-1)?.observedAt
    const staleSince = latest && Date.parse(asOf) - Date.parse(latest) > dashboardPositioningPresentationPolicy.staleAfterMs ? latest : undefined
    return {
      state: 'available',
      window,
      btc: value.btc.map(toPoint),
      eth: value.eth.map(toPoint),
      ...(value.change?.btc ? { changeBtc: value.change.btc } : {}),
      ...(value.change?.eth ? { changeEth: value.change.eth } : {}),
      // 点来自当前窗口的命中（账本），牌子来自同一套规则的窗口判定；两者同源、互不替代。
      hints: (value.liquidationHintsState === 'available' ? value.liquidationHints ?? [] : []).map(mark),
      // 截断才报数：不截断时读者不需要知道「一共有几条」，卡面也不多写一个字。
      hiddenHits: Math.max(0, (value.liquidationHintsTotal ?? value.liquidationHints?.length ?? 0) - (value.liquidationHints?.length ?? 0)),
      signal: { state: 'hidden' },
      onReload,
      ...(staleSince ? { staleSince } : {})
    }
  } catch {
    return { state: 'unavailable', onReload }
  }
}

function mark(hint: Readonly<{
  asset: 'btc' | 'eth'
  direction: 'long' | 'short'
  observedAt: string
  notionalUsd: number
  dropPct: number
  volumeMultiple: number
}>): DashboardLiquidationMark {
  return Object.freeze({
    asset: hint.asset,
    direction: hint.direction,
    observedAt: hint.observedAt,
    notionalUsd: hint.notionalUsd,
    dropPct: hint.dropPct,
    volumeMultiple: hint.volumeMultiple
  })
}

function toPoint(point: Readonly<{ observedAt: string; notionalUsd: number }>): DashboardPositioningPoint {
  return Object.freeze({ observedAt: point.observedAt, notionalUsd: point.notionalUsd })
}

/**
 * The state label is resolved from the two series the card already holds rather than shipped in
 * the DTO: the same pure function answers here and in the analysis snapshot.
 *
 * `undefined` means "cannot say", which the card renders as no label at all.
 */
export function positioningStateFor(
  positioning: DashboardPositioningViewState,
  fundingPoints: readonly Readonly<{ observedAt: string; ratePercent: number }>[] | undefined,
  change: Readonly<{ h1Pct?: number; h24Pct?: number }> | undefined
): PositioningState | undefined {
  if (positioning.state !== 'available' || !fundingPoints || fundingPoints.length === 0 || !change) return undefined
  return resolvePositioningState({
    notionalChange24hPct: change.h24Pct,
    fundingNowPct: fundingPoints.at(-1)?.ratePercent,
    // The funding series is 8-hourly, so "a day ago" is three points back, not a timestamp.
    fundingAgoPct: fundingPoints.at(-4)?.ratePercent
  })
}

export function formatDashboardNotional(value: number): string {
  if (!Number.isFinite(value)) return ''
  const billion = value / 1e9
  return billion >= 1 ? `$${billion.toFixed(2)}B` : `$${(value / 1e6).toFixed(0)}M`
}

export function formatDashboardChange(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

const severityRank: Readonly<Record<SignalSeverity, number>> = Object.freeze({ high: 3, medium: 2, low: 1 })

/**
 * Picks the one signal this card may show.
 *
 * The rule is the product's: one chip per module, and when several speak at once the loudest one
 * wins. A second chip beside the first would let a reader compare two readings the product says are
 * not comparable, and three chips on one card is a wall, not a signal.
 *
 * The card reads its own module only. A signal from another module belongs to that module's card.
 */
/** The state of the signal this card's chip draws: the loudest one, the same rule the chip uses. */
export function chipAnalysisOf(
  read: ModuleSignalAnalysisRead | ModuleSignalRead | undefined,
  moduleId: ModuleSignal['moduleId'] = 'open-interest'
): SignalAnalysisStateView | undefined {
  if (!read || read.state !== 'available') return undefined
  const mine = read.signals.filter(entry => entry.signal.moduleId === moduleId)
  if (mine.length === 0) return undefined
  const loudest = mine.reduce((best, entry) =>
    severityRank[entry.signal.severity] > severityRank[best.signal.severity] ? entry : best)
  return (read as { analysis?: Readonly<Record<string, SignalAnalysisStateView>> }).analysis?.[loudest.signal.dedupeKey]
}

export function projectModuleSignalChip(
  read: ModuleSignalRead | undefined,
  moduleId: ModuleSignal['moduleId'] = 'open-interest',
  onReload: () => void = () => undefined
): DashboardSignalChip {
  // No read at all is "not yet", not "nothing happened": the card is still loading its own data and
  // has nothing to say about the signal either. A read that failed is its own state, because the
  // reader can retry it and cannot retry a quiet market.
  if (read === undefined) return { state: 'hidden' }
  if (read.state === 'unavailable') return { state: 'unreadable', failureCode: read.failureCode, onReload }
  const mine = read.signals.map(entry => entry.signal).filter(signal => signal.moduleId === moduleId)
  if (mine.length === 0) return { state: 'hidden' }
  const loudest = mine.reduce((best, signal) => severityRank[signal.severity] > severityRank[best.severity] ? signal : best)
  // A rule that could not finish reading says only that. Printing its partial numbers would be a
  // guess wearing the same clothes as a reading.
  if (loudest.readiness !== 'available') return { state: 'insufficient' }
  const { asset, observedAt } = loudest
  const dropPct = loudest.values.dropPct
  const volumeMultiple = loudest.values.volumeMultiple
  if (asset === null || observedAt === undefined || dropPct === undefined || volumeMultiple === undefined) {
    return { state: 'insufficient' }
  }
  // 方向由规则 id 说死：两条规则各一个 id，不靠读数符号去猜。
  const direction = loudest.ruleId === 'oi-short-liquidation-proxy' ? 'short' as const : 'long' as const
  const pricePct = loudest.values.priceChangePct
  return {
    state: 'alert', asset, direction, dropPct,
    ...(Number.isFinite(pricePct) ? { pricePct } : {}),
    volumeMultiple, observedAt
  }
}
