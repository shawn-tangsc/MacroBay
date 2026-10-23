import { dollarIndexFormula, macroMarketPolicy } from './macroMarketPolicy'

/**
 * The synthetic dollar index, from the six ICE basket currencies.
 *
 * Returns `undefined` unless every term is present: a dollar index computed from three of six
 * currencies is not a dollar index, and publishing it as one would be exactly the kind of invented
 * number this product refuses elsewhere.
 */
export function synthesizeDollarIndex(quotes: Readonly<Record<string, number | undefined>>): number | undefined {
  let value = dollarIndexFormula.constant
  for (const term of dollarIndexFormula.terms) {
    const quote = quotes[term.symbol]
    if (quote === undefined || !Number.isFinite(quote) || quote <= 0) return undefined
    value *= quote ** term.exponent
  }
  return Number.isFinite(value) ? value : undefined
}

/** The complete basket check, so callers can say which term was missing instead of guessing. */
export function missingDollarIndexTerms(quotes: Readonly<Record<string, number | undefined>>): readonly string[] {
  return dollarIndexFormula.terms.filter(term => {
    const quote = quotes[term.symbol]
    return quote === undefined || !Number.isFinite(quote) || quote <= 0
  }).map(term => term.symbol)
}

export const dollarIndexSeriesId = macroMarketPolicy.series.dollarIndex
