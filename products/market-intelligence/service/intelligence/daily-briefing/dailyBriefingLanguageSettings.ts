import { isDailyBriefingLocale, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'

/**
 * The edition languages this version can write.
 *
 * A capability table, not a union scattered through the code: adding a language means adding a row
 * here (and its copy), and every caller asks this list instead of hard-coding a second one.
 */
export const SUPPORTED_EDITION_LOCALES: readonly DailyBriefingLocale[] = Object.freeze(['zh-CN', 'en-US'])

/** The interface language every edition starts from; the reader cannot pick a different primary. */
export const FOLLOW_INTERFACE_PRIMARY = 'follow-ui' as const

export type EditionLanguageSettings = Readonly<{
  /** Always "follow the interface": a primary the reader picked would contradict what they see. */
  primary: typeof FOLLOW_INTERFACE_PRIMARY
  /** Extra editions of the same period: same numbers, same cutoff, one more writing pass each. */
  additional: readonly DailyBriefingLocale[]
  updatedAt: string
}>

export type EditionLanguageSettingsPatch = Readonly<{
  additional?: readonly string[]
}>

/** What one generation writes: which languages, in which order, and how many writing passes. */
export type GenerationLanguagesPlan = Readonly<{
  /** `[primary.used, ...additional]`, deduplicated, primary always first. */
  locales: readonly DailyBriefingLocale[]
  primary: Readonly<{
    /** The interface language as the platform reports it — not limited to our supported list. */
    requested: string
    used: DailyBriefingLocale
    /** Set when the interface language is not supported: an explicit fallback, never a silent one. */
    fallbackReason?: 'ui-language-unsupported'
  }>
  /** How many writing passes one period costs; the cost hint renders this number, it never computes it. */
  writeCount: number
}>

export const dailyBriefingLanguageSettingsPolicy = Object.freeze({
  additionalLocaleUnsupportedError: 'daily-briefing-language-unsupported'
})

export function createDefaultEditionLanguageSettings(
  now = new Date().toISOString()
): EditionLanguageSettings {
  return Object.freeze({ primary: FOLLOW_INTERFACE_PRIMARY, additional: Object.freeze([]), updatedAt: now })
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/** Supported, de-duplicated, in the order the reader ticked them. */
function supportedLocales(values: readonly unknown[], supported: readonly DailyBriefingLocale[]): DailyBriefingLocale[] {
  const seen = new Set<DailyBriefingLocale>()
  const out: DailyBriefingLocale[] = []
  for (const value of values) {
    if (!isDailyBriefingLocale(value) || !supported.includes(value) || seen.has(value)) continue
    seen.add(value)
    out.push(value)
  }
  return out
}

/**
 * Read the stored language preference. **Pure and write-free**, and there is no older shape to
 * migrate: this version is the first one to store a language at all, so a missing file is simply the
 * default (follow the interface, no extra editions).
 */
export function readEditionLanguageSettings(
  raw: unknown,
  now = new Date().toISOString()
): EditionLanguageSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createDefaultEditionLanguageSettings(now)
  const record = raw as Record<string, unknown>
  const additional = Array.isArray(record.additional)
    ? supportedLocales(record.additional, SUPPORTED_EDITION_LOCALES)
    : []
  return Object.freeze({
    primary: FOLLOW_INTERFACE_PRIMARY,
    additional: Object.freeze(additional),
    updatedAt: trimmed(record.updatedAt) ?? now
  })
}

/** A save is a reader action: a language we cannot write is rejected, never quietly dropped. */
export function applyEditionLanguageSettingsPatch(
  current: EditionLanguageSettings,
  patch: EditionLanguageSettingsPatch,
  now: string
): EditionLanguageSettings {
  const requested = patch.additional ?? current.additional
  if (requested.some((value) => !isDailyBriefingLocale(value) || !SUPPORTED_EDITION_LOCALES.includes(value as DailyBriefingLocale))) {
    throw new Error(dailyBriefingLanguageSettingsPolicy.additionalLocaleUnsupportedError)
  }
  return Object.freeze({
    primary: FOLLOW_INTERFACE_PRIMARY,
    additional: Object.freeze(supportedLocales(requested, SUPPORTED_EDITION_LOCALES)),
    updatedAt: now
  })
}

/**
 * **The one place** that turns "interface language + stored preference" into "what this period
 * writes". The page renders this answer and never re-derives it: a second implementation would
 * eventually disagree with the generation about how many editions a click buys.
 *
 * An unsupported interface language falls back to `en-US` **explicitly** — the plan carries
 * `fallbackReason`, and the page says so in words rather than showing a language the reader did not
 * choose as if they had.
 */
export function resolveGenerationLanguages(input: Readonly<{
  settings: Pick<EditionLanguageSettings, 'additional'>
  uiLanguage: string
  supported?: readonly DailyBriefingLocale[]
}>): GenerationLanguagesPlan {
  const supported = input.supported ?? SUPPORTED_EDITION_LOCALES
  const requested = input.uiLanguage
  const used = isDailyBriefingLocale(requested) && supported.includes(requested) ? requested : 'en-US'
  const fallbackReason = used === requested ? undefined : 'ui-language-unsupported' as const
  const additional = supportedLocales(input.settings.additional, supported).filter((locale) => locale !== used)
  const locales = [used, ...additional]
  return Object.freeze({
    locales: Object.freeze(locales),
    primary: Object.freeze({ requested, used, ...(fallbackReason ? { fallbackReason } : {}) }),
    writeCount: locales.length
  })
}
