import {
  DEFAULT_PERIOD_ID,
  briefingCompleteness,
  briefingEditionPeriod,
  type DailyBriefingEditionLanguage,
  type DailyBriefingEditionSummary,
  type DailyBriefingLocale,
  type DailyBriefingPeriodKind,
  type DailyBriefingRunTrigger
} from '../../../contracts/dailyBriefing'
import type { DailyBriefingPeriodRun, DailyBriefingStore, DailyBriefingStoredEdition } from './dailyBriefingService'

/**
 * Whether a period still exists in the configuration.
 *
 * Three answers, not a boolean: a configuration that could not be read is not a deleted period.
 * Treating an unreadable store as "absent" would mark every history row as a deleted period.
 */
export type DailyBriefingPeriodPresence = 'found' | 'absent' | 'unreadable'

/** The stored rows of one reader's history window, grouped into rail rows. */
export async function readBriefingHistory(input: Readonly<{
  store: Pick<DailyBriefingStore, 'list' | 'getPeriodRun' | 'listAttempts'>
  locale: DailyBriefingLocale
  today: string
  retentionDays: number
  scheduledTime: string
  /** Whether the period still has a configuration row; absent means the caller cannot tell. */
  periodPresence?: (periodId: string) => DailyBriefingPeriodPresence | Promise<DailyBriefingPeriodPresence>
  /** The periods actually running right now, from the process's live registry — not the stored run. */
  isRunning?: (date: string, periodId: string) => boolean
  /** The language set of the period's configuration, once configuration is the source (post-S8). */
  configuredLanguages?: (periodId: string) => readonly DailyBriefingLocale[] | undefined
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
    scheduledTime: input.scheduledTime,
    ...(input.periodPresence ? { periodPresence: input.periodPresence } : {}),
    ...(input.isRunning ? { isRunning: input.isRunning } : {}),
    ...(input.configuredLanguages ? { configuredLanguages: input.configuredLanguages } : {})
  })
}

function lastDays(today: string, days: number): readonly string[] {
  const start = Date.parse(`${today}T00:00:00.000Z`)
  return Object.freeze(Array.from({ length: days }, (_, index) =>
    new Date(start - (days - 1 - index) * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)))
}

/** One (day, period) with every language row of it; the map keeps the primary language last. */
type PeriodRows = Readonly<{
  date: string
  periodId: string
  rows: ReadonlyMap<DailyBriefingLocale, DailyBriefingStoredEdition>
}>

/**
 * The history rail's rows, built once from the stored editions.
 *
 * One row per (date, period). Everything the row draws is decided here and only here: the period's
 * identity (nominal cutoff, kind, trigger) is copied from its document, the per-language three-state
 * comes from the stored rows plus the run record, and the day is sorted by nominal cutoff with
 * `periodId` as the stable tiebreak. The rail renders these conclusions; it does not recompute them.
 */
