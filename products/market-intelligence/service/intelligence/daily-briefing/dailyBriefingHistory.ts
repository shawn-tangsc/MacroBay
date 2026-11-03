import { DEFAULT_PERIOD_ID, briefingCompleteness, type DailyBriefingEditionSummary, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import type { DailyBriefingPeriodRun, DailyBriefingStore, DailyBriefingStoredEdition } from './dailyBriefingService'

/** The stored rows of one reader's history window, grouped into rail rows. */
export async function readBriefingHistory(input: Readonly<{
  store: Pick<DailyBriefingStore, 'list' | 'getPeriodRun' | 'listAttempts'>
  locale: DailyBriefingLocale
  today: string
  retentionDays: number
  scheduledTime: string
}>): Promise<readonly DailyBriefingEditionSummary[]> {
  const dates = lastDays(input.today, input.retentionDays)
  const from = dates[0]!
  const to = dates[dates.length - 1]!
  const [primary, otherLocale] = input.locale === 'zh-CN' ? ['zh-CN', 'en-US'] as const : ['en-US', 'zh-CN'] as const
  const [primaryRows, otherRows] = await Promise.all([
    input.store.list(from, to, primary).catch(() => []),
    input.store.list(from, to, otherLocale).catch(() => [])
  ])
  return briefingHistorySummaries({
    dates,
    primary,
    primaryRows,
    otherRows,
    periodRun: (date, periodId) => input.store.getPeriodRun?.(date, periodId),
    attemptCount: (date, periodId, locale) => {
      const read = input.store.listAttempts
      return read ? read(date, locale, periodId).then((attempts) => attempts.length) : Promise.resolve(0)
    },
    scheduledTime: input.scheduledTime
  })
}

function lastDays(today: string, days: number): readonly string[] {
  const start = Date.parse(`${today}T00:00:00.000Z`)
  return Object.freeze(Array.from({ length: days }, (_, index) =>
    new Date(start - (days - 1 - index) * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)))
}

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
  attemptCount?: (date: string, periodId: string, locale: DailyBriefingLocale) => Promise<number>
  scheduledTime?: string
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
      let attempts: number | undefined
      if (input.attemptCount && summary.state === 'generated') {
        const countAttempts = input.attemptCount
        try {
          attempts = await countAttempts(date, periodId, summary.locale)
        } catch {
          attempts = undefined
        }
      }
      editions.push({
        ...summary,
        ...(expectedLocales ? { expectedLocales } : {}),
        ...(attempts === undefined ? {} : { attemptCount: attempts }),
        ...(input.scheduledTime ? { scheduledTime: input.scheduledTime } : {}),
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

