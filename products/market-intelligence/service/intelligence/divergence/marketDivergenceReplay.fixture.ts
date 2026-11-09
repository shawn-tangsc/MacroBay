import type { DivergenceSentimentLeg } from './marketDivergenceQuery'

/**
 * One recorded afternoon of the six divergence legs, replayed so the card's refusals are counted
 * rather than recalled.
 *
 * What it froze: under the old rules — one six-hour freshness bound for every intraday leg, and a
 * price leg anchored on the close of `floor(asOf)` — this afternoon refused at least one pair at
 * **37 of 55** samples. With per-leg freshness and the stepping-back price leg, **2 of 55** samples
 * refuse, both because the copy had no bar to answer with. A branch-level unit test cannot show
 * either number; only the series can.
 *
 * The previous estimate of this contrast was "every sample", which was wrong: it came from a replay
 * whose sentiment reader had not been wired, so every sample lost a leg to the harness rather than
 * to the card. Fixing the harness is how the number became 37 — which is the reason this file
 * exists rather than a paragraph repeating the number.
 *
 * Provenance, so the contrast can be reproduced:
 *
 * - Instant window: 2026-10-31T10:00:23.000Z → 14:30:23.000Z (UTC+8 18:00:23 → 22:30:23), five
 *   minutes apart, 55 samples. The window covers the evening the reader reported the card on, so
 *   the two refusals it contains are the ones that were on screen.
 * - Data: a read-only copy, taken 2026-11-01T00:12:00+08:00, of the local product directory
 *   `~/Library/Application Support/MacroBay/products/market-intelligence` — the `perpetual-positioning`,
 *   `funding-rate-history`, `etf-current-state`, `cross-asset-market` and
 *   `intelligence-news-sentiment` sqlite stores, plus `capital-conditions-state.json` and
 *   `intelligence-pipeline-state.json`.
 * - Every reading is stored with the instant the leg itself describes, never with the sample
 *   instant: the rules compare moments, so the fixture carries the same facts the reader did.
 * - `priceStrict` is what the price leg answered before it learned to step back (the snapshot
 *   anchored on `floor(asOf)`); `price` is the current answer. Both are kept so the "before" side of
 *   the contrast is measured from the same rows rather than from memory.
 * - The sentiment leg answered on every sample of this window (its bearish share stayed between
 *   86% and 89%), so the zero-share case that `MI-1-D5` fixed is not in this series; that one is
 *   held by the unit cases, and this file must not be read as covering it.
 * - Two samples have no price at all: the copy had no bar for them even 25 minutes back. On a live
 *   feed the leg answers; here the fixture records the gap instead of inventing a bar.
 */
export type ReplayReading = Readonly<{ value: number; observedAt: string }>

/** One sample: the legs as they answered, and the pairs the card refused at that instant. */
export type DivergenceReplayRecord = Readonly<{
  /** The instant the card was asked about. */
  at: string
  stablecoin: ReplayReading | null
  openInterest: ReplayReading | null
  funding: ReplayReading | null
  /** The price leg as it answers now: the newest close that exists, up to 25 minutes back. */
  price: ReplayReading | null
  /** The same leg under the old rule: the close of `floor(at)` only, with no step back. */
  priceStrict: ReplayReading | null
  sentiment: DivergenceSentimentLeg
  /** `[pair, leg, reason]` for each pair the card held back at this instant. */
  refused: readonly (readonly [string, string, string])[]
}>

const p = (value: number, observedAt: string): ReplayReading => ({ value, observedAt })
const s = (bearishSharePercent: number, scoredCount: number, observedAt: string): DivergenceSentimentLeg =>
  ({ state: 'available', bearishSharePercent, scoredCount, observedAt })
const e = (): DivergenceSentimentLeg => ({ state: 'empty', reason: 'no-scored-items' })
const u = (): DivergenceSentimentLeg => ({ state: 'unavailable' })

