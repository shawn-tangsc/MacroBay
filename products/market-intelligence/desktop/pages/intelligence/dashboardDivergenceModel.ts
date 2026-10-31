import type { DivergenceLeg, MarketDivergenceResult } from '../../../contracts/marketDivergence'
import { isMarketDivergenceResult } from '../../../contracts/marketDivergence'

/** What the card renders: the rows it may show, and the pairs it had to refuse. */
export type DashboardDivergenceViewState =
  | Readonly<{ state: 'loading' }>
  | Readonly<{ state: 'unavailable' }>
  | Readonly<{ state: 'empty'; withheld: readonly DivergenceWithheldView[] }>
  | Readonly<{ state: 'available'; rows: readonly DivergenceRowView[]; withheld: readonly DivergenceWithheldView[] }>

export type DivergenceWithheldView = Readonly<{
  pairId: string
  reason: 'window-mismatch' | 'leg-missing' | 'leg-stale'
  leg: DivergenceLeg['id']
  /** The instant the leg stopped, when the reason is a window mismatch. */
  observedAt?: string
}>

export type DivergenceRowView = Readonly<{
  pairId: string
  direction: 'bearish' | 'bullish' | 'unpriced'
  legs: readonly Readonly<{ id: DivergenceLeg['id']; text: string }>[]
}>

/**
 * Turns the DTO into what the card needs: leg values already formatted, and the reason a pair was
 * withheld reduced to the leg that caused it.
 *
 * Formatting lives here rather than in the panel so the same numbers read identically wherever the
 * card appears, and so the panel stays a rendering of a view model.
 */
export function projectDashboardDivergence(value: unknown, asOf: string): DashboardDivergenceViewState {
  if (!isMarketDivergenceResult(value, asOf)) return { state: 'unavailable' }
  if (value.state === 'unavailable') return { state: 'unavailable' }
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
      legs: row.legs.map(leg => ({ id: leg.id, text: formatLeg(leg) }))
    })),
    withheld
  }
}

/** Percentages keep two decimals; a dollar flow reads in millions; funding keeps its own unit. */
export function formatLeg(leg: DivergenceLeg): string {
  if (leg.id === 'sentiment' && leg.label) return leg.label
  if (leg.unit === 'usd') return `${leg.value < 0 ? '−' : '+'}$${Math.abs(leg.value / 1e6).toFixed(0)}M`
  const percent = `${leg.value < 0 ? '−' : '+'}${Math.abs(leg.value).toFixed(leg.unit === 'percent-per-8h' ? 4 : 2)}%`
  return leg.unit === 'percent-per-8h' ? `${percent} / 8h` : percent
}
