import { dollarIndexFormula, macroMarketPolicy } from './macroMarketPolicy'
import type { ProviderBar } from './twelveDataTimeSeries'

/**
 * The synthetic index across the whole backfilled window, not just its newest bar.
 *
 * The provider publishes the six currencies with history but no index, so an index built from only
 * the latest close has one point per collection — and every window longer than the collection
 * interval then reads "no data", which is precisely what the reader saw: a dollar level with no 1h,
 * 4h or 24h change behind it.
 *
 * A timestamp becomes an index point only when **every** currency has a bar there: an index missing a
 * term is not an index.
 */
export function synthesizeDollarIndexSeries(bars: readonly ProviderBar[]): readonly Readonly<{ atMs: number; value: number }>[] {
  const bySymbol = new Map<string, Map<number, number>>()
  for (const term of dollarIndexFormula.terms) bySymbol.set(term.symbol, new Map())
  for (const bar of bars) bySymbol.get(bar.symbol)?.set(bar.atMs, Number(bar.close))
  const [first, ...rest] = dollarIndexFormula.terms.map(term => bySymbol.get(term.symbol)!)
  if (!first) return []
  const points: { atMs: number; value: number }[] = []
  for (const atMs of [...first.keys()].sort((a, b) => a - b)) {
    if (!rest.every(series => series.has(atMs))) continue
    let value = dollarIndexFormula.constant
    for (const term of dollarIndexFormula.terms) value *= bySymbol.get(term.symbol)!.get(atMs)! ** term.exponent
    if (Number.isFinite(value)) points.push({ atMs, value })
  }
  return points
}

export const dollarIndexSeriesId = macroMarketPolicy.series.dollarIndex
