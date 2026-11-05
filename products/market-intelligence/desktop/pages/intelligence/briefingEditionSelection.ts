import type { DailyBriefingEditionSummary, DailyBriefingLocale } from '../../../contracts/dailyBriefing'

/**
 * The two ways an edition is chosen: by its day, and by the exact badge on its row.
 *
 * Kept beside the reader hook rather than inline in the page, so the page stays under its size
 * ceiling; the behaviour is one call each — a row click names the date, period and language of that
 * row (a day can hold several), and a badge does the same. `selectEdition` is the fallback for a host
 * that cannot hand over a row's identity; it deliberately takes the day's first issue.
 */
export function briefingEditionSelection(input: Readonly<{
  editions: readonly DailyBriefingEditionSummary[]
  effectiveLocale: () => DailyBriefingLocale
  openEdition: (date: string, locale: DailyBriefingLocale, row?: DailyBriefingEditionSummary, periodId?: string) => void
  setPickedLocale: (locale: DailyBriefingLocale) => void
  setPickedPeriodId: (periodId: string) => void
}>): Readonly<{
  selectEdition: (date: string) => void
  selectLocale: (next: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => void
}> {
  return {
    selectEdition(date) {
      const row = input.editions.find((edition) => edition.date === date)
      input.openEdition(date, input.effectiveLocale(), row, row?.periodId)
    },
    selectLocale(next) {
      input.setPickedLocale(next.locale)
      input.setPickedPeriodId(next.periodId)
      input.openEdition(next.date, next.locale, undefined, next.periodId)
    }
  }
}
