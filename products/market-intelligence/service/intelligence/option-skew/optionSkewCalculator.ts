import {
  optionSkewPolicy,
  roundOneDecimal,
  tenorInYears,
  totalVariance,
  type DeribitOptionInstrument,
  type DeribitOptionQuote,
  type OptionSkewFailureCode
} from './optionSkewPolicy'

export type OptionSkewLegs = Readonly<{
  putIv25: number
  callIv25: number
  riskReversal: number
  expiries: readonly [string, string]
  underlyingPrice: number
}>

export type OptionSkewCalcResult =
  | Readonly<{ state: 'computed'; legs: OptionSkewLegs }>
  | Readonly<{ state: 'failed'; failureCode: OptionSkewFailureCode }>

type Contract = { strike: number; optionType: 'call' | 'put'; quote: DeribitOptionQuote }
type ExpiryGroup = { expiryMs: number; tenorYears: number; forward: number; contracts: readonly Contract[] }
type WingPoint = { absDelta: number; impliedVolPercent: number }

/**
 * 30-day fixed-tenor 25Δ risk reversal from one BTC option chain snapshot.
 *
 * 口径 lives in `optionSkewPolicy` (technical design §4): within each expiry read the 25Δ put and
 * the 25Δ call off the out-of-the-money strikes, then move both legs onto 30 days in total variance
 * between the two expiries that bracket it. No extrapolation and no fallback to a wider pair: if
 * either side of the bracket cannot give a 25Δ leg, the day is simply not written.
 */
export function computeOptionSkew(input: {
  instruments: readonly DeribitOptionInstrument[]
  quotes: readonly DeribitOptionQuote[]
  nowMs: number
}): OptionSkewCalcResult {
  const targetTenorYears = optionSkewPolicy.targetTenorDays / 365
  const groups = groupExpiries(input.instruments, input.quotes, input.nowMs)
  if (groups.length === 0) return failed()

  const lower = lastAtOrBelow(groups, targetTenorYears)
  const upper = firstAtOrAbove(groups, targetTenorYears)
  if (!lower) return failed()
  if (!upper) return failed()

  const lowerLegs = legsAt(lower)
  if (!lowerLegs) return failed()

  // An expiry exactly at the target tenor is used as it stands: there is nothing to interpolate.
  if (upper.expiryMs === lower.expiryMs) {
    return computed(lowerLegs, [lower.expiryMs, lower.expiryMs], lower.forward)
  }

  const upperLegs = legsAt(upper)
  if (!upperLegs) return failed()

  const lowerTenor = lower.tenorYears
  const upperTenor = upper.tenorYears
  const weight = (targetTenorYears - lowerTenor) / (upperTenor - lowerTenor)
  if (!Number.isFinite(weight) || weight < 0 || weight > 1) return failed()

  const putIv = interpolatedVolPercent(lowerLegs.putIv, lowerTenor, upperLegs.putIv, upperTenor, weight, targetTenorYears)
  const callIv = interpolatedVolPercent(lowerLegs.callIv, lowerTenor, upperLegs.callIv, upperTenor, weight, targetTenorYears)
  if (putIv === undefined || callIv === undefined) return { state: 'failed', failureCode: 'upstream-shape-invalid' }

  return computed({ putIv, callIv }, [lower.expiryMs, upper.expiryMs], lower.forward)
}

function computed(
  legs: { putIv: number; callIv: number },
  expiries: readonly [number, number],
  underlyingPrice: number
): OptionSkewCalcResult {
  const putIv25 = roundOneDecimal(legs.putIv)
  const callIv25 = roundOneDecimal(legs.callIv)
  return {
    state: 'computed',
    legs: {
      putIv25,
      callIv25,
      riskReversal: roundOneDecimal(putIv25 - callIv25),
      expiries: [isoOf(expiries[0]), isoOf(expiries[1])],
      underlyingPrice
    }
  }
}

function failed(): OptionSkewCalcResult {
  return { state: 'failed', failureCode: 'no-bracketing-expiry' }
}

/** One group per expiry, carrying only contracts that have a summary. A group without a forward is dropped. */
function groupExpiries(
  instruments: readonly DeribitOptionInstrument[],
  quotes: readonly DeribitOptionQuote[],
  nowMs: number
): ExpiryGroup[] {
  const quotesByName = new Map(quotes.map((quote) => [quote.instrumentName, quote]))
  const byExpiry = new Map<number, Contract[]>()
  const forwards = new Map<number, number>()

  for (const instrument of instruments) {
    if (!Number.isFinite(instrument.expiryMs) || instrument.expiryMs <= nowMs) continue
    if (!Number.isFinite(instrument.strike) || instrument.strike <= 0) continue
    const quote = quotesByName.get(instrument.instrumentName)
    if (!quote) continue
    const group = byExpiry.get(instrument.expiryMs) ?? []
    group.push({ strike: instrument.strike, optionType: instrument.optionType, quote })
    byExpiry.set(instrument.expiryMs, group)
    if (!forwards.has(instrument.expiryMs) && typeof quote.underlyingPrice === 'number' &&
      Number.isFinite(quote.underlyingPrice) && quote.underlyingPrice > 0) {
      forwards.set(instrument.expiryMs, quote.underlyingPrice)
    }
  }

  const groups: ExpiryGroup[] = []
  for (const [expiryMs, contracts] of byExpiry) {
    const forward = forwards.get(expiryMs)
    if (forward === undefined) continue
    const tenorYears = tenorInYears(expiryMs - nowMs)
    if (!Number.isFinite(tenorYears) || tenorYears < optionSkewPolicy.minimumTenorDays / 365) continue
    groups.push({ expiryMs, tenorYears, forward, contracts })
  }
  return groups.sort((left, right) => left.tenorYears - right.tenorYears)
}

