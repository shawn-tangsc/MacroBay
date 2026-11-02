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

/**
 * The card's view of the positioning series.
 *
 * Validation happens once, here, against the same contract function the IPC layer uses; below
 * this line the panel deals in plain numbers and never re-checks a shape.
 */
export type DashboardPositioningPoint = Readonly<{ observedAt: string; notionalUsd: number }>

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
      /** What the module's rule says right now. Hidden means "nothing to say" — no chip at all. */
      signal: DashboardSignalChip
      /**
       * Re-reads the card. Carried on the view state because the error surface needs a recovery
       * action and the panel is the component that draws it, not the page that owns the hook.
       */
      onReload: () => void
    }>

/**
 * The card's chip, as a state rather than a string.
 *
 * Three shapes and no fourth: a normal market draws nothing, a rule that fired draws its own words
 * and numbers, and a rule that could not read its data says so without a single digit. Severity is
 * deliberately absent — the panel may order two signals by it, the reader must not compare two
 * modules by it.
 */
export type DashboardSignalChip =
  | Readonly<{ state: 'hidden' }>
  | Readonly<{ state: 'insufficient' }>
  | Readonly<{
      state: 'alert'
      asset: 'btc' | 'eth'
      dropPct: number
      volumeMultiple: number
      ruleId: string
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
      // The card no longer carries the query's hint marks: the chip and the chart mark both come
      // from the module rule, so one reading cannot be drawn as two different things.
      signal: { state: 'hidden' },
      onReload,
      ...(staleSince ? { staleSince } : {})
    }
  } catch {
    return { state: 'unavailable', onReload }
  }
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
export function projectModuleSignalChip(
  signals: readonly ModuleSignal[] | undefined,
  moduleId: ModuleSignal['moduleId'] = 'open-interest'
): DashboardSignalChip {
  const mine = (signals ?? []).filter(signal => signal.moduleId === moduleId)
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
  return { state: 'alert', asset, dropPct, volumeMultiple, ruleId: loudest.ruleId, observedAt }
}
