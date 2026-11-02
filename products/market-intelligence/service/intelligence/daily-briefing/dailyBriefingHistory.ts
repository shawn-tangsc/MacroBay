import { DEFAULT_PERIOD_ID, briefingCompleteness, type DailyBriefingEditionSummary, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingPeriodRun, DailyBriefingStoredEdition } from './dailyBriefingService'

/**
 * The history rail's rows, built once from the stored editions.
 *
 * One row per (date, period): the languages of a period share a row because they are versions of
 * the same issue, not separate issues. The partial state comes from the run record — the rail is
 * not allowed to recompute "was every version published" from a locale count.
 */
export async function briefingHistorySummaries(input: Readonly<{
  dates: readonly string[]
  primary: DailyBriefingLocale
  primaryRows: readonly DailyBriefingStoredEdition[]
  otherRows: readonly DailyBriefingStoredEdition[]
  periodRun?: (date: string, periodId: string) => Promise<DailyBriefingPeriodRun | undefined> | undefined
}>): Promise<readonly DailyBriefingEditionSummary[]> {
  const byPeriod = new Map<string, DailyBriefingStoredEdition>()
  for (const row of input.otherRows) byPeriod.set(`${row.date}:${row.periodId ?? DEFAULT_PERIOD_ID}`, row)
  for (const row of input.primaryRows) byPeriod.set(`${row.date}:${row.periodId ?? DEFAULT_PERIOD_ID}`, row)
  const editions: DailyBriefingEditionSummary[] = []
  for (const date of [...input.dates].reverse()) {
    const periodIds = new Set<string>([...byPeriod.keys()].filter((key) => key.startsWith(`${date}:`)).map((key) => key.slice(date.length + 1)))
    if (periodIds.size === 0) periodIds.add(DEFAULT_PERIOD_ID)
    for (const periodId of periodIds) {
      const summary = summaryFor(date, periodId, input.primary, byPeriod.get(`${date}:${periodId}`), [input.primaryRows, input.otherRows])
      const run = input.periodRun ? await input.periodRun(date, periodId) : undefined
      const expectedLocales = run?.expectedLocales
      const completeness = briefingCompleteness({
        ...(expectedLocales ? { expectedLocales } : {}),
        publishedLocales: summary.availableLocales,
        readingsAvailable: summary.readingsAvailable,
        readingsTotal: 4
      })
      editions.push({
        ...summary,
        ...(expectedLocales ? { expectedLocales } : {}),
        ...(completeness.state === 'missing-version' ? { state: 'partial' as const } : {})
      })
    }
  }
  return Object.freeze(editions)
}

function summaryFor(
  date: string,
  periodId: string,
  locale: DailyBriefingLocale,
  row: DailyBriefingStoredEdition | undefined,
  allRows: readonly (readonly DailyBriefingStoredEdition[])[]
): DailyBriefingEditionSummary {
  const availableLocales = allRows
    .flat()
    .filter((candidate) => candidate.date === date && (candidate.periodId ?? DEFAULT_PERIOD_ID) === periodId)
    .map((candidate) => candidate.locale)
  if (!row || row.locale !== locale) return { date, periodId, locale, availableLocales: [...new Set(availableLocales)], state: 'missing' }
  const document = row.document
  return {
    date,
    periodId,
    locale: row.locale,
    availableLocales: [...new Set(availableLocales)],
    state: 'generated',
    generatedAt: row.generatedAt,
    ...(document.conclusion ? { direction: document.conclusion.direction } : {}),
    ...(document.lede.text ? { summaryLine: document.lede.text.slice(0, 80) } : {}),
    readingsAvailable: document.status.readingsAvailable,
    windowEnd: row.windowEnd
  }
}

