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
import { readPeriodRuns } from './dailyBriefingPeriodRunJournal'

/**
 * Whether a period still exists in the configuration.
 *
 * Three answers, not a boolean: a configuration that could not be read is not a deleted period.
 * Treating an unreadable store as "absent" would mark every history row as a deleted period.
 */
export type DailyBriefingPeriodPresence = 'found' | 'absent' | 'unreadable'

/** The stored rows of one reader's history window, grouped into rail rows. */
/**
 * 天头要画哪些日子（`02` v2.91）：
 *
 * **有版次 ∨ 有过运行记录（`period_runs` 任何状态）∨ 这一天是今天。**
 * **仅"被排期覆盖"不算**——排期每天重复（07:00 天天都有），按它算等于每天都成立，14 天会全被铺出来。
 * 只放行"今天"一天，是把读者正看着的那一天放进来，不是把窗口放宽：其余无痕迹的日子照旧不出现。
 */
export function briefingRailDates(input: Readonly<{
  dates: readonly string[]
  editionDates: ReadonlySet<string>
  runDates: ReadonlySet<string>
  today: string
}>): readonly string[] {
  // 新到旧：读者第一眼要看的是今天（与列表按天倒序一致）。
  return Object.freeze(input.dates
    .filter((date) => input.editionDates.has(date) || input.runDates.has(date) || date === input.today)
    .reverse())
}

/**
 * 某一期的计划生成时刻，按期为键。
 *
 * 手动期是随机 UUID、配置表里没有行：它**没有**计划时刻，不许借用默认期那个 07:00——用户
 * 2026-11-06 看到的「07:00 未运行」就是一次 18:11 的英文手动期失败被贴上了借来的时钟。
 */
export function briefingScheduledTimeFor(
  periods: readonly Readonly<{ id: string; generationTime: string }>[],
  defaultGenerationTime: string
): (periodId: string) => string | undefined {
  return (periodId) => periods.find((period) => period.id === periodId)?.generationTime
    ?? (periodId === DEFAULT_PERIOD_ID ? defaultGenerationTime : undefined)
}

