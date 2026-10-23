import type { RealMarketApiFailureCode } from '../macro-market/realMarketApiPolicy'
import { parseRealMarketApiBars } from '../macro-market/realMarketApiTimeSeries'
import type { ClosedBar, StoredSymbol } from './binanceCrossAssetClient'
import { crossAssetPolicy } from './crossAssetPolicy'

/**
 * The licensed Nasdaq 100 candles, read as this product's closed bars.
 *
 * Two refusals are the whole point of this file:
 *
 * 1. A bar whose stamp is not on the five-minute grid is dropped. The history, the curves and the
 *    analysis all key on that grid, so a stamp between two instants is not a bar this product can
 *    store — and rounding it onto the grid would move a price to an instant the provider never
 *    published it for.
 * 2. A bar that has not closed by the time we read it is dropped. The provider publishes the bar it
 *    is currently building; storing it would print a value that is still moving as if it were final.
 */
export const crossAssetIndexFeedPolicy = Object.freeze({
  /** A cash index publishes no traded volume; the store's column is a decimal, so it reads zero. */
  absentVolume: '0'
})

export type CrossAssetIndexBarsResult =
  | Readonly<{ state: 'available'; bars: readonly ClosedBar[]; offGrid: number; forming: number }>
  | Readonly<{ state: 'unavailable'; failureCode: RealMarketApiFailureCode }>

export function crossAssetIndexBars(payload: unknown, httpStatus: number, observedAtMs: number): CrossAssetIndexBarsResult {
  const symbol = crossAssetPolicy.index.symbol
  const parsed = parseRealMarketApiBars(payload, httpStatus, symbol)
  if (parsed.state === 'unavailable') return parsed
  const step = crossAssetPolicy.intervalMs
  const bars: ClosedBar[] = []
  let offGrid = 0
  let forming = 0
  for (const bar of parsed.bars) {
    if (bar.atMs % step !== 0) { offGrid++; continue }
    if (bar.atMs + step > observedAtMs) { forming++; continue }
    const open = decimalText(bar.open)
    const high = decimalText(bar.high)
    const low = decimalText(bar.low)
    const close = decimalText(bar.close)
    if (!open || !high || !low || !close) continue
    // Volume is the one field no window reads. It is reported as published when it is a decimal this
    // store can hold, and as an explicit zero when the provider published none or published a form we
    // cannot store — never as a price-like number invented from the other fields.
    const volume = (bar.volume === undefined ? undefined : decimalText(bar.volume)) ?? crossAssetIndexFeedPolicy.absentVolume
    bars.push({
      symbol: symbol as StoredSymbol, barOpenMs: bar.atMs, barEndMs: bar.atMs + step,
      open, high, low, close, volume
    })
  }
  return bars.length > 0
    ? Object.freeze({ state: 'available' as const, bars: Object.freeze(bars), offGrid, forming })
    : Object.freeze({ state: 'unavailable' as const, failureCode: 'response-invalid' as const })
}

/** The store's decimal form, or `undefined` when the number cannot be written as one. */
function decimalText(value: number): string | undefined {
  const text = String(value)
  return crossAssetPolicy.decimalPattern.test(text) && text.length <= crossAssetPolicy.decimalMaxLength ? text : undefined
}
