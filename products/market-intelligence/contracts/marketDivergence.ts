/**
 * Cross-panel divergence: the readings that only exist when two cards are put side by side.
 *
 * The dashboard's cards each stand on their own; nothing in the product answers "do they
 * disagree?" — and disagreement is the one thing a reader cannot compute from four separate
 * numbers without holding all four in their head at once.
 *
 * This module owns the definitions: which pairs exist, what counts as a divergence, and when a
 * pair must refuse to answer because its legs describe different moments. It is pure: the caller
 * hands in already-validated legs, so the panel and the analysis snapshot read one implementation
 * and cannot drift apart on thresholds.
 */
export const divergencePolicy = Object.freeze({
  pairs: Object.freeze(['liquidity-leverage', 'flows-price', 'narrative-price'] as const),
  /**
   * Daily legs may lag this long. An ETF row is published T+1 and skips weekends, so a Monday
   * morning run is answered by Friday's session — beyond this bound the pair is refused rather
   * than explained with a stale window.
   */
  maximumDailyLagMs: 36 * 60 * 60 * 1_000,
  /**
   * How old an intraday leg's own reading may be, per leg.
   *
   * One number for all of them was wrong in the direction that costs the reader an answer: funding
   * only settles every eight hours, so a six-hour bound called the newest possible reading "too
   * old" for two hours out of every settlement cycle — a quarter of the day. Each leg is bounded by
   * its own cadence plus one poll of slack. The daily legs do not appear here: they are bounded by
   * `maximumDailyLagMs` and the three-session ETF window instead.
   */
  freshnessMs: Object.freeze({
    'open-interest': 60 * 60 * 1_000,
    funding: 9 * 60 * 60 * 1_000,
    price: 60 * 60 * 1_000,
    sentiment: 26 * 60 * 60 * 1_000
  }),
  /** US cash session close, the instant a trading day's flow becomes a finished reading. */
  etfSessionCloseUtcHour: 21,
  thresholds: Object.freeze({
    stablecoin7dPercent: -0.5,
    openInterest24hUpPercent: 3,
    openInterest24hDownPercent: -3,
    etf3dNetFlowUsd: -100_000_000,
    etfWindowSessions: 3,
    priceFlatPercent: 1,
    priceStillPercent: 0.5,
    /** A majority of the day's scored headlines bearish is the "bad news" condition. */
    sentimentBearishSharePercent: 60,
    openInterestFlatPercent: 1
  }),
  /**
   * When the rule call stops being obvious enough to publish alone.
   *
   * The rules are the product; the model only reads the cases a threshold table cannot phrase
   * well. Two pairs at once, opposite directions, or a leg sitting on its threshold are the
   * shapes where a table's answer reads either arbitrary or mechanical.
   */
  escalation: Object.freeze({
    /** A second pair disagreeing at the same time is rare enough to deserve a written reading. */
    minimumPairs: 2,
    /** A leg within this fraction of its threshold makes the verdict knife-edge. */
    thresholdMarginRatio: 0.15
  }),
  maximumDtoBytes: 8 * 1024,
  unavailableFailureCode: 'market-divergence-query-unavailable' as const,
  canonicalUtcMillisPattern: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
})

export type DivergencePairId = (typeof divergencePolicy.pairs)[number]

export type DivergenceLegId = 'stablecoin' | 'etf' | 'open-interest' | 'funding' | 'price' | 'sentiment'

/**
 * One leg as the reader sees it: a value, its unit, and the moment the value describes.
 *
 * `observedAt` is the leg's own instant, never the query time — showing the query time would make
 * a Thursday flow look like a Friday reading, which is the mistake this module exists to prevent.
 */
export type DivergenceLeg = Readonly<{
  id: DivergenceLegId
  value: number
  unit: 'percent' | 'usd' | 'percent-per-8h'
  observedAt: string
}>

export type DivergenceDirection = 'bearish' | 'bullish' | 'unpriced'

export type DivergenceRow = Readonly<{
  pairId: DivergencePairId
  direction: DivergenceDirection
  legs: readonly DivergenceLeg[]
}>

