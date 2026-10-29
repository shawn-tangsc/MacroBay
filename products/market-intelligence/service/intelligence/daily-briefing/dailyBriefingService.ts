import type {
  DailyBriefingDocument,
  DailyBriefingEditionSummary,
  DailyBriefingListResult,
  DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import { dailyBriefingPolicy } from '../../../contracts/dailyBriefing'
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'

/** The stored shape. The store owns the file; the service owns when a row is written. */
export type DailyBriefingStoredEdition = Readonly<{
  date: string
  locale: DailyBriefingLocale
  generatedAt: string
  windowStart: string
  windowEnd: string
  document: DailyBriefingDocument
}>

export type DailyBriefingStore = Readonly<{
  get: (date: string, locale: DailyBriefingLocale) => Promise<DailyBriefingStoredEdition | undefined>
  put: (edition: DailyBriefingStoredEdition) => Promise<void>
  list: (from: string, to: string, locale: DailyBriefingLocale) => Promise<readonly DailyBriefingStoredEdition[]>
  prune: (beforeDate: string) => Promise<void>
}>

export type DailyBriefingSource = Readonly<{
  buildPacket: (input: Readonly<{ asOf: string; locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingFactPacket>
}>

export type DailyBriefingTodayResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{ state: 'unavailable'; failureCode: 'time-invalid' | 'source-failed' | 'build-failed' }>

export type DailyBriefingGetResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{ state: 'missing' }>

export type DailyBriefingListResultView =
  | Readonly<{ state: 'available'; result: DailyBriefingListResult }>
  | Readonly<{ state: 'unavailable'; failureCode: 'time-invalid' }>

export type DailyBriefingEditorialResult = Readonly<{
  document: DailyBriefingDocument
  state: 'agent' | 'template'
  failureCode?: string
}>

export type DailyBriefingService = Readonly<{
  getToday: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingTodayResult>
  regenerate: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingTodayResult>
  list: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingListResultView>
  get: (input: Readonly<{ date: string; locale: DailyBriefingLocale }>) => Promise<DailyBriefingGetResult>
}>

export function createDailyBriefingService(deps: Readonly<{
  source: DailyBriefingSource
  store: DailyBriefingStore
  editorial?: (input: Readonly<{ document: DailyBriefingDocument; locale: DailyBriefingLocale }>) => Promise<DailyBriefingEditorialResult>
  now?: () => string
}>): DailyBriefingService {
  const now = deps.now ?? (() => new Date().toISOString())
  const inFlight = new Map<string, Promise<DailyBriefingTodayResult>>()

  async function getToday(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingTodayResult> {
    const asOf = now()
    const date = localDate(asOf, input.timeZone)
    if (!date) return { state: 'unavailable', failureCode: 'time-invalid' }
    const key = `${date}:${input.locale}`
    const running = inFlight.get(key)
    if (running) return running
    const promise = resolveToday({ asOf, date, locale: input.locale, timeZone: input.timeZone }, false).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }

  async function regenerate(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingTodayResult> {
    const asOf = now()
    const date = localDate(asOf, input.timeZone)
    if (!date) return { state: 'unavailable', failureCode: 'time-invalid' }
    return resolveToday({ asOf, date, locale: input.locale, timeZone: input.timeZone }, true)
  }

  async function resolveToday(input: Readonly<{ asOf: string; date: string; locale: DailyBriefingLocale; timeZone: string }>, force: boolean): Promise<DailyBriefingTodayResult> {
    const cached = force ? undefined : await deps.store.get(input.date, input.locale).catch(() => undefined)
    if (cached && isCurrent( cached.document)) return { state: 'available', document: cached.document }
    let packet: DailyBriefingFactPacket
    try {
      packet = await withDeadline(deps.source.buildPacket({ asOf: input.asOf, locale: input.locale, timeZone: input.timeZone }), 15_000)
    } catch {
      return { state: 'unavailable', failureCode: 'source-failed' }
    }
    let document: DailyBriefingDocument
    try {
      document = buildDailyBriefingDocument({ packet, date: input.date })
    } catch {
      return { state: 'unavailable', failureCode: 'build-failed' }
    }
    if (deps.editorial) {
      try {
        document = (await withDeadline(deps.editorial({ document, locale: input.locale }), 25_000)).document
      } catch {
        // An editorial failure keeps the fact-layer template; it never blocks the edition.
      }
    }
    await deps.store.put({
      date: input.date,
      locale: input.locale,
      generatedAt: document.edition.generatedAt,
      windowStart: document.edition.windowStart,
      windowEnd: document.edition.windowEnd,
      document
    }).catch(() => undefined)
    await deps.store.prune(cutoffDate(input.date)).catch(() => undefined)
    return { state: 'available', document }
  }

  async function list(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingListResultView> {
    const asOf = now()
    const today = localDate(asOf, input.timeZone)
    if (!today) return { state: 'unavailable', failureCode: 'time-invalid' }
    const dates = lastDays(today, dailyBriefingPolicy.retentionDays)
    const from = dates[0]!
    const to = dates[dates.length - 1]!
    const [primary, otherLocale] = input.locale === 'zh-CN' ? ['zh-CN', 'en-US'] as const : ['en-US', 'zh-CN'] as const
    const [primaryRows, otherRows] = await Promise.all([
      deps.store.list(from, to, primary).catch(() => []),
      deps.store.list(from, to, otherLocale).catch(() => [])
    ])
    const byDate = new Map<string, DailyBriefingStoredEdition>()
    for (const row of otherRows) byDate.set(row.date, row)
    for (const row of primaryRows) byDate.set(row.date, row)
    const editions = [...dates].reverse().map((date) => summaryFor(date, primary, byDate.get(date), [primaryRows, otherRows]))
    return { state: 'available', result: { editions } }
  }

  async function get(input: Readonly<{ date: string; locale: DailyBriefingLocale }>): Promise<DailyBriefingGetResult> {
    const row = await deps.store.get(input.date, input.locale).catch(() => undefined)
    return row ? { state: 'available', document: row.document } : { state: 'missing' }
  }

  return { getToday, regenerate, list, get }
}

async function withDeadline<T>(read: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('daily-briefing-generation-timeout')), milliseconds)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function isCurrent(document: DailyBriefingDocument): boolean {
  return document.schemaVersion === 1 && document.policyVersion === 'daily-briefing.v1'
}

function summaryFor(
  date: string,
  locale: DailyBriefingLocale,
  row: DailyBriefingStoredEdition | undefined,
  allRows: readonly (readonly DailyBriefingStoredEdition[])[]
): DailyBriefingEditionSummary {
  const availableLocales = allRows
    .flat()
    .filter((candidate) => candidate.date === date)
    .map((candidate) => candidate.locale)
  if (!row) return { date, locale, availableLocales: [...new Set(availableLocales)], state: 'missing' }
  const document = row.document
  return {
    date,
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

export function localDate(asOf: string, timeZone: string): string | undefined {
  const parsed = Date.parse(asOf)
  if (!Number.isFinite(parsed)) return undefined
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: isValidTimeZone(timeZone) ? timeZone : 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date(parsed))
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    return year && month && day ? `${year}-${month}-${day}` : undefined
  } catch {
    return undefined
  }
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    return true
  } catch {
    return false
  }
}

function lastDays(today: string, days: number): readonly string[] {
  const start = Date.parse(`${today}T00:00:00.000Z`)
  return Object.freeze(Array.from({ length: days }, (_, index) =>
    new Date(start - (days - 1 - index) * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)))
}

function cutoffDate(today: string): string {
  const start = Date.parse(`${today}T00:00:00.000Z`)
  return new Date(start - (dailyBriefingPolicy.retentionDays - 1) * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
}
