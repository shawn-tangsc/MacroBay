import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'

/**
 * Fraction digits kept for each fact number. The collector stores at most six places today, but
 * the document also carries derived values, so the whitelist keeps every legal rounding up to the
 * point where JavaScript's own decimal rendering stops adding information.
 */
const maximumFractionDigits = 12

/** A larger whitelist means the document is not a briefing any more; refuse it instead of truncating. */
const maximumWhitelistEntries = 20_000

const numericTokenPattern = /-?\d[\d,]*(?:\.\d+)?/g

/**
 * Every spelling of a fact number the editorial prose may legitimately repeat.
 *
 * The brief may restate a fact, never invent one: a value is written exactly as stored, as one of
 * its legal roundings (`toFixed` for every fraction length), or with an absolute sign when the
 * prose drops the direction. String facts keep their own token (`1,234.5` becomes `1234.5`) because
 * they are quoted text rather than numbers. Hidden facts stay in the whitelist, as before.
 */
export function buildNumericFactWhitelist(document: DailyBriefingDocument): ReadonlySet<string> {
  const values = new Set<string>()
  const remember = (spelling: string): void => {
    values.add(spelling)
    if (values.size > maximumWhitelistEntries) {
      throw new Error(`Numeric fact whitelist has more than ${maximumWhitelistEntries} entries`)
    }
  }
  const add = (value: number): void => {
    if (!Number.isFinite(value)) return
    const magnitude = Math.abs(value)
    for (let digits = 0; digits <= maximumFractionDigits; digits += 1) {
      remember(trimZeros(value.toFixed(digits)))
      remember(trimZeros(magnitude.toFixed(digits)))
    }
    remember(normalize(String(value)))
    remember(normalize(String(magnitude)))
  }
  const visit = (value: unknown): void => {
    if (typeof value === 'number') add(value)
    else if (typeof value === 'string') {
      for (const token of value.match(numericTokenPattern) ?? []) {
        add(Number(token.replace(/,/g, '')))
        remember(normalize(token))
      }
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value !== null && typeof value === 'object') {
      for (const nested of Object.values(value)) visit(nested)
    }
  }
  visit(document)
  // Safe count anchors: the day's window, the candidate sets and the citation list. Clock times
  // (`HH:mm`) are stripped from the prose before this function is consulted, so they never appear.
  add(24)
  add(document.news.items.length)
  add(document.news.macro.length)
  add(document.citations.length)
  return values
}

/**
 * Returns the first number in `prose` that is not a legal spelling of a fact, or `undefined` when
 * every number came from the frozen document.
 */
export function findUnknownNumber(prose: string, allowed: ReadonlySet<string>): string | undefined {
  for (const token of prose.match(numericTokenPattern) ?? []) {
    const normalized = normalize(token)
    if (allowed.has(normalized) || allowed.has(normalized.replace(/^-/, ''))) continue
    return token
  }
  return undefined
}

/**
 * The only two differences a legal spelling may have: grouping separators and trailing fractional
 * zeros. Both are value-preserving; rounding belongs to the whitelist and is never done here.
 */
function normalize(text: string): string {
  return trimZeros(text.replace(/,/g, ''))
}

/** `1.2300` → `1.23`, `100.00` → `100`; integer zeros and exponent notation are left untouched. */
function trimZeros(text: string): string {
  if (!text.includes('.') || /[eE]/.test(text)) return text
  return text.replace(/0+$/, '').replace(/\.$/, '')
}
