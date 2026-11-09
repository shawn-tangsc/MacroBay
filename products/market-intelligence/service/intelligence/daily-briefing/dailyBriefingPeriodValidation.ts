import {
  isDailyBriefingGenerationTime,
  isDailyBriefingLocale,
  isDailyBriefingWindowHours,
  type DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import {
  briefingPeriodTriple,
  type BriefingPeriod,
  type BriefingPeriodDraft,
  type BriefingPeriodOrigin
} from '../../../contracts/dailyBriefingPeriod'

import {
  briefingPeriodConflict,
  briefingPeriodDraftIssue,
  type BriefingPeriodDraftIssue
} from '../../../contracts/dailyBriefingPeriod'

// Re-exported so the service keeps one import site for the period rules; the rules themselves live
// in the contract, where the renderer can enforce the same rule instead of a second copy.
export { briefingPeriodConflict, briefingPeriodDraftIssue, type BriefingPeriodDraftIssue }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function trimmed(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function readOrigin(value: unknown): BriefingPeriodOrigin | undefined {
  return value === 'legacy-settings' ? 'legacy-settings' : undefined
}

function readPeriod(entry: unknown): BriefingPeriod | undefined {
  if (!isRecord(entry)) return undefined
  const id = trimmed(entry.id)
  const draft: BriefingPeriodDraft = {
    generationTime: entry.generationTime as string,
    windowHours: entry.windowHours as number,
    language: entry.language as DailyBriefingLocale
  }
  if (!id || briefingPeriodDraftIssue(draft)) return undefined
  const origin = readOrigin(entry.origin)
  return Object.freeze({
    id,
    generationTime: draft.generationTime,
    windowHours: draft.windowHours as BriefingPeriod['windowHours'],
    language: draft.language,
    ...(origin ? { origin } : {})
  })
}

/** One row whose `language` was missing in the file, and the value that replaces it. */
export type BriefingPeriodLanguageRepair = Readonly<{ id: string; language: DailyBriefingLocale }>

/**
 * Read whatever is on disk as periods, without writing anything back.
 *
 * The file is written atomically by the store, so a row that does not validate is not a half-written
 * row to repair: it is a value this build cannot run. It is dropped rather than coerced into a
 * default, because silently turning "07:15" into 07:00 would move a real schedule without telling
 * anyone. An older shape with no `periods` array reads as no periods.
 */
export type BriefingPeriodsRepair = Readonly<{
  periods: readonly BriefingPeriod[]
  /**
   * The rows that were missing a language, with the value to write for each.
   *
   * The caller writes back **only these values, by id**. It must not write `periods` above: that
   * list is filtered — a row this build cannot run is left out of it — so writing it back would let
   * one repaired row delete every unreadable row in the same file.
   */
  languageRepairs: readonly BriefingPeriodLanguageRepair[]
  /**
   * Period ids whose language came from the reader's interface language because no edition could
   * vouch for one. Kept out of the stored period: this is a note about how the value was chosen,
   * not a second copy of the value.
   */
  inferred: readonly string[]
}>

/**
 * Read the file and repair a period that was written before language belonged to a period.
 *
 * Three tiers, and the middle one is a fact rather than a guess:
 * 1. the links of the editions that period actually generated name exactly one language → use it;
 * 2. no links, or links in both languages (the editions cannot name one) → the reader's interface
 *    language, recorded in `inferred` as a guess;
 * 3. never "unknown": the language is required, and a blank would fail the next read.
 *
 * The link map is asked for lazily, once, and only when a period is actually missing a language.
 */
export async function readBriefingPeriodsWithRepair(
  value: unknown,
  options: Readonly<{
    fallbackLanguage: DailyBriefingLocale
    editionLocales?: () => Promise<ReadonlyMap<string, ReadonlySet<DailyBriefingLocale>>>
  }>
): Promise<BriefingPeriodsRepair> {
  if (!isRecord(value) || !Array.isArray(value.periods)) return Object.freeze({ periods: Object.freeze([]), languageRepairs: Object.freeze([]), inferred: Object.freeze([]) })
  const needsLanguage = value.periods.some((entry) => isRecord(entry) && isMissingLanguage(entry.language))
  const editionLocales = needsLanguage && options.editionLocales ? await options.editionLocales().catch(() => new Map()) : new Map()
  const seen = new Set<string>()
  const periods: BriefingPeriod[] = []
  const languageRepairs: BriefingPeriodLanguageRepair[] = []
  const inferred: string[] = []
  for (const entry of value.periods) {
    if (!isRecord(entry)) continue
    const id = trimmed(entry.id)
    if (!id || seen.has(id)) continue
    let language = entry.language
    if (isMissingLanguage(language)) {
      const fromEditions = editionLocales.get(id)
      if (fromEditions !== undefined && fromEditions.size === 1) {
        language = [...fromEditions][0]
      } else {
        language = options.fallbackLanguage
        inferred.push(id)
      }
      // Recorded before the row is validated: a row with a bad window is still in the file, and
      // filling its language now is what stops the next read from repairing it again.
      languageRepairs.push(Object.freeze({ id, language: language as DailyBriefingLocale }))
    }
    const draft: BriefingPeriodDraft = {
      generationTime: entry.generationTime as string,
      windowHours: entry.windowHours as number,
      language: language as DailyBriefingLocale
    }
    if (briefingPeriodDraftIssue(draft)) continue
    seen.add(id)
    const origin = readOrigin(entry.origin)
    periods.push(Object.freeze({
      id,
      generationTime: draft.generationTime,
      windowHours: draft.windowHours as BriefingPeriod['windowHours'],
      language: draft.language,
      ...(origin ? { origin } : {})
    }))
  }
  return Object.freeze({ periods: Object.freeze(periods), languageRepairs: Object.freeze(languageRepairs), inferred: Object.freeze(inferred) })
}

function isMissingLanguage(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0)
}

/**
 * Fill in the missing `language` of the named rows, in the document exactly as it is now.
 *
 * Everything else is returned untouched: rows this build cannot read, keys it does not know, a zone
 * an older file carried. Writing the *filtered* list from the repair instead would let a read
 * delete data — one row needing a language would take every unreadable row in the same file with
 * it, and the reader would never see their configuration again.
 *
 * A row that has gained a language already (another writer repaired it, or the file moved) is left
 * alone, which is what makes the write idempotent.
 */
export function applyPeriodLanguageRepairs(
  value: unknown,
  repairs: readonly BriefingPeriodLanguageRepair[]
): Readonly<{ changed: boolean; value: unknown }> {
  if (repairs.length === 0 || !isRecord(value) || !Array.isArray(value.periods)) {
    return Object.freeze({ changed: false, value })
  }
  const languageById = new Map(repairs.map((repair) => [repair.id, repair.language]))
  let changed = false
  const periods = value.periods.map((entry) => {
    if (!isRecord(entry) || !isMissingLanguage(entry.language)) return entry
    const id = trimmed(entry.id)
    const language = id === undefined ? undefined : languageById.get(id)
    if (language === undefined) return entry
    changed = true
    return { ...entry, language }
  })
  return changed
    ? Object.freeze({ changed, value: Object.freeze({ ...value, periods }) })
    : Object.freeze({ changed: false, value })
}

export function readBriefingPeriods(value: unknown): readonly BriefingPeriod[] {
  if (!isRecord(value) || !Array.isArray(value.periods)) return Object.freeze([])
  const seen = new Set<string>()
  const periods: BriefingPeriod[] = []
  for (const entry of value.periods) {
    const period = readPeriod(entry)
    if (!period) continue
    // First writer wins on an id: two rows with one id cannot both be addressed by edit or delete.
    if (seen.has(period.id)) continue
    seen.add(period.id)
    periods.push(period)
  }
  return Object.freeze(periods)
}