export type DivergenceWithheld = Readonly<{
  pairId: DivergencePairId
  /**
   * Why the pair was refused. `leg-missing` is data that never arrived; `leg-unavailable` is a read
   * that failed — telling the reader "we could not ask" instead of "the market said nothing" is the
   * difference between a fault to report and a quiet day.
   */
  reason: 'window-mismatch' | 'leg-missing' | 'leg-stale' | 'leg-unavailable'
  leg: DivergenceLegId
  /** The instant the leg stopped, when the refusal is about time rather than a missing leg. */
  observedAt?: string
}>

export type MarketDivergenceResult =
  | Readonly<{ state: 'available'; asOf: string; rows: readonly DivergenceRow[]; withheld: readonly DivergenceWithheld[]; escalated: boolean }>
  | Readonly<{ state: 'empty'; asOf: string; withheld: readonly DivergenceWithheld[]; escalated: boolean }>
  /**
   * Nothing could be computed. `missing` names the readings that never arrived — a card that says
   * "some data is missing" without saying which is asking the reader to go and find out.
   */
  | Readonly<{
      state: 'unavailable'
      failureCode: 'market-divergence-query-unavailable'
      /** Named by layer: a payload the route refused is not the same fault as a service that threw. */
      reason: 'all-legs-missing' | 'query-failed' | 'invalid-clock' | 'too-large' | 'bad-payload' | 'bad-answer'
      missing: readonly DivergenceLegId[]
    }>

/** Already-validated legs, one per source. A missing key means "this leg could not answer". */
export type DivergenceInputs = Readonly<{
  asOf: string
  stablecoin?: Readonly<{ change7dPercent: number; observedAt: string }>
  etf?: Readonly<{ rows: readonly Readonly<{ tradingDate: string; netFlowUsd: number }>[] }>
  openInterest?: Readonly<{ change24hPct: number; observedAt: string }>
  funding?: Readonly<{ ratePercent: number; observedAt: string }>
  price?: Readonly<{ return24hPercent: number; observedAt: string }>
/** Share of the last 24 hours' scored headlines that are bearish, 0–100. */
  sentiment?: Readonly<{ bearishSharePercent: number; scoredCount: number; observedAt: string; headlines?: readonly string[] }>
  /**
   * Legs whose read threw, as opposed to legs that answered with nothing. The detector cannot tell
   * those apart from a missing key, and the reader can.
   */
  faulted?: readonly DivergenceLegId[]
}>

export function divergenceUnavailable(
  reason: Extract<MarketDivergenceResult, { state: 'unavailable' }>['reason'] = 'query-failed',
  missing: readonly DivergenceLegId[] = []
): Extract<MarketDivergenceResult, { state: 'unavailable' }> {
  return { state: 'unavailable', failureCode: divergencePolicy.unavailableFailureCode, reason, missing }
}

/**
 * Reads the legs into at most three rows, and reports every pair it refused and why.
 *
 * A pair that cannot be aligned is not silently dropped: the card names the leg and the reason,
 * because "no divergence today" and "we could not compare" must not look alike.
 */
