import type { BriefingGenerationTrace, DailyBriefingDocument, DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingStore, DailyBriefingTodayResult } from './dailyBriefingService'

/** Reading a stored attempt back, and attaching a trace to a document; both are read-side helpers. */

/** A failed read without a fresh trace still shows the last persisted attempt for that edition. */
export async function withStoredAttempt(
  store: DailyBriefingStore,
  result: DailyBriefingTodayResult,
  date: string,
  locale: DailyBriefingLocale,
  periodId: string
): Promise<DailyBriefingTodayResult> {
  if (result.state !== 'unavailable' || result.generationTrace || !store.getAttempt) return result
  try {
    const generationTrace = await store.getAttempt(date, locale, periodId)
    return generationTrace ? { ...result, generationTrace } : result
  } catch {
    return result
  }
}

/** A stored edition carries its own trace, so a later read does not need a second store hit. */
export function withGenerationTrace(document: DailyBriefingDocument, generationTrace: BriefingGenerationTrace): DailyBriefingDocument {
  return Object.freeze({
    ...document,
    provenance: Object.freeze({ ...document.provenance, generationTrace })
  })
}
