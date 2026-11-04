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

/**
 * Read whatever is on disk as periods, without writing anything back.
 *
 * The file is written atomically by the store, so a row that does not validate is not a half-written
 * row to repair: it is a value this build cannot run. It is dropped rather than coerced into a
 * default, because silently turning "07:15" into 07:00 would move a real schedule without telling
 * anyone. An older shape with no `periods` array reads as no periods.
 */
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