export function detectDivergences(input: DivergenceInputs): MarketDivergenceResult {
  if (!isCanonicalDivergenceTime(input.asOf)) return divergenceUnavailable('invalid-clock')
  const withheld: DivergenceWithheld[] = []
  const rows: DivergenceRow[] = []

  // Pair 1 — money is leaving while shorts keep adding.
  {
    const stable = input.stablecoin
    const open = input.openInterest
    const funding = input.funding
    const absent = !stable ? 'stablecoin' : !open ? 'open-interest' : !funding ? 'funding' : undefined
    const stale = open && funding
      ? !isFresh('open-interest', open.observedAt, input.asOf) ? 'open-interest' : !isFresh('funding', funding.observedAt, input.asOf) ? 'funding' : undefined
      : undefined
    if (absent) withheld.push({ pairId: 'liquidity-leverage', reason: absentReason(input, absent), leg: absent })
    else if (!withinDailyWindow(stable!.observedAt, input.asOf)) withheld.push({ pairId: 'liquidity-leverage', reason: 'window-mismatch', leg: 'stablecoin', observedAt: stable!.observedAt })
    else if (stale) withheld.push({ pairId: 'liquidity-leverage', reason: 'leg-stale', leg: stale })
    else if (stable!.change7dPercent <= divergencePolicy.thresholds.stablecoin7dPercent
      && open!.change24hPct >= divergencePolicy.thresholds.openInterest24hUpPercent
      && funding!.ratePercent < 0) {
      rows.push(freezeRow('liquidity-leverage', 'bearish', [stableLeg(stable!), openLeg(open!), fundingLeg(funding!)]))
    }
  }

  // Pair 2 — money left the funds, leverage came off, and price did not fall: someone bought.
  {
    const etf = input.etf
    const open = input.openInterest
    const price = input.price
    const sessions = etf ? lastSessions(etf.rows, divergencePolicy.thresholds.etfWindowSessions) : []
    const absent = !etf ? 'etf' : !open ? 'open-interest' : !price ? 'price' : undefined
    const stale = open && price
      ? !isFresh('open-interest', open.observedAt, input.asOf) ? 'open-interest' : !isFresh('price', price.observedAt, input.asOf) ? 'price' : undefined
      : undefined
    if (absent) withheld.push({ pairId: 'flows-price', reason: absentReason(input, absent), leg: absent })
    else if (sessions.length < divergencePolicy.thresholds.etfWindowSessions) withheld.push({ pairId: 'flows-price', reason: 'leg-stale', leg: 'etf' })
    // The window is anchored on the newest finished session: a three-day sum ends the day the
    // market last closed, not the day it started.
    else if (!withinDailyWindow(etfObservedAt(sessions.at(-1)!), input.asOf)) withheld.push({ pairId: 'flows-price', reason: 'window-mismatch', leg: 'etf', observedAt: etfObservedAt(sessions.at(-1)!) })
    else if (stale) withheld.push({ pairId: 'flows-price', reason: 'leg-stale', leg: stale })
    else {
      const net = sessions.reduce((total, row) => total + row.netFlowUsd, 0)
      if (net <= divergencePolicy.thresholds.etf3dNetFlowUsd
        && open!.change24hPct <= divergencePolicy.thresholds.openInterest24hDownPercent
        && Math.abs(price!.return24hPercent) <= divergencePolicy.thresholds.priceFlatPercent) {
        rows.push(freezeRow('flows-price', 'bullish', [
          { id: 'etf', value: net, unit: 'usd', observedAt: etfObservedAt(sessions.at(-1)!) },
          openLeg(open!),
          { id: 'price', value: price!.return24hPercent, unit: 'percent', observedAt: price!.observedAt }
        ]))
      }
    }
  }

  // Pair 3 — bad news, and neither price nor leverage moved.
  {
    const sentiment = input.sentiment
    const open = input.openInterest
    const price = input.price
    const absent = !sentiment ? 'sentiment' : !open ? 'open-interest' : !price ? 'price' : undefined
    const stale = sentiment && open && price
      ? !isFresh('sentiment', sentiment.observedAt, input.asOf) ? 'sentiment'
        : !isFresh('open-interest', open.observedAt, input.asOf) ? 'open-interest'
          : !isFresh('price', price.observedAt, input.asOf) ? 'price' : undefined
      : undefined
    if (absent) withheld.push({ pairId: 'narrative-price', reason: absentReason(input, absent), leg: absent })
    else if (stale) withheld.push({ pairId: 'narrative-price', reason: 'leg-stale', leg: stale })
    else if (sentiment!.bearishSharePercent >= divergencePolicy.thresholds.sentimentBearishSharePercent
      && Math.abs(price!.return24hPercent) <= divergencePolicy.thresholds.priceStillPercent
      && Math.abs(open!.change24hPct) <= divergencePolicy.thresholds.openInterestFlatPercent) {
      rows.push(freezeRow('narrative-price', 'unpriced', [
        { id: 'sentiment', value: sentiment!.bearishSharePercent, unit: 'percent', observedAt: sentiment!.observedAt },
        { id: 'price', value: price!.return24hPercent, unit: 'percent', observedAt: price!.observedAt },
        openLeg(open!)
      ]))
    }
  }

  return rows.length > 0
    // `escalated` is decided by the caller that can see the raw legs; the pure detector says no.
    ? { state: 'available', asOf: input.asOf, rows: Object.freeze(rows), withheld: Object.freeze(withheld), escalated: false }
    : { state: 'empty', asOf: input.asOf, withheld: Object.freeze(withheld), escalated: false }
}

