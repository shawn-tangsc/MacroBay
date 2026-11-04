import type { ClosedBar } from '../cross-asset/binanceCrossAssetClient'

/**
 * Fill the quote bars this edition needs, once, before the generation waits for them.
 *
 * The collector already backfills missing windows — but only when its own connection loop is running.
 * At generation time nothing asked it to: the 07:00 bar that arrived at 07:21 was fetched by the live
 * connector's next pass, so the run sat in the readiness wait and then published without BTC or ETH.
 *
 * This is that ask, and only that ask. It uses the same collector, sends no request at all when the
 * two bars it needs are already stored, and stops after a couple of pages instead of walking a day of
 * history for one bar. The transport is the collector's own (platform fetch, so proxy settings apply);
 * nothing here opens a socket or builds a request.
 */
export const briefingBarBackfillPolicy = Object.freeze({
  /** Pages of the collector to consume at most: one missing close must not become a day of REST calls. */
  maxPages: 2
})

/** The assets whose quotes the edition cannot be written without. */
export const briefingBarAssets = Object.freeze(['btc', 'eth'] as const)
type BriefingBarAsset = (typeof briefingBarAssets)[number]

export type BriefingBarBackfill = Readonly<{
  /**
   * Whether one bar is stored for the asset at the instant (as known then).
   */
  hasBar: (input: Readonly<{ asset: BriefingBarAsset; atMs: number; asOfMs: number }>) => boolean
  /** The collector's own generator for one asset, ending at the instant. */
  collect: (input: Readonly<{ asset: BriefingBarAsset; endMs: number; asOfMs: number }>) => AsyncGenerator<readonly ClosedBar[]>
  /** The store's own append, so the bars land exactly where the collector would have put them. */
  append: (bars: readonly ClosedBar[], observedAtMs: number) => void
}>

export type BriefingBarBackfillOutcome = Readonly<{
  /** Whether a fetch was attempted at all: `false` means the bars were already stored. */
  attempted: boolean
  /** Whether every bar this edition needs is stored now. */
  filled: boolean
}>

/**
 * Ensure the two bars the edition needs exist, fetching at most once.
 *
 * `atMs` is the edition's cutoff (floored to the interval) and `dayBeforeMs` the bar 24 hours earlier
 * that the return is computed against. Both are needed: fetching only the cutoff bar would leave the
 * return without its other end.
 */
export async function ensureBriefingBars(
  backfill: BriefingBarBackfill,
  input: Readonly<{ atMs: number; dayBeforeMs: number; asOfMs: number }>
): Promise<BriefingBarBackfillOutcome> {
  const missing = briefingBarAssets.filter((asset) =>
    !backfill.hasBar({ asset, atMs: input.atMs, asOfMs: input.asOfMs }) ||
    !backfill.hasBar({ asset, atMs: input.dayBeforeMs, asOfMs: input.asOfMs }))
  // Nothing missing means nothing to ask for: the common case must cost zero requests.
  if (missing.length === 0) return { attempted: false, filled: true }
  for (const asset of missing) {
    let pages = 0
    for await (const bars of backfill.collect({ asset, endMs: input.atMs, asOfMs: input.asOfMs })) {
      if (bars.length > 0) backfill.append(bars, input.asOfMs)
      pages += 1
      if (pages >= briefingBarBackfillPolicy.maxPages) break
    }
  }
  const filled = briefingBarAssets.every((asset) =>
    backfill.hasBar({ asset, atMs: input.atMs, asOfMs: input.asOfMs }) &&
    backfill.hasBar({ asset, atMs: input.dayBeforeMs, asOfMs: input.asOfMs }))
  return { attempted: true, filled }
}