export async function readBriefingHistory(input: Readonly<{
  store: Pick<DailyBriefingStore, 'list' | 'getPeriodRun' | 'listAttempts'> & Pick<Partial<DailyBriefingStore>, 'listPeriodRuns' | 'listAttemptRuns'>
  locale: DailyBriefingLocale
  today: string
  retentionDays: number
  /**
   * 这一期的**计划生成时刻**，按期为键。
   *
   * 不给一个全局值：某个期根本没有排期（手动期就是随机 UUID、配置表里没有行），它的行就没有计划
   * 时刻，而不是借用默认期那个 07:00（用户 2026-11-06 看到的「07:00 未运行」就是借来的时钟，
   * 那一行其实是一次 18:11 的英文手动期失败）。
   */
  scheduledTime: (periodId: string) => string | undefined
  /** Whether the period still has a configuration row; absent means the caller cannot tell. */
  periodPresence?: (periodId: string) => DailyBriefingPeriodPresence | Promise<DailyBriefingPeriodPresence>
  /** The periods actually running right now, from the process's live registry — not the stored run. */
  isRunning?: (date: string, periodId: string) => boolean
  /** The language set of the period's configuration, once configuration is the source (post-S8). */
  configuredLanguages?: (periodId: string) => readonly DailyBriefingLocale[] | undefined
  /**
   * 今天「该有却没有」的排期期：有配置、是今天、已过计划时刻、零版次零尝试、没被读者删过。
   *
   * 用户 2026-11-06 定（`02` v2.149 甲案）：这种期要在列表里留一行说明，否则它悄悄没有，读者
   * 既看不出缺了，也看不出是没跑还是被跳过。没到点、历史日、手动期、被删过——四种都不给这一行。
   */
  missedPeriods?: readonly Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>[]
}>): Promise<Readonly<{ editions: readonly DailyBriefingEditionSummary[]; dates: readonly string[] }>> {
  // 窗口右端多留**一天**：`today` 是读者日历上的一天，而版次的日期由截止时刻所在的读者本地
  // 日期决定，两者可以差一天（`02` v2.129 G2：有版次的日期一律不许被窗口截掉）。往后的日子不会
  // 无条件出现——`briefingRailDates` 只放行"有版次 / 有过运行记录 / 是今天"。
  // 往左不多留一天：14 天可见范围不放宽。
  const dates = [...lastDays(input.today, input.retentionDays), dayAfter(input.today)]
  const from = dates[0]!
  const to = dates[dates.length - 1]!
  const [primary, otherLocale] = input.locale === 'zh-CN' ? ['zh-CN', 'en-US'] as const : ['en-US', 'zh-CN'] as const
  const [primaryRows, otherRows, runs, attemptRuns] = await Promise.all([
    input.store.list(from, to, primary).catch(() => []),
    input.store.list(from, to, otherLocale).catch(() => []),
    readPeriodRuns(input.store, from, to),
    input.store.listAttemptRuns ? input.store.listAttemptRuns(from, to).catch(() => []) : Promise.resolve([])
  ])
  const editions = await briefingHistorySummaries({
    dates,
    primary,
    primaryRows,
    otherRows,
    runs,
    attemptRuns,
    ...(input.missedPeriods === undefined ? {} : { missedPeriods: input.missedPeriods }),
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
  return Object.freeze({
    editions,
    dates: briefingRailDates({
      dates,
      editionDates: new Set(editions.map((edition) => edition.date)),
      runDates: new Set(runs.map((run) => run.date)),
      today: input.today
    })
  })
}

/** 次日（UTC 日期串上的一天）。只用于日期窗口，不参与任何"现在是哪一期"的推导。 */
function dayAfter(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
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
  /** 这一期没有版次时，行属于哪些语言；缺省用界面语言。 */
  locales?: readonly DailyBriefingLocale[]
  /** 只留下过失败 attempt、没有运行记录：原因照样是"这次失败"。 */
  attemptFailed?: boolean
  /** 排期过了点、今天该有却没有：第二行写「到点时没能生成」，不写内部原因、不带按钮。 */
  missedAtCutoff?: boolean
  /**
   * 没有版次的那一行，身份来自**它自己那次尝试**：什么时候发起的、怎么触发、覆盖多长。
   * 用户 2026-11-06：列表每一行要自己说清身份，不许拿默认期的 07:00 或当前设置顶上。
   */
  attemptIdentity?: Readonly<{
    startedAt: string
    trigger?: string
    windowHours?: number
    locale: DailyBriefingLocale
  }>
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
  scheduledTime?: (periodId: string) => string | undefined
  /** Runs of the window; a run with no edition row is the only trace some periods leave. */
  runs?: readonly DailyBriefingPeriodRun[]
  /** 今天「该有却没有」的排期期（甲案）：建一行说明，四种例外不建。 */
  missedPeriods?: readonly Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>[]
  /** Attempt rows of the window: a run that has not written its journal yet is still a row. */
  attemptRuns?: readonly Readonly<{
    date: string
    periodId: string
    locale: DailyBriefingLocale
    state: 'running' | 'succeeded' | 'failed'
    startedAt: string
    trigger?: string
    windowHours?: number
  }>[]
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

  const runsByDate = new Map<string, Map<string, DailyBriefingPeriodRun>>()
  for (const run of input.runs ?? []) {
    const forDate = runsByDate.get(run.date) ?? new Map<string, DailyBriefingPeriodRun>()
    forDate.set(run.periodId, run)
    runsByDate.set(run.date, forDate)
  }

  const editions: DailyBriefingEditionSummary[] = []
  for (const date of [...input.dates].reverse()) {
    const periods: PeriodRows[] = [...byPeriod.values()]
      .filter((entry) => entry.date === date)
      .map((entry) => ({ date: entry.date, periodId: entry.periodId, rows: entry.rows }))
    // 列表只显示三类行（用户 2026-11-05 拍板）：跑过且有内容的、正在跑的、失败/没跑完的。
    // 一个期没有任何版次时，只有**运行记录说它失败或还在跑**才留一行——那是"发生过的事"；
    // 跑成功却没有版次 = 那一版被删了，**整行不显示**，不解释也不留位（`A9.13` 的占位口径作废）；
    // 从来没有运行记录 → 同样不显示（"今天 13:00 那期还没到点"不再占一行，排期去设置页看）。
    const runsToday = runsByDate.get(date) ?? new Map<string, DailyBriefingPeriodRun>()
    const known = new Set(periods.map((period) => period.periodId))
    for (const [periodId, run] of runsToday) {
      if (known.has(periodId)) continue
      if (run.state !== 'failed' && run.state !== 'running') continue
      known.add(periodId)
      // 这一行属于**它自己的语言**，不是界面语言：英文那一期失败，就要有一行英文，语言徽标也标英文
      // （用户 2026-11-06：18:11 那次英文失败在中日文界面下看不见）。
      periods.push({ date, periodId, rows: new Map(), ...(run.expectedLocales.length > 0 ? { locales: run.expectedLocales } : {}) })
    }
    // 「到点时没能生成」：排期期今天该有却没有，也要留一行说明（甲案）。它排在建行之前，好让
    // 下面"有版次/有尝试就不再建"的判断优先——同一期已经有痕迹时，这一行不会被补出来。
    for (const missed of input.missedPeriods ?? []) {
      if (missed.date !== date || known.has(missed.periodId)) continue
      known.add(missed.periodId)
      periods.push({
        date, periodId: missed.periodId, rows: new Map(), locales: [missed.locale],
        missedAtCutoff: true
      })
    }
    // 只要**开始跑**过就要有一行（用户 2026-11-06）：attempt 在开工前就写了，比运行记录还早一步。
    // 一次跑在冻结事实之前就挂掉时，只有 attempt、没有运行记录、更没有版次——那一行也不许消失。
    for (const attempt of input.attemptRuns ?? []) {
      if (attempt.date !== date || known.has(attempt.periodId)) continue
      // **跑成功却没有版次 = 那一版不在库里**：要么读者删了它，要么同一个槽位的新版把正文顶掉了
      // （一个 (日期, 截止, 语言) 只留一版）。两种情况都不该画成一行「这一期没有生成过」——
      // 用户 2026-11-06 看到的 5 个空壳就是这种："跑了却说没生成过"。只有失败/还在跑的 attempt
      // 才留行，那是"发生过的事"。
      if (attempt.state === 'succeeded') continue
      known.add(attempt.periodId)
      periods.push({
        date, periodId: attempt.periodId, rows: new Map(), locales: [attempt.locale],
        attemptIdentity: {
          startedAt: attempt.startedAt, locale: attempt.locale,
          ...(attempt.trigger === undefined ? {} : { trigger: attempt.trigger }),
          ...(attempt.windowHours === undefined ? {} : { windowHours: attempt.windowHours })
        },
        ...(attempt.state === 'failed' ? { attemptFailed: true } : {})
      })
    }

    const day: DailyBriefingEditionSummary[] = []
    for (const period of periods) {
      // 一个 (日期, 期号, 语言) 一行：同一期的中英两版是两行，各有自己的时刻与窗口。
      day.push(...await summariesOfPeriod(period, input, runsToday.get(period.periodId)))
    }
    // A5.1, the one definition: nominal cutoff ascending, same moment resolved by the period id.
    // Not by generatedAt and not by window, or the reader sees the list reshuffle between renders.
    // A row with no known cutoff (a run that never published) sorts last: it cannot claim to be the
    // earliest issue of the day just because its time is unknown.
    // 天内倒序（用户 2026-11-05 定）：后来的在上；同刻仍按期号作稳定序，只是方向一并反过来。
    day.sort((left, right) => {
      if (left.periodTime === undefined || right.periodTime === undefined) {
        if (left.periodTime !== right.periodTime) return left.periodTime === undefined ? 1 : -1
      } else if (left.periodTime !== right.periodTime) {
        return left.periodTime < right.periodTime ? 1 : -1
      }
      return left.periodId < right.periodId ? 1 : left.periodId > right.periodId ? -1 : 0
    })
    // 同一个 `(日期, 期号, 语言)` 只能有一行：版次行与"这一期还没生成"的占位行撞到同一个 key 时，
    // **版次行优先**——占位是没有版次时的替代品，不是并列的另一条。不收敛的话，点一行会同时选中
    // 两行（同一个 key 被渲染两次），看起来像"选中逻辑坏了"，其实是数据重复。
    const byKey = new Map<string, DailyBriefingEditionSummary>()
    for (const row of day) {
      const key = `${row.date}:${row.periodId}:${row.locale}`
      const existing = byKey.get(key)
      if (existing === undefined || (existing.state === 'missing' && row.state !== 'missing')) byKey.set(key, row)
    }
    const unique = [...byKey.values()]
    unique.sort((left, right) => day.indexOf(left) - day.indexOf(right))
    markCurrent(unique)
    editions.push(...unique)
  }
  return Object.freeze(editions)
}

/**
 * 一期的每一份版次各出一行。
 *
 * 一行 = 一期 = 一种语言。期里有几种语言就出几行；一行都没有（这一期还没生成）时，按界面语言出
 * 一条占位行，"没生成"才是这一天的真实状态。
 */
async function summariesOfPeriod(
  period: PeriodRows,
  input: Parameters<typeof summaryOfLocale>[1],
  knownRun?: DailyBriefingPeriodRun
): Promise<readonly DailyBriefingEditionSummary[]> {
  const locales = period.rows.size === 0 ? (period.locales && period.locales.length > 0 ? period.locales : [input.primary]) : [...period.rows.keys()]
  const rows: DailyBriefingEditionSummary[] = []
  for (const locale of locales) rows.push(await summaryOfLocale(period, { ...input, primary: locale }, knownRun))
  return rows
}

async function summaryOfLocale(period: PeriodRows, input: Readonly<{
  primary: DailyBriefingLocale
  periodRun?: (date: string, periodId: string) => Promise<DailyBriefingPeriodRun | undefined> | undefined
  attemptCount?: (date: string, periodId: string, locale: DailyBriefingLocale) => Promise<number>
  scheduledTime?: (periodId: string) => string | undefined
  periodPresence?: (periodId: string) => DailyBriefingPeriodPresence | Promise<DailyBriefingPeriodPresence>
  isRunning?: (date: string, periodId: string) => boolean
  configuredLanguages?: (periodId: string) => readonly DailyBriefingLocale[] | undefined
}>, knownRun?: DailyBriefingPeriodRun): Promise<DailyBriefingEditionSummary> {
  const { date, periodId, rows } = period
  // The row's face is the reader's language. Another language being published does not turn the
  // reader's own gap into a generated row — `languages` says what exists; `state` stays about the
  // language the row shows.
  const shown = rows.get(input.primary)
  const availableLocales = [...rows.keys()]
  const identity = identityOf(shown ?? [...rows.values()][0])
  const attemptIdentity: Partial<DailyBriefingEditionSummary> = shown || period.attemptIdentity === undefined ? {} : {
    // 没有版次的那一行：时刻 = 这次尝试的**发起时刻**，来源与窗口取它自己写下的那两个字段。
    periodTime: period.attemptIdentity.startedAt,
    // 手动期没有截止，第一行要写「发起」——期次类型据来源推，别让它落到"定时"那边写成「截止」。
    periodKind: period.attemptIdentity.trigger === 'manual' ? 'manual' as const : 'scheduled' as const,
    ...(period.attemptIdentity.trigger === undefined ? {} : { runTrigger: period.attemptIdentity.trigger as DailyBriefingRunTrigger }),
    ...(period.attemptIdentity.windowHours === undefined ? {} : { windowHours: period.attemptIdentity.windowHours })
  }
  const summary: DailyBriefingEditionSummary = {
    date,
    periodId,
    locale: input.primary,
    availableLocales,
    ...identity,
    state: shown ? 'generated' : 'missing',
    // 没有版次的行：身份来自它自己那次尝试（发起时刻 / 触发方式 / 窗口），**不借当前设置**。
    ...attemptIdentity,
    ...(shown ? {
      generatedAt: shown.generatedAt,
      ...(shown.document.conclusion ? { direction: shown.document.conclusion.direction } : {}),
      // The full title, never a slice: the row clamps to two lines in CSS and the tooltip shows the
      // whole sentence. Truncating here would make the clamp permanent and the copy wrong.
      ...(shown.document.lede.text ? { summaryLine: shown.document.lede.text } : {}),
      readingsAvailable: shown.document.status.readingsAvailable,
      windowEnd: shown.windowEnd
    } : {})
  }

  const run = knownRun ?? (input.periodRun ? await input.periodRun(date, periodId) : undefined)
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
      configured: input.configuredLanguages ? input.configuredLanguages(periodId) : period.locales
    }, period.attemptFailed),
    ...(expectedLocales ? { expectedLocales } : {}),
    ...(attempts === undefined ? {} : { attemptCount: attempts }),
    ...(input.scheduledTime?.(periodId) ? { scheduledTime: input.scheduledTime(periodId)! } : {}),
    // Only a configuration known to be gone marks the row; "could not read it" is not "deleted".
    ...(presence === 'absent' ? { periodDeleted: true } : {}),
    // "Missing one version" only describes an issue that still has a version to compare with.
    ...(completeness.state === 'missing-version' && published ? { state: 'partial' as const } : {}),
    ...(period.missedAtCutoff === true ? { missedAtCutoff: true } : {})
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
  live: Readonly<{ running: boolean; configured: readonly DailyBriefingLocale[] | undefined }>,
  attemptFailed?: boolean
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
    // A run still marked `running` with nothing alive is a run the process died inside: the reader
    // is told it never finished, not that it failed (a failure never happened).
    const interrupted = run?.state === 'running'
    return Object.freeze({
      locale,
      state: 'missing' as const,
      reason: interrupted
        ? 'run-interrupted' as const
        : run?.state === 'failed' || attemptFailed ? 'run-failed' as const
        : 'not-published' as const
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
