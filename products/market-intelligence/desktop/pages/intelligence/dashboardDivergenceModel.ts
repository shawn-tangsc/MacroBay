import type { DivergenceLeg, MarketDivergenceResult } from '../../../contracts/marketDivergence'
import { isMarketDivergenceResult } from '../../../contracts/marketDivergence'

/** What the card renders: the rows it may show, and the pairs it had to refuse. */
export type DashboardDivergenceViewState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'unavailable'; reason: 'all-legs-missing' | 'query-failed' | 'invalid-clock' | 'too-large' | 'bad-payload' | 'bad-answer'; missing: readonly DivergenceLeg['id'][] }>
  | Readonly<{ state: 'empty'; withheld: readonly DivergenceWithheldView[] }>
  | Readonly<{ state: 'available'; rows: readonly DivergenceRowView[]; withheld: readonly DivergenceWithheldView[] }>

export type DivergenceWithheldView = Readonly<{
  pairId: string
  reason: 'window-mismatch' | 'leg-missing' | 'leg-stale' | 'leg-unavailable'
  leg: DivergenceLeg['id']
  /** The instant the leg stopped, when the reason is a window mismatch. */
  observedAt?: string
}>

export type DivergenceRowView = Readonly<{
  pairId: string
  direction: 'bearish' | 'bullish' | 'unpriced'
  /** `observedAt` rides along so the chip's detail can say how fresh each leg is. */
  legs: readonly Readonly<{ id: DivergenceLeg['id']; text: string; observedAt: string }>[]
}>

/**
 * Turns the DTO into what the card needs: leg values already formatted, and the reason a pair was
 * withheld reduced to the leg that caused it.
 *
 * Formatting lives here rather than in the panel so the same numbers read identically wherever the
 * card appears, and so the panel stays a rendering of a view model.
 */
export function projectDashboardDivergence(value: unknown, asOf: string): DashboardDivergenceViewState {
  if (!isMarketDivergenceResult(value, asOf)) return { state: 'unavailable', reason: 'query-failed', missing: [] }
  if (value.state === 'unavailable') return { state: 'unavailable', reason: value.reason, missing: value.missing }
  const withheld = value.withheld.map(entry => ({
    pairId: entry.pairId,
    reason: entry.reason,
    leg: entry.leg,
    ...(entry.observedAt ? { observedAt: entry.observedAt } : {})
  }))
  if (value.state === 'empty') return { state: 'empty', withheld }
  return {
    state: 'available',
    rows: value.rows.map(row => ({
      pairId: row.pairId,
      direction: row.direction,
      legs: row.legs.map(leg => ({ id: leg.id, text: formatLeg(leg), observedAt: leg.observedAt })),
    })),
    withheld
  }
}

/** Percentages keep two decimals; a dollar flow reads in millions; funding keeps its own unit. */
export function formatLeg(leg: DivergenceLeg): string {
  // A share, not a change: 62% of the headlines that took a side were bearish. The sign a change
  // formatter would add (+62%) would read as a gain.
  if (leg.id === 'sentiment') return `${Math.round(leg.value)}%`
  if (leg.unit === 'usd') return `${leg.value < 0 ? '−' : '+'}$${Math.abs(leg.value / 1e6).toFixed(0)}M`
  const percent = `${leg.value < 0 ? '−' : '+'}${Math.abs(leg.value).toFixed(leg.unit === 'percent-per-8h' ? 4 : 2)}%`
  return leg.unit === 'percent-per-8h' ? `${percent} / 8h` : percent
}
