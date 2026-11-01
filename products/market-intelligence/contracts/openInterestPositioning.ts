/**
 * Turns notional open interest and the funding rate into one of six named states.
 *
 * The panel and the frozen analysis snapshot both read this function, so a conclusion that
 * says 「去杠杆」 and the label a reader sees on the card cannot disagree. It is a
 * deliberately dumb threshold read, not a causal judgement: the prompt tells the model to
 * quote the two numbers beside the state, never the state alone.
 *
 * Order matters. The first rule that matches wins, and `mixed` exists so that a market which
 * moves in a direction this table does not describe gets no label at all rather than a
 * plausible-sounding wrong one.
 */
export type PositioningState =
  | 'deleveraging'
  | 'short-crowded'
  | 'long-crowded'
  | 'refilling'
  | 'neutral'
  | 'mixed'

export const positioningStateIds = Object.freeze([
  'deleveraging',
  'short-crowded',
  'long-crowded',
  'refilling',
  'neutral',
  'mixed'
] as const satisfies readonly PositioningState[])

export const positioningPolicy = Object.freeze({
  /** A day-over-day move smaller than this is ordinary turnover, not a position change. */
  notionalChange24hSignificantPct: 5,
  /**
   * Binance's default interest rate is 0.03%/day, so a funding rate near +0.01%/8h is the
   * *neutral* level, not zero. These two bounds are expressed as funding percentages.
   */
  fundingNegativePct: 0,
  fundingCrowdedPct: 0.03
})

export type PositioningInput = Readonly<{
  /** 24-hour change of notional open interest, in percent. */
  notionalChange24hPct?: number
  /** The latest 8-hour funding rate, in percent. */
  fundingNowPct?: number
  /** The funding rate three 8-hour points ago (about 24 hours), in percent. */
  fundingAgoPct?: number
}>

/**
 * `undefined` means "not enough data to say", which is different from `neutral`: a panel
 * must be able to print nothing rather than claim the market is quiet.
 */
export function resolvePositioningState(input: PositioningInput): PositioningState | undefined {
  const change = finite(input.notionalChange24hPct)
  const now = finite(input.fundingNowPct)
  const before = finite(input.fundingAgoPct)
  if (change === undefined || now === undefined || before === undefined) return undefined

  const { notionalChange24hSignificantPct, fundingNegativePct, fundingCrowdedPct } = positioningPolicy
  if (change <= -notionalChange24hSignificantPct && now < before) return 'deleveraging'
  if (change >= notionalChange24hSignificantPct && now < fundingNegativePct) return 'short-crowded'
  if (change >= notionalChange24hSignificantPct && now > fundingCrowdedPct) return 'long-crowded'
  if (change >= notionalChange24hSignificantPct) return 'refilling'
  if (Math.abs(change) < notionalChange24hSignificantPct) return 'neutral'
  return 'mixed'
}

/**
 * One closed 15-minute bucket, as far as the liquidation read needs it.
 *
 * `volumeBase` and `closePrice` are nullable because the K-line endpoint can fail while the
 * open-interest endpoint succeeds; a null is a known gap, not a zero.
 */
export type PositioningBar = Readonly<{
  observedAt: string
  notionalUsd: number
  volumeBase: number | null
  closePrice: number | null
}>

export type LiquidationHint = Readonly<{
  observedAt: string
  asset: 'btc' | 'eth'
  /** Negative percent change of notional open interest across this one bucket. */
  dropPct: number
  /** Volume of this bucket divided by the mean of the previous `lookbackBars`. */
  volumeMultiple: number
  /**
   * The open interest this bucket closed at.
   *
   * Carried so the mark can be pinned to its own point: the 7-day view plots one bucket per
   * hour, and a dip that recovered inside that hour would otherwise leave a mark floating
   * beside a flat line with nothing to explain it.
   */
  notionalUsd: number
}>

export type LiquidationHintsResult = Readonly<{
  state: 'available' | 'unavailable'
  hints: readonly LiquidationHint[]
  truncated: boolean
}>

export const liquidationHintPolicy = Object.freeze({
  dropPct: -1.5,
  strongDropPct: -2.5,
  priceDropPct: -0.8,
  volumeMultiple: 2,
  lookbackBars: 96,
  maximumHints: 8,
  /**
   * Below this share of closed buckets carrying volume, the whole window reports
   * `unavailable`. An unclosed newest bucket is normal and never counts against it.
   */
  minimumVolumeCoverage: 0.9
})

/**
 * Marks the buckets that *look* like a liquidation: open interest fell fast, price fell with
 * it, and volume expanded. Three conditions must hold at once.
 *
 * This is an inference, not exchange data. Quarterly rolls, large position moves between
 * venues and post-maintenance catch-up volume all satisfy it, which is why the panel labels
 * every mark 「非交易所强平数据」 and why none of these reach the analysis snapshot.
 *
 * `bars` must be ascending and must already exclude the bucket that is still forming.
 */
export function detectLiquidationHints(input: Readonly<{
  asset: 'btc' | 'eth'
  bars: readonly PositioningBar[]
}>): LiquidationHintsResult {
  const { asset, bars } = input
  const policy = liquidationHintPolicy
  if (bars.length === 0) return { state: 'available', hints: [], truncated: false }

  const usable = bars.filter(bar => bar.volumeBase !== null && bar.closePrice !== null)
  const coverage = usable.length / bars.length
  if (coverage < policy.minimumVolumeCoverage) return { state: 'unavailable', hints: [], truncated: false }

  const found: LiquidationHint[] = []
  for (let index = policy.lookbackBars; index < bars.length; index += 1) {
    const bar = bars[index]!
    const previous = bars[index - 1]!
    if (bar.volumeBase === null || bar.closePrice === null) continue
    if (previous.closePrice === null) continue

    const window = bars.slice(index - policy.lookbackBars, index).map(entry => entry.volumeBase)
    if (window.some(value => value === null)) continue
    const mean = (window as readonly number[]).reduce((total, value) => total + value, 0) / policy.lookbackBars
    if (!(mean > 0)) continue

    const dropPct = percentChange(previous.notionalUsd, bar.notionalUsd)
    const pricePct = percentChange(previous.closePrice, bar.closePrice)
    const multiple = bar.volumeBase / mean
    if (dropPct <= policy.dropPct && pricePct <= policy.priceDropPct && multiple >= policy.volumeMultiple) {
      found.push(Object.freeze({
        observedAt: bar.observedAt,
        asset,
        dropPct: round(dropPct),
        volumeMultiple: round(multiple),
        notionalUsd: bar.notionalUsd
      }))
    }
  }

  const truncated = found.length > policy.maximumHints
  return {
    state: 'available',
    hints: Object.freeze(found.slice(-policy.maximumHints)),
    truncated
  }
}

/** Percent change, guarding the divide-by-zero the store's non-negative check cannot. */
function percentChange(from: number, to: number): number {
  if (!Number.isFinite(from) || !Number.isFinite(to) || from === 0) return Number.POSITIVE_INFINITY
  return ((to - from) / from) * 100
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function finite(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