export const divergenceReplay = Object.freeze({
  /** Where the samples came from; the test checks the arithmetic, this says how to redo the read. */
  window: Object.freeze({
    from: '2026-10-31T10:00:23.000Z', to: '2026-10-31T14:30:23.000Z', stepMs: 300_000, samples: 55,
    recordedAt: '2026-11-01T00:12:00+08:00',
    copyOf: '~/Library/Application Support/MacroBay/products/market-intelligence'
  }),
  /** The two numbers this file exists for: refused before the fix, and refused after it. */
  contrast: Object.freeze({ refusedBeforeFix: 37, refusedAfterFix: 2 }),
  /**
   * The three finished sessions the ETF leg summed, oldest first.
   *
   * The store held thirty; the pair reads the newest three, so the fixture keeps exactly those, and
   * the same reading is used at every sample — the window did not move during the afternoon.
   */
  etfRows: Object.freeze([
    Object.freeze({ tradingDate: '2026-10-28', netFlowUsd: 137300000 }),
    Object.freeze({ tradingDate: '2026-10-29', netFlowUsd: 17200000 }),
    Object.freeze({ tradingDate: '2026-10-30', netFlowUsd: -643200000 })
  ]),
  /** `satisfies` 而不是断言：这份样本必须真的是 `DivergenceReplayRecord[]`，`refused` 是三元组、
   *  不是 `string[]`——否则读它的用例只能靠猜。 */
  records: Object.freeze([
  { at: '2026-10-31T10:00:23.000Z', stablecoin: p(-1.077379, '2026-10-31T09:58:31.392Z'), openInterest: p(1.48, '2026-10-31T10:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.300144, '2026-10-31T09:55:00.000Z'), priceStrict: null, sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:05:23.000Z', stablecoin: p(-1.077379, '2026-10-31T09:58:31.392Z'), openInterest: p(1.48, '2026-10-31T10:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.300144, '2026-10-31T09:55:00.000Z'), priceStrict: null, sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:10:23.000Z', stablecoin: p(-1.077379, '2026-10-31T09:58:31.392Z'), openInterest: p(1.48, '2026-10-31T10:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.300144, '2026-10-31T09:55:00.000Z'), priceStrict: null, sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:15:23.000Z', stablecoin: p(-1.077379, '2026-10-31T09:58:31.392Z'), openInterest: p(1.65, '2026-10-31T10:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: null, priceStrict: null, sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [['flows-price', 'price', 'leg-missing'], ['narrative-price', 'price', 'leg-missing']] },
  { at: '2026-10-31T10:20:23.000Z', stablecoin: p(-1.077379, '2026-10-31T09:58:31.392Z'), openInterest: p(1.65, '2026-10-31T10:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.300144, '2026-10-31T09:55:00.000Z'), priceStrict: null, sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:25:23.000Z', stablecoin: p(-1.077379, '2026-10-31T09:58:31.392Z'), openInterest: p(1.65, '2026-10-31T10:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.019495, '2026-10-31T10:25:00.000Z'), priceStrict: p(0.019495, '2026-10-31T10:25:00.000Z'), sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:30:23.000Z', stablecoin: p(-1.077379, '2026-10-31T09:58:31.392Z'), openInterest: p(1.52, '2026-10-31T10:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.019495, '2026-10-31T10:25:00.000Z'), priceStrict: null, sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:35:23.000Z', stablecoin: p(-1.077379, '2026-10-31T09:58:31.392Z'), openInterest: p(1.52, '2026-10-31T10:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.083817, '2026-10-31T10:35:00.000Z'), priceStrict: p(-0.083817, '2026-10-31T10:35:00.000Z'), sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:40:23.000Z', stablecoin: p(-1.077657, '2026-10-31T10:39:33.321Z'), openInterest: p(1.52, '2026-10-31T10:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.083817, '2026-10-31T10:35:00.000Z'), priceStrict: null, sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:45:23.000Z', stablecoin: p(-1.077657, '2026-10-31T10:39:33.321Z'), openInterest: p(1.51, '2026-10-31T10:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.266153, '2026-10-31T10:45:00.000Z'), priceStrict: p(-0.266153, '2026-10-31T10:45:00.000Z'), sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:50:23.000Z', stablecoin: p(-1.077657, '2026-10-31T10:39:33.321Z'), openInterest: p(1.51, '2026-10-31T10:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.264178, '2026-10-31T10:50:00.000Z'), priceStrict: p(-0.264178, '2026-10-31T10:50:00.000Z'), sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T10:55:23.000Z', stablecoin: p(-1.077657, '2026-10-31T10:39:33.321Z'), openInterest: p(1.51, '2026-10-31T10:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.391613, '2026-10-31T10:55:00.000Z'), priceStrict: p(-0.391613, '2026-10-31T10:55:00.000Z'), sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:00:23.000Z', stablecoin: p(-1.077657, '2026-10-31T10:39:33.321Z'), openInterest: p(1.4, '2026-10-31T11:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.391613, '2026-10-31T10:55:00.000Z'), priceStrict: null, sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:05:23.000Z', stablecoin: p(-1.077657, '2026-10-31T10:39:33.321Z'), openInterest: p(1.4, '2026-10-31T11:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.412761, '2026-10-31T11:05:00.000Z'), priceStrict: p(-0.412761, '2026-10-31T11:05:00.000Z'), sentiment: s(89, 9, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:10:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.4, '2026-10-31T11:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.412761, '2026-10-31T11:05:00.000Z'), priceStrict: null, sentiment: s(88, 8, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:15:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.63, '2026-10-31T11:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.360245, '2026-10-31T11:15:00.000Z'), priceStrict: p(-0.360245, '2026-10-31T11:15:00.000Z'), sentiment: s(88, 8, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:20:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.63, '2026-10-31T11:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.360245, '2026-10-31T11:15:00.000Z'), priceStrict: null, sentiment: s(88, 8, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:25:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.63, '2026-10-31T11:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.360245, '2026-10-31T11:15:00.000Z'), priceStrict: null, sentiment: s(88, 8, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:30:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.45, '2026-10-31T11:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.360245, '2026-10-31T11:15:00.000Z'), priceStrict: null, sentiment: s(88, 8, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:35:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.45, '2026-10-31T11:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: null, priceStrict: null, sentiment: s(86, 7, '2026-10-31T05:01:32.000Z'), refused: [['flows-price', 'price', 'leg-missing'], ['narrative-price', 'price', 'leg-missing']] },
  { at: '2026-10-31T11:40:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.45, '2026-10-31T11:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(-0.360245, '2026-10-31T11:15:00.000Z'), priceStrict: null, sentiment: s(86, 7, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:45:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.84, '2026-10-31T11:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.199072, '2026-10-31T11:45:00.000Z'), priceStrict: p(0.199072, '2026-10-31T11:45:00.000Z'), sentiment: s(86, 7, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:50:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.84, '2026-10-31T11:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.199072, '2026-10-31T11:45:00.000Z'), priceStrict: null, sentiment: s(86, 7, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T11:55:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.84, '2026-10-31T11:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.199072, '2026-10-31T11:45:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T12:00:23.000Z', stablecoin: p(-1.075129, '2026-10-31T11:09:34.352Z'), openInterest: p(1.87, '2026-10-31T12:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.199072, '2026-10-31T11:45:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T12:05:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.87, '2026-10-31T12:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.125387, '2026-10-31T12:05:00.000Z'), priceStrict: p(0.125387, '2026-10-31T12:05:00.000Z'), sentiment: s(83, 6, '2026-10-31T05:01:32.000Z'), refused: [] },
  { at: '2026-10-31T12:10:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.87, '2026-10-31T12:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.125387, '2026-10-31T12:05:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:15:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.41, '2026-10-31T12:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.051206, '2026-10-31T12:15:00.000Z'), priceStrict: p(0.051206, '2026-10-31T12:15:00.000Z'), sentiment: s(80, 5, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:20:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.41, '2026-10-31T12:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.051206, '2026-10-31T12:15:00.000Z'), priceStrict: null, sentiment: s(80, 5, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:25:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.41, '2026-10-31T12:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.124672, '2026-10-31T12:25:00.000Z'), priceStrict: p(0.124672, '2026-10-31T12:25:00.000Z'), sentiment: s(80, 5, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:30:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.44, '2026-10-31T12:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.168039, '2026-10-31T12:30:00.000Z'), priceStrict: p(0.168039, '2026-10-31T12:30:00.000Z'), sentiment: s(80, 5, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:35:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.44, '2026-10-31T12:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.168039, '2026-10-31T12:30:00.000Z'), priceStrict: null, sentiment: s(80, 5, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:40:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.44, '2026-10-31T12:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.168039, '2026-10-31T12:30:00.000Z'), priceStrict: null, sentiment: s(80, 5, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:45:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.67, '2026-10-31T12:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.168039, '2026-10-31T12:30:00.000Z'), priceStrict: null, sentiment: s(80, 5, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:50:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.67, '2026-10-31T12:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.057181, '2026-10-31T12:50:00.000Z'), priceStrict: p(0.057181, '2026-10-31T12:50:00.000Z'), sentiment: s(80, 5, '2026-10-31T12:00:00.000Z'), refused: [] },
  { at: '2026-10-31T12:55:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.67, '2026-10-31T12:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.057181, '2026-10-31T12:50:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T12:49:47.000Z'), refused: [] },
  { at: '2026-10-31T13:00:23.000Z', stablecoin: p(-1.081892, '2026-10-31T12:04:10.475Z'), openInterest: p(1.3, '2026-10-31T13:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.057181, '2026-10-31T12:50:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T12:49:47.000Z'), refused: [] },
  { at: '2026-10-31T13:05:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.3, '2026-10-31T13:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.057181, '2026-10-31T12:50:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T12:49:47.000Z'), refused: [] },
  { at: '2026-10-31T13:10:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.3, '2026-10-31T13:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.269984, '2026-10-31T13:10:00.000Z'), priceStrict: p(0.269984, '2026-10-31T13:10:00.000Z'), sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:15:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.3, '2026-10-31T13:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.269984, '2026-10-31T13:10:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:20:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.3, '2026-10-31T13:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.29004, '2026-10-31T13:20:00.000Z'), priceStrict: p(0.29004, '2026-10-31T13:20:00.000Z'), sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:25:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.3, '2026-10-31T13:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.297597, '2026-10-31T13:25:00.000Z'), priceStrict: p(0.297597, '2026-10-31T13:25:00.000Z'), sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:30:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.25, '2026-10-31T13:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.297597, '2026-10-31T13:25:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:35:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.25, '2026-10-31T13:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.25786, '2026-10-31T13:35:00.000Z'), priceStrict: p(0.25786, '2026-10-31T13:35:00.000Z'), sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:40:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.25, '2026-10-31T13:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.25786, '2026-10-31T13:35:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:45:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.1, '2026-10-31T13:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.25786, '2026-10-31T13:35:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:50:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.1, '2026-10-31T13:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.25786, '2026-10-31T13:35:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T13:55:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(1.1, '2026-10-31T13:45:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.67318, '2026-10-31T13:55:00.000Z'), priceStrict: p(0.67318, '2026-10-31T13:55:00.000Z'), sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T14:00:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(0.47, '2026-10-31T14:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.67318, '2026-10-31T13:55:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T14:05:23.000Z', stablecoin: p(-1.086068, '2026-10-31T13:04:36.004Z'), openInterest: p(0.47, '2026-10-31T14:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.750625, '2026-10-31T14:05:00.000Z'), priceStrict: p(0.750625, '2026-10-31T14:05:00.000Z'), sentiment: s(83, 6, '2026-10-31T13:00:00.000Z'), refused: [] },
  { at: '2026-10-31T14:10:23.000Z', stablecoin: p(-1.109774, '2026-10-31T14:06:40.438Z'), openInterest: p(0.47, '2026-10-31T14:00:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.750625, '2026-10-31T14:05:00.000Z'), priceStrict: null, sentiment: s(83, 6, '2026-10-31T14:00:00.000Z'), refused: [] },
  { at: '2026-10-31T14:15:23.000Z', stablecoin: p(-1.109774, '2026-10-31T14:06:40.438Z'), openInterest: p(0.81, '2026-10-31T14:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.9415, '2026-10-31T14:15:00.000Z'), priceStrict: p(0.9415, '2026-10-31T14:15:00.000Z'), sentiment: s(100, 5, '2026-10-31T14:00:00.000Z'), refused: [] },
  { at: '2026-10-31T14:20:23.000Z', stablecoin: p(-1.109774, '2026-10-31T14:06:40.438Z'), openInterest: p(0.81, '2026-10-31T14:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.9415, '2026-10-31T14:15:00.000Z'), priceStrict: null, sentiment: s(100, 5, '2026-10-31T14:00:00.000Z'), refused: [] },
  { at: '2026-10-31T14:25:23.000Z', stablecoin: p(-1.109774, '2026-10-31T14:06:40.438Z'), openInterest: p(0.81, '2026-10-31T14:15:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.9415, '2026-10-31T14:15:00.000Z'), priceStrict: null, sentiment: s(100, 5, '2026-10-31T14:00:00.000Z'), refused: [] },
  { at: '2026-10-31T14:30:23.000Z', stablecoin: p(-1.109774, '2026-10-31T14:06:40.438Z'), openInterest: p(0.62, '2026-10-31T14:30:00.000Z'), funding: p(0.01, '2026-10-31T08:00:00.000Z'), price: p(0.9415, '2026-10-31T14:15:00.000Z'), priceStrict: null, sentiment: s(100, 5, '2026-10-31T14:00:00.000Z'), refused: [] },
  ] satisfies readonly DivergenceReplayRecord[])
})