/**
 * Why a leg is absent: the read failed, or it answered with nothing.
 *
 * The pair is refused either way; only the sentence differs, and "we could not ask" is a fault the
 * reader should be able to report while "the market said nothing" is a quiet day.
 */
function absentReason(input: DivergenceInputs, leg: DivergenceLegId): DivergenceWithheld['reason'] {
  return input.faulted?.includes(leg) ? 'leg-unavailable' : 'leg-missing'
}

/** A daily leg's window must end within the lag bound; otherwise it describes another day. */
function withinDailyWindow(observedAt: string, asOf: string): boolean {
  const lag = Date.parse(asOf) - Date.parse(observedAt)
  return Number.isFinite(lag) && lag >= 0 && lag <= divergencePolicy.maximumDailyLagMs
}

/**
 * An intraday leg must be recent enough to describe the same day the card is showing.
 *
 * The bound belongs to the leg, not to the card: a leg is judged against the cadence it actually
 * reports on, so the freshest reading a source can produce is never called stale.
 */
function isFresh(leg: keyof typeof divergencePolicy.freshnessMs, observedAt: string, asOf: string): boolean {
  const lag = Date.parse(asOf) - Date.parse(observedAt)
  return Number.isFinite(lag) && lag >= 0 && lag <= divergencePolicy.freshnessMs[leg]
}

/** Newest N sessions, oldest first, so a 3-session sum reads in calendar order. */
function lastSessions(rows: readonly Readonly<{ tradingDate: string; netFlowUsd: number }>[], count: number): readonly Readonly<{ tradingDate: string; netFlowUsd: number }>[] {
  return [...rows]
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.tradingDate) && Number.isFinite(row.netFlowUsd))
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
    .slice(-count)
}

function etfObservedAt(row: Readonly<{ tradingDate: string }>): string {
  return `${row.tradingDate}T${String(divergencePolicy.etfSessionCloseUtcHour).padStart(2, '0')}:00:00.000Z`
}

function stableLeg(input: Readonly<{ change7dPercent: number; observedAt: string }>): DivergenceLeg {
  return { id: 'stablecoin', value: input.change7dPercent, unit: 'percent', observedAt: input.observedAt }
}

function openLeg(input: Readonly<{ change24hPct: number; observedAt: string }>): DivergenceLeg {
  return { id: 'open-interest', value: input.change24hPct, unit: 'percent', observedAt: input.observedAt }
}

function fundingLeg(input: Readonly<{ ratePercent: number; observedAt: string }>): DivergenceLeg {
  return { id: 'funding', value: input.ratePercent, unit: 'percent-per-8h', observedAt: input.observedAt }
}

function freezeRow(pairId: DivergencePairId, direction: DivergenceDirection, legs: readonly DivergenceLeg[]): DivergenceRow {
  // The pair id is the name: the card and the analysis both look their sentence up by it, so
  // there is no second identifier to keep in step.
  return Object.freeze({ pairId, direction, legs: Object.freeze(legs.map(leg => Object.freeze(leg))) })
}

export function isCanonicalDivergenceTime(value: unknown): value is string {
  if (typeof value !== 'string' || !divergencePolicy.canonicalUtcMillisPattern.test(value)) return false
  try { return new Date(value).toISOString() === value } catch { return false }
}

/**
 * The one validator the IPC handler and the renderer client both call.
 *
 * A second copy would drift: the handler would accept a shape the client refuses, and the card
 * would go blank with no failing test. Same lesson as the open-interest DTO.
 */
