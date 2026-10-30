import {
  isCanonicalOpenInterestTime,
  isOpenInterestHistoryResult,
  type OpenInterestHistoryResult,
  type OpenInterestWindow
} from '../../../contracts/openInterestHistory'
import {
  resolvePositioningState,
  type LiquidationHint,
  type PositioningState
} from '../../../contracts/openInterestPositioning'

/**
 * The card's view of the positioning series.
 *
 * Validation happens once, here, against the same contract function the IPC layer uses; below
 * this line the panel deals in plain numbers and never re-checks a shape.
 */
export type DashboardPositioningPoint = Readonly<{ observedAt: string; notionalUsd: number }>

export type DashboardPositioningViewState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'empty' }>
  | Readonly<{ state: 'unavailable' }>
  | Readonly<{
      state: 'available'
      window: OpenInterestWindow
      btc: readonly DashboardPositioningPoint[]
      eth: readonly DashboardPositioningPoint[]
      changeBtc?: Readonly<{ h1Pct?: number; h24Pct?: number }>
      changeEth?: Readonly<{ h1Pct?: number; h24Pct?: number }>
      hints: readonly LiquidationHint[]
      hintsTruncated: boolean
      hintsState: 'available' | 'unavailable'
      /** Set when the newest reading is older than the staleness bound. */
      staleSince?: string
    }>

/** Two polling ticks: one missed tick is noise, three is a故障. */
export const dashboardPositioningPresentationPolicy = Object.freeze({
  staleAfterMs: 30 * 60_000,
  chart: Object.freeze({ minimumNotionalSpan: 1, minimumVisibleHeightPercent: 4, maximumHeightPercent: 100 })
})

export function projectDashboardPositioning(value: unknown, asOf: string, window: OpenInterestWindow): DashboardPositioningViewState {
  try {
    if (!isCanonicalOpenInterestTime(asOf)) return { state: 'unavailable' }
    if (!isOpenInterestHistoryResult(value, asOf, window)) return { state: 'unavailable' }
    if (value.state === 'empty') return { state: 'empty' }
    if (value.state === 'unavailable') return { state: 'unavailable' }

    const latest = value.btc.at(-1)?.observedAt ?? value.eth.at(-1)?.observedAt
    const staleSince = latest && Date.parse(asOf) - Date.parse(latest) > dashboardPositioningPresentationPolicy.staleAfterMs ? latest : undefined
    return {
      state: 'available',
      window,
      btc: value.btc.map(toPoint),
      eth: value.eth.map(toPoint),
      ...(value.change?.btc ? { changeBtc: value.change.btc } : {}),
      ...(value.change?.eth ? { changeEth: value.change.eth } : {}),
      hints: value.liquidationHints ?? [],
      hintsTruncated: value.liquidationHintsTruncated === true,
      hintsState: value.liquidationHintsState,
      ...(staleSince ? { staleSince } : {})
    }
  } catch {
    return { state: 'unavailable' }
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