export async function briefingHistorySummaries(input: Readonly<{
  dates: readonly string[]
  primary: DailyBriefingLocale
  primaryRows: readonly DailyBriefingStoredEdition[]
  otherRows: readonly DailyBriefingStoredEdition[]
  periodRun?: (date: string, periodId: string) => Promise<DailyBriefingPeriodRun | undefined> | undefined
  attemptCount?: (date: string, periodId: string, locale: DailyBriefingLocale) => Promise<number>
  scheduledTime?: string
  periodPresence?: (periodId: string) => DailyBriefingPeriodPresence | Promise<DailyBriefingPeriodPresence>
  isRunning?: (date: string, periodId: string) => boolean
  configuredLanguages?: (periodId: string) => readonly DailyBriefingLocale[] | undefined
}>): Promise<readonly DailyBriefingEditionSummary[]> {
  // Group every language of a period together: the three-state needs to know which languages exist,
  // not just which one is shown. The primary language is written last so it wins as the row's face.
  const byPeriod = new Map<string, { date: string; periodId: string; rows: Map<DailyBriefingLocale, DailyBriefingStoredEdition> }>()
  for (const row of [...input.otherRows, ...input.primaryRows]) {
    const periodId = row.periodId ?? DEFAULT_PERIOD_ID
    const key = `${row.date}:${periodId}`
    const entry = byPeriod.get(key) ?? { date: row.date, periodId, rows: new Map() }
    entry.rows.set(row.locale, row)
    byPeriod.set(key, entry)
  }

  const editions: DailyBriefingEditionSummary[] = []
  for (const date of [...input.dates].reverse()) {
    const periods: PeriodRows[] = [...byPeriod.values()]
      .filter((entry) => entry.date === date)
      .map((entry) => ({ date: entry.date, periodId: entry.periodId, rows: entry.rows }))
    // A day with nothing stored still gets the one row it always had: "not run", not "no row".
    if (periods.length === 0) periods.push({ date, periodId: DEFAULT_PERIOD_ID, rows: new Map() })

    const day: DailyBriefingEditionSummary[] = []
    for (const period of periods) {
      day.push(await summaryOfPeriod(period, input))
    }
    // A5.1, the one definition: nominal cutoff ascending, same moment resolved by the period id.
    // Not by generatedAt and not by window, or the reader sees the list reshuffle between renders.
    // A row with no known cutoff (a run that never published) sorts last: it cannot claim to be the
    // earliest issue of the day just because its time is unknown.
    day.sort((left, right) => {
      if (left.periodTime === undefined || right.periodTime === undefined) {
        if (left.periodTime !== right.periodTime) return left.periodTime === undefined ? 1 : -1
      } else if (left.periodTime !== right.periodTime) {
        return left.periodTime < right.periodTime ? -1 : 1
      }
      return left.periodId < right.periodId ? -1 : left.periodId > right.periodId ? 1 : 0
    })
    markCurrent(day)
    editions.push(...day)
  }
  return Object.freeze(editions)
}

async function summaryOfPeriod(period: PeriodRows, input: Readonly<{
  primary: DailyBriefingLocale
  periodRun?: (date: string, periodId: string) => Promise<DailyBriefingPeriodRun | undefined> | undefined
  attemptCount?: (date: string, periodId: string, locale: DailyBriefingLocale) => Promise<number>
  scheduledTime?: string
  periodPresence?: (periodId: string) => DailyBriefingPeriodPresence | Promise<DailyBriefingPeriodPresence>
  isRunning?: (date: string, periodId: string) => boolean
  configuredLanguages?: (periodId: string) => readonly DailyBriefingLocale[] | undefined
}>): Promise<DailyBriefingEditionSummary> {
  const { date, periodId, rows } = period
  // The row's face is the reader's language. Another language being published does not turn the
  // reader's own gap into a generated row — `languages` says what exists; `state` stays about the
  // language the row shows.
  const shown = rows.get(input.primary)
  const availableLocales = [...rows.keys()]
  const identity = identityOf(shown ?? [...rows.values()][0])
  const summary: DailyBriefingEditionSummary = {
    date,
    periodId,
    locale: input.primary,
    availableLocales,
    ...identity,
    state: shown ? 'generated' : 'missing',
    ...(shown ? {
      generatedAt: shown.generatedAt,
      ...(shown.document.conclusion ? { direction: shown.document.conclusion.direction } : {}),
      ...(shown.document.lede.text ? { summaryLine: shown.document.lede.text.slice(0, 80) } : {}),
      readingsAvailable: shown.document.status.readingsAvailable,
      windowEnd: shown.windowEnd
    } : {})
  }

  const run = input.periodRun ? await input.periodRun(date, periodId) : undefined
  const expectedLocales = run?.expectedLocales
  const completeness = briefingCompleteness({
    ...(expectedLocales ? { expectedLocales } : {}),
    publishedLocales: availableLocales,
    readingsAvailable: summary.readingsAvailable,
    readingsTotal: 4
  })
  // An issue with nothing published is "not run" unless that run actually failed. Attempts the
  // reader deleted the editions of are history, not a status: showing "generation failed" for a
  // day that succeeded and was then emptied would blame the pipeline for the reader's action.
  const published = availableLocales.length > 0
  let attempts: number | undefined
  if (input.attemptCount && (summary.state === 'generated' || run?.state === 'failed')) {
    const countAttempts = input.attemptCount
    try {
      attempts = await countAttempts(date, periodId, summary.locale)
    } catch {
      attempts = undefined
    }
  }
  const presence = input.periodPresence ? await input.periodPresence(periodId) : undefined
  return {
    ...summary,
    languages: languagesOf(availableLocales, run, {
      running: input.isRunning ? input.isRunning(date, periodId) : false,
      configured: input.configuredLanguages ? input.configuredLanguages(periodId) : undefined
    }),
    ...(expectedLocales ? { expectedLocales } : {}),
    ...(attempts === undefined ? {} : { attemptCount: attempts }),
    ...(input.scheduledTime ? { scheduledTime: input.scheduledTime } : {}),
    // Only a configuration known to be gone marks the row; "could not read it" is not "deleted".
    ...(presence === 'absent' ? { periodDeleted: true } : {}),
    // "Missing one version" only describes an issue that still has a version to compare with.
    ...(completeness.state === 'missing-version' && published ? { state: 'partial' as const } : {})
  }
}