export function isMarketDivergenceResult(value: unknown, asOf: string): value is MarketDivergenceResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.state === 'unavailable') {
    if (record.failureCode !== divergencePolicy.unavailableFailureCode) return false
    const reasons = ['all-legs-missing', 'query-failed', 'invalid-clock', 'too-large', 'bad-payload', 'bad-answer']
  if (!reasons.includes(String(record.reason))) return false
    return Array.isArray(record.missing) && record.missing.every(entry => typeof entry === 'string')
  }
  if (!isCanonicalDivergenceTime(record.asOf) || record.asOf !== asOf) return false
  if (!Array.isArray(record.withheld) || !record.withheld.every(isWithheld)) return false
  if (record.state === 'empty') return typeof record.escalated === 'boolean' && Object.keys(record).length === 4
  if (record.state !== 'available' || typeof record.escalated !== 'boolean' || !Array.isArray(record.rows)) return false
  if (record.rows.length > divergencePolicy.pairs.length) return false
  return record.rows.every(isRow)
}

function isRow(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!divergencePolicy.pairs.includes(row.pairId as never)) return false
  if (row.direction !== 'bearish' && row.direction !== 'bullish' && row.direction !== 'unpriced') return false
  if (!Array.isArray(row.legs) || row.legs.length < 2 || row.legs.length > 3) return false
  return row.legs.every(isLeg)
}

function isLeg(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const leg = value as Record<string, unknown>
  if (typeof leg.id !== 'string' || typeof leg.value !== 'number' || !Number.isFinite(leg.value)) return false
  if (leg.unit !== 'percent' && leg.unit !== 'usd' && leg.unit !== 'percent-per-8h') return false
  return isCanonicalDivergenceTime(leg.observedAt)
}

function isWithheld(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const entry = value as Record<string, unknown>
  if (!divergencePolicy.pairs.includes(entry.pairId as never)) return false
  if (entry.reason !== 'window-mismatch' && entry.reason !== 'leg-missing' && entry.reason !== 'leg-stale' && entry.reason !== 'leg-unavailable') return false
  if (typeof entry.leg !== 'string') return false
  return entry.observedAt === undefined || isCanonicalDivergenceTime(entry.observedAt)
}

/**
 * Whether this reading is unusual enough to ask the model.
 *
 * Deliberately deterministic and cheap: it is a second table, not a judgement. Anything it says
 * no to is published from the rules alone, which is the normal case.
 */
export function shouldEscalate(legs: DivergenceInputs, result: Exclude<MarketDivergenceResult, { state: 'unavailable' }>): boolean {
  const rows = result.state === 'available' ? result.rows : []
  if (rows.length >= divergencePolicy.escalation.minimumPairs) return true
  // Opposite directions at the same time: the card would otherwise print "偏空" and "偏强" with no
  // word about how both can be true.
  if (new Set(rows.map(row => row.direction)).size > 1) return true
  return rows.some(row => nearThreshold(row, legs))
}

/** A leg sitting on its threshold: the verdict would flip on a rounding error. */
function nearThreshold(row: DivergenceRow, legs: DivergenceInputs): boolean {
  const margin = divergencePolicy.escalation.thresholdMarginRatio
  const within = (value: number, threshold: number) => Math.abs(value - threshold) <= Math.abs(threshold) * margin
  if (row.pairId === 'liquidity-leverage' && legs.stablecoin && legs.openInterest) {
    return within(legs.stablecoin.change7dPercent, divergencePolicy.thresholds.stablecoin7dPercent)
      || within(legs.openInterest.change24hPct, divergencePolicy.thresholds.openInterest24hUpPercent)
  }
  if (row.pairId === 'flows-price' && legs.openInterest && legs.price) {
    return within(legs.openInterest.change24hPct, divergencePolicy.thresholds.openInterest24hDownPercent)
      || within(Math.abs(legs.price.return24hPercent), divergencePolicy.thresholds.priceFlatPercent)
  }
  if (row.pairId === 'narrative-price' && legs.price && legs.openInterest && legs.sentiment) {
    return within(legs.sentiment.bearishSharePercent, divergencePolicy.thresholds.sentimentBearishSharePercent)
      || within(Math.abs(legs.price.return24hPercent), divergencePolicy.thresholds.priceStillPercent)
  }
  return false
}