function lastAtOrBelow(groups: readonly ExpiryGroup[], target: number): ExpiryGroup | undefined {
  let found: ExpiryGroup | undefined
  for (const group of groups) if (group.tenorYears <= target) found = group
  return found ?? undefined
}

function firstAtOrAbove(groups: readonly ExpiryGroup[], target: number): ExpiryGroup | undefined {
  return groups.find((group) => group.tenorYears >= target)
}

/**
 * The expiry's two 25Δ implied vols in percent.
 *
 * Only out-of-the-money strikes take part: below the forward the puts carry the 25Δ put, above it
 * the calls carry the 25Δ call. Each leg is interpolated on |Δ| between the listed strikes that
 * bracket 0.25; a wing that does not bracket it makes the expiry unusable.
 */
function legsAt(group: ExpiryGroup): { putIv: number; callIv: number } | undefined {
  const puts: WingPoint[] = []
  const calls: WingPoint[] = []
  for (const contract of group.contracts) {
    if (!passesLiquidityFilter(contract.quote)) continue
    const absDelta = absDeltaOf(group, contract)
    if (absDelta === undefined) continue
    const { filters } = optionSkewPolicy
    if (absDelta < filters.minimumAbsDelta || absDelta > filters.maximumAbsDelta) continue
    if (contract.strike < group.forward * filters.minimumStrikeToForward) continue
    if (contract.strike > group.forward * filters.maximumStrikeToForward) continue
    const point = { absDelta, impliedVolPercent: contract.quote.markIv }
    if (contract.optionType === 'put' && contract.strike < group.forward) puts.push(point)
    if (contract.optionType === 'call' && contract.strike > group.forward) calls.push(point)
  }
  const putIv = interpolateAtDelta(puts)
  const callIv = interpolateAtDelta(calls)
  if (putIv === undefined || callIv === undefined) return undefined
  return { putIv, callIv }
}

function passesLiquidityFilter(quote: DeribitOptionQuote): boolean {
  const { filters } = optionSkewPolicy
  return quote.openInterest > filters.minimumOpenInterestExclusive &&
    quote.bidPrice > filters.minimumQuotedPrice &&
    quote.askPrice > filters.minimumQuotedPrice &&
    Number.isFinite(quote.markIv) && quote.markIv > 0
}

/** |Δ| of an out-of-the-money strike. Black-76 with a zero rate, as the design fixes it. */
function absDeltaOf(group: ExpiryGroup, contract: Contract): number | undefined {
  const sigma = contract.quote.markIv / 100
  if (!Number.isFinite(sigma) || sigma <= 0) return undefined
  const sqrtT = Math.sqrt(group.tenorYears)
  if (!Number.isFinite(sqrtT) || sqrtT <= 0) return undefined
  const d1 = (Math.log(group.forward / contract.strike) + 0.5 * sigma * sigma * group.tenorYears) / (sigma * sqrtT)
  if (!Number.isFinite(d1)) return undefined
  const callDelta = normalCdf(d1)
  // The put delta is N(d1) − 1, so its magnitude is 1 − N(d1); both wings report the same number
  // that the 25Δ target refers to.
  return contract.optionType === 'call' ? callDelta : 1 - callDelta
}

/** Sorted by |Δ|; the two listed strikes bracketing 0.25 give the leg's vol by linear interpolation. */
function interpolateAtDelta(points: readonly WingPoint[]): number | undefined {
  const target = optionSkewPolicy.targetDelta
  const sorted = [...points].sort((left, right) => left.absDelta - right.absDelta)
  for (let index = 0; index < sorted.length; index += 1) {
    const point = sorted[index]!
    if (Math.abs(point.absDelta - target) < 1e-9) return point.impliedVolPercent
    const next = sorted[index + 1]
    if (!next) break
    if (point.absDelta < target && target < next.absDelta) {
      const span = next.absDelta - point.absDelta
      if (span <= 0) return undefined
      const weight = (target - point.absDelta) / span
      return point.impliedVolPercent + weight * (next.impliedVolPercent - point.impliedVolPercent)
    }
  }
  return undefined
}

function interpolatedVolPercent(
  lowVolPercent: number,
  lowTenorYears: number,
  highVolPercent: number,
  highTenorYears: number,
  weight: number,
  targetTenorYears: number
): number | undefined {
  const variance = (1 - weight) * totalVariance(lowVolPercent, lowTenorYears) +
    weight * totalVariance(highVolPercent, highTenorYears)
  if (!Number.isFinite(variance) || variance <= 0) return undefined
  return Math.sqrt(variance / targetTenorYears) * 100
}

function isoOf(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

/** Standard normal CDF, Abramowitz–Stegun 7.1.26 on erf (|error| < 1.5e-7). */
function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2))
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1
  const x = Math.abs(value)
  const t = 1 / (1 + 0.3275911 * x)
  const polynomial = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - polynomial * Math.exp(-x * x))
}