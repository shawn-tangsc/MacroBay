/**
 * Shared shape for "this identifier, said in words".
 *
 * The analysis pipeline carries machine encodings (`change-1d-usd`, `stablecoins`,
 * `cross-asset`, `macro-calendar-consensus-unavailable`) that must be named for a reader.
 * The names themselves are copy: the renderer reads them from the product i18n registry
 * (`desktop/shared/i18n/productText.ts`) and the model prompt reads its own Chinese
 * vocabulary (`service/intelligence/analysis/analysisModelVocabulary.ts`), because the main
 * process must not import renderer code. This module owns only the shape and the mechanics,
 * so neither layer can invent a second way to say the same field.
 *
 * The product rule for both vocabularies: name every registered identifier, and fall back to
 * the identifier itself when it is not registered, so an unnamed field stays visible instead
 * of silently disappearing.
 */
export type MarketAnalysisReadableKind = 'domain' | 'metric' | 'subject' | 'eventName' | 'lifecycleState' | 'comparability' | 'caveat' | 'term'
export type MarketAnalysisReadableLocale = 'zh-CN' | 'en-US'
export type MarketAnalysisReadableNames = Readonly<Record<MarketAnalysisReadableKind, Readonly<Record<string, string>>>>

/**
 * The language the model writes a published conclusion in.
 *
 * `analysisModelPrompt.ts` instructs the model in Chinese and asks for Chinese text, so naming
 * an identifier inside a conclusion must use the Chinese vocabulary even when the surrounding
 * UI is English: `稳定币Current` would be worse than either language alone. The structured
 * change list beside the conclusion is chrome and does follow the reader's locale.
 */
export const analysisConclusionLocale: MarketAnalysisReadableLocale = 'zh-CN'

export const marketAnalysisReadableTextPolicy = Object.freeze({
  /** Longest text value kept whole; longer values are shortened for reading. */
  maximumTextCharacters: 72,
  /**
   * Metrics that are flows: their sign is the message ("+3.14 亿" inflow versus "-2.02 亿"
   * outflow). Levels such as a stablecoin total must not show a sign.
   */
  signedMetrics: ['etf-net-flow-usd', 'change-1d-usd', 'change-7d-usd', 'change-30d-usd', 'funding-rate-percent', 'surprise'],
  /**
   * Decimals kept for a derived deviation. The raw value is floating-point arithmetic on two
   * display strings (`3.4 − 3.1 = 0.2999999999999998`); the reading projection rounds it, the
   * stored value stays exact.
   */
  deviationFractionDigits: 2,
  /**
   * Identifiers a conclusion may contain as an ordinary English word. Everything else that is
   * substituted carries a hyphen or an underscore, so an ordinary word such as `all` or
   * `score` is never rewritten inside prose.
   */
  proseIdentifiersMatch: /[-_]/,
  /**
   * A raw quantity a published conclusion may still carry: a number written with thousands
   * separators or seven or more digits, with an optional sign. A year (2026), a date (10-06),
   * a percentage (3.2%), a small count (71) and an already abbreviated value (29K, 1.188 亿)
   * never match, so display-only abbreviation cannot touch them.
   */
  rawQuantityPattern: /(?<![\d.,])([-+])?(\d{1,3}(?:,\d{3}){2,}(?:\.\d+)?|\d{7,}(?:\.\d+)?)(?![\d.,%-])/gu
})

/** True when a metric's sign carries meaning, as opposed to a level. */
export function isSignedAnalysisMetric(metric: string): boolean {
  return (marketAnalysisReadableTextPolicy.signedMetrics as readonly string[]).includes(metric)
}

/** An empty vocabulary: every identifier then keeps its own name, and text is still scaled. */
const emptyReadableNames: MarketAnalysisReadableNames = Object.freeze({
  domain: Object.freeze({}), metric: Object.freeze({}), subject: Object.freeze({}), eventName: Object.freeze({}),
  lifecycleState: Object.freeze({}), comparability: Object.freeze({}), caveat: Object.freeze({}), term: Object.freeze({})
})

/** The reader's name for an identifier, or the identifier itself when it is not registered. */
export function readableAnalysisName(names: MarketAnalysisReadableNames | undefined, kind: MarketAnalysisReadableKind, id: string | null | undefined): string | null {
  if (id === null || id === undefined || id === '') return null
  return names?.[kind]?.[id] ?? id
}

/**
 * Formats a stored value for reading using its recorded unit.
 *
 * Stored values are raw (`258458629557.07956`) and unreadable at a glance, so USD amounts are
 * scaled to 亿/万 (or B/M/K) and rounded to two decimals.
 */
export function formatReadableAnalysisValue(value: string | number, unit: string | null, locale: MarketAnalysisReadableLocale = 'zh-CN', signed = true): string {
  if (typeof value === 'string') {
    const limit = marketAnalysisReadableTextPolicy.maximumTextCharacters
    return value.length > limit ? `${value.slice(0, limit)}…` : value
  }
  if (unit === 'USD') return formatReadableUsdAmount(value, locale, signed)
  if (unit === 'percent') return signed && value > 0 ? `+${value}%` : `${value}%`
  if (unit === 'pp') {
    const number = formatDeviation(value)
    return locale === 'zh-CN' ? `${signedPrefix(value, signed)}${number} 个百分点` : `${signedPrefix(value, signed)}${number}pp`
  }
  if (unit === 'relative-percent') return `${signedPrefix(value, signed)}${formatDeviation(value)}%`
  return String(value)
}

/** A deviation rounded to the reading policy, without a trailing `+0.00`. */
function formatDeviation(value: number): string {
  const scale = 10 ** marketAnalysisReadableTextPolicy.deviationFractionDigits
  return String(Math.round(value * scale) / scale)
}

/** Only a positive value carries an explicit `+`; zero and negatives do not. */
function signedPrefix(value: number, signed: boolean): string {
  return signed && value > 0 ? '+' : ''
}

/** Formats a USD amount with a magnitude prefix; English uses the currency symbol, not a suffix. */
export function formatReadableUsdAmount(value: number, locale: MarketAnalysisReadableLocale = 'zh-CN', signed = true): string {
  const sign = value < 0 ? '-' : value > 0 && signed ? '+' : ''
  const currency = locale === 'zh-CN' ? '美元' : 'USD'
  return `${sign}${readableMagnitude(Math.abs(value), locale, currency)}`
}

/**
 * An approximate magnitude such as `4.07 亿` or `314.3 M`, without a currency word.
 *
 * Used where the unit is not known (prose a reader is looking at) and as the numeric half of
 * the USD formatter. A value below the smallest unit of the locale is returned unchanged.
 */
export function formatReadableMagnitude(value: number, locale: MarketAnalysisReadableLocale = 'zh-CN'): string {
  return `${value < 0 ? '-' : ''}${readableMagnitude(Math.abs(value), locale, '')}`
}

function readableMagnitude(magnitude: number, locale: MarketAnalysisReadableLocale, currency: string): string {
  const unit = magnitudeUnits[locale].find(candidate => magnitude >= candidate.threshold)
  if (!unit) return `${round(magnitude)} ${currency}`.trim()
  const amount = round(magnitude / unit.divisor)
  // English USD reads as a currency prefix (`$4.48B`); `BUSD`/`MUSD` would collide with asset codes.
  if (locale === 'en-US' && currency === 'USD') return `$${amount}${unit.suffix}`
  return `${amount} ${unit.suffix}${currency}`
}

const magnitudeUnits: Readonly<Record<MarketAnalysisReadableLocale, readonly { threshold: number; suffix: string; divisor: number }[]>> = Object.freeze({
  'zh-CN': Object.freeze([{ threshold: 1e8, suffix: '亿', divisor: 1e8 }, { threshold: 1e4, suffix: '万', divisor: 1e4 }]),
  'en-US': Object.freeze([{ threshold: 1e9, suffix: 'B', divisor: 1e9 }, { threshold: 1e6, suffix: 'M', divisor: 1e6 }, { threshold: 1e3, suffix: 'K', divisor: 1e3 }])
})

/**
 * The value of one fact as a reader sees it. The stored value stays untouched: only the
 * projection changes, so identity, hashing and the frozen snapshot keep the raw encoding.
 */
export function readableAnalysisFactValue(names: MarketAnalysisReadableNames, metric: string, value: string | number | null, unit: string | null, locale: MarketAnalysisReadableLocale = 'zh-CN'): string | null {
  if (value === null) return null
  if (typeof value === 'string' && metric === 'event-name') return readableAnalysisName(names, 'eventName', value)
  if (typeof value === 'string' && metric === 'lifecycle-state') return readableAnalysisName(names, 'lifecycleState', value)
  return formatReadableAnalysisValue(value, unit, locale, isSignedAnalysisMetric(metric))
}

/**
 * Rewrites what a published conclusion may still carry in machine form: registered identifiers
 * become their names, and a raw quantity becomes an approximate magnitude.
 *
 * Text changes only where a registered identifier appears as a whole token or where a long
 * number appears, so an unregistered name, a date, a percentage and ordinary prose are
 * preserved exactly. The stored record keeps the exact value; this is a reading projection, and
 * it is what makes a conclusion published before the prompt was fixed readable without
 * rewriting the record.
 */
export function toReadableConclusionText(text: string, names?: MarketAnalysisReadableNames, locale: MarketAnalysisReadableLocale = 'zh-CN'): string {
  let result = text
  for (const [pattern, name] of readableProsePatterns(names ?? emptyReadableNames)) result = result.split(pattern).join(name)
  result = result.replace(marketAnalysisReadableTextPolicy.rawQuantityPattern, (match, sign: string | undefined, digits: string) => {
    const value = Number(digits.replace(/,/gu, ''))
    return Number.isFinite(value) ? formatReadableMagnitude(sign === '-' ? -value : value, locale) : match
  })
  return localizeAnalysisMagnitudeUnits(result, locale)
}

/**
 * Rewrites Chinese magnitude units (`44.83 亿美元`, `6.36 万`) into the reader's locale.
 *
 * The model is asked to write numbers in the output language, but a conclusion produced before
 * that instruction (or one that slipped through) can still carry Chinese units inside English
 * prose. The stored record stays untouched: this is the same reading projection as the raw
 * quantity rewrite above, so an English reader never sees 「亿美元」 in an English sentence.
 */
export function localizeAnalysisMagnitudeUnits(text: string, locale: MarketAnalysisReadableLocale = 'zh-CN'): string {
  if (locale === 'zh-CN') return text
  return text.replace(
    /(?<![\d.])([-+−]?)(\d+(?:\.\d+)?)\s*(亿美元|万美元|亿元|万元|亿|万)/gu,
    (match, rawSign: string, digits: string, unit: ChineseMagnitudeUnit) => {
      const magnitude = Number(digits)
      if (!Number.isFinite(magnitude)) return match
      const sign = rawSign === '-' || rawSign === '−' ? -1 : 1
      const value = sign * magnitude * chineseMagnitudeDivisors[unit]
      return unit.endsWith('美元')
        ? formatReadableUsdAmount(value, locale, rawSign === '+')
        : formatReadableMagnitude(value, locale)
    }
  )
}

type ChineseMagnitudeUnit = '亿美元' | '万美元' | '亿元' | '万元' | '亿' | '万'

const chineseMagnitudeDivisors: Readonly<Record<ChineseMagnitudeUnit, number>> = Object.freeze({
  亿美元: 1e8, 万美元: 1e4, 亿元: 1e8, 万元: 1e4, 亿: 1e8, 万: 1e4
})

const prosePatternCaches = new WeakMap<MarketAnalysisReadableNames, readonly (readonly [RegExp, string])[]>()

function readableProsePatterns(names: MarketAnalysisReadableNames): readonly (readonly [RegExp, string])[] {
  const cached = prosePatternCaches.get(names)
  if (cached) return cached
  const terms = new Map<string, string>(Object.entries(names.term))
  for (const [kind, registry] of Object.entries(names)) {
    if (kind === 'term') continue
    for (const [identifier, name] of Object.entries(registry)) {
      // Only a hyphenated or underscored identifier is unambiguous inside prose.
      if (identifier !== name && marketAnalysisReadableTextPolicy.proseIdentifiersMatch.test(identifier)) terms.set(identifier, name)
    }
  }
  const sorted = [...terms.entries()]
    // Longest first, so `change-1d-usd` is never split by a shorter registered name.
    .sort((left, right) => right[0].length - left[0].length)
  const patterns = Object.freeze(sorted.map(entry => [tokenPattern(entry[0]), entry[1]] as const))
  prosePatternCaches.set(names, patterns)
  return patterns
}

function tokenPattern(identifier: string): RegExp {
  return new RegExp(`(?<![\\w-])${escapeRegExp(identifier)}(?![\\w-])`, 'gu')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function round(value: number): string {
  // Two decimals at most, without a thousands separator: the magnitude prefix already
  // carries the scale, and a comma only adds noise.
  return String(Math.round(value * 100) / 100)
}