/**
 * The identity a period's edition carries. A period with no edition says nothing about kind or
 * trigger: it never ran, and `scheduled` there would be an invented fact. The fallbacks apply only
 * when reading an old document that predates the fields.
 */
function identityOf(row: DailyBriefingStoredEdition | undefined): Readonly<{
  periodTime?: string
  periodKind?: DailyBriefingPeriodKind
  runTrigger?: DailyBriefingRunTrigger
  windowHours?: number
}> {
  if (!row) return {}
  const edition = briefingEditionPeriod(row.document.edition)
  return {
    periodTime: edition.periodTime,
    periodKind: edition.periodKind,
    runTrigger: edition.runTrigger,
    ...(row.document.edition.windowHours === undefined ? {} : { windowHours: row.document.edition.windowHours })
  }
}

/**
 * Every language this period was meant to offer, with what the list can do with it.
 *
 * The run's `expectedLocales` is the only source of "was meant to have it": counting stored rows
 * cannot tell one published language of a two-language period from a single-language edition. A
 * language with no edition is `generating` while the run is still running, and `missing` with a
 * named reason once it settled — a bare grey chip with no reason is what this prevents.
 */
function languagesOf(
  publishedLocales: readonly DailyBriefingLocale[],
  run: DailyBriefingPeriodRun | undefined,
  live: Readonly<{ running: boolean; configured: readonly DailyBriefingLocale[] | undefined }>
): readonly DailyBriefingEditionLanguage[] {
  const published = new Set(publishedLocales)
  // The union of what published, what this run meant to publish, and (once configuration is the
  // source) what the period is configured for. Never "every supported language": that would put a
  // badge for a language the period never had on every row.
  const locales = [...new Set([
    ...publishedLocales,
    ...(run?.expectedLocales ?? []),
    ...(live.configured ?? [])
  ])].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
  return locales.map((locale) => {
    if (published.has(locale)) return Object.freeze({ locale, state: 'published' as const })
    // "Generating" comes from the process that is actually running the period, not from the stored
    // run row: a process that died leaves that row `running` forever, and the row would spin.
    if (live.running) return Object.freeze({ locale, state: 'generating' as const })
    return Object.freeze({
      locale,
      state: 'missing' as const,
      reason: run?.state === 'failed' ? 'run-failed' as const : 'not-published' as const
    })
  })
}

/** A9.4: "本期" is the inequality on generatedAt, the latest completed edition of that day. */
function markCurrent(day: DailyBriefingEditionSummary[]): void {
  let winner = -1
  for (let index = 0; index < day.length; index += 1) {
    const generatedAt = day[index]?.generatedAt
    if (!generatedAt) continue
    if (winner < 0 || generatedAt > (day[winner]?.generatedAt ?? '')) winner = index
  }
  if (winner >= 0) day[winner] = { ...day[winner]!, isCurrent: true }
}
