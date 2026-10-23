/**
 * How long stored bars are kept, and at what resolution.
 *
 * Two stores hold this product's market history — the macro one (the dollar, gold, the basket's
 * currencies) and the cross-asset one (the Nasdaq 100 leg, BTC, ETH) — and neither deletes anything:
 * every five-minute bar ever written is still on disk. That is not a policy, it is the absence of one,
 * and it is what this module states instead.
 *
 * Resolution decays with age rather than the data simply ending, because age is exactly what the fine
 * detail stops being worth:
 *
 * - **Hot**: five-minute bars for the newest {@link barRetentionPolicy.hotMs}. The floor is the
 *   analytic need, not a preference: a seven-day return divides the newest admitted bar against the bar
 *   at exactly the same instant seven days earlier, and the cross-asset analyzer reads that bar by
 *   identity (`prices.has(at)`) rather than by nearest. Thin or drop the newest eight days and the
 *   seven-day column of the table becomes a dash.
 * - **Cold**: one bar per hour, from the hot edge to {@link barRetentionPolicy.coldMs}. Every window
 *   this product prints — `1h`, `24h`, `7d`, and the hourly stride the seven-day chart is sampled at —
 *   reads coarser than an hour no further back than that.
 * - **Dropped**: anything older than `coldMs`. Nothing after this point.
 *
 * A thirty-day cap means a future `30d` window could not use the exact-instant rule the seven-day column
 * uses today, because the instant it wants to divide against would have been thinned away: it would need
 * the nearest-known-close rule the macro curves already use. That is a decision for whoever adds that
 * window, and this comment is where they will find it.
 */
export const barRetentionPolicy = Object.freeze({
  /** The newest eight days are never thinned and never deleted. See the header: this is the floor. */
  hotMs: 8 * 24 * 3_600_000,
  /** Nothing older than this survives, at any resolution. */
  coldMs: 30 * 24 * 3_600_000,
  hourMs: 3_600_000,
  /** Rows per statement, so a compaction never holds the write lock long enough to miss a tick. */
  batchSize: 5_000
})

export type BarRetentionCutoffs = Readonly<{
  /** Five-minute bars older than this are replaced by their hour's close. */
  thinBeforeMs: number
  /** Bars older than this are deleted, whatever their resolution. */
  deleteBeforeMs: number
}>

/** The two instants a pass works from, derived from one clock reading so a pass cannot straddle them. */
export function barRetentionCutoffs(nowMs: number): BarRetentionCutoffs {
  return Object.freeze({
    thinBeforeMs: nowMs - barRetentionPolicy.hotMs,
    deleteBeforeMs: nowMs - barRetentionPolicy.coldMs
  })
}

/**
 * Whether a bar is the one kept for its hour.
 *
 * Bars are stamped on the close of their interval, so the hour's own bar is the one that ends *on* the
 * hour: it carries the same close a reader would see at exactly 14:00, and no interpolation is involved
 * in keeping it. Everything else inside the hour is finer than the cold tier promises.
 */
export function barRetentionKeeps(atMs: number): boolean {
  return Number.isSafeInteger(atMs) && atMs % barRetentionPolicy.hourMs === 0
}
