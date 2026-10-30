import type {
  DailyBriefingDocument,
  DailyBriefingEditionSummary,
  DailyBriefingListResult,
  DailyBriefingLocale
} from '../../../contracts/dailyBriefing'
import {
  dailyBriefingGenerationPolicy,
  dailyBriefingPolicy,
  isDailyBriefingGenerationTime,
  isDailyBriefingWindowHours
} from '../../../contracts/dailyBriefing'
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { runDailyBriefAgentTurn, type DailyBriefBackfillExecutor } from './dailyBriefAgentTurn'
import type { DailyBriefingEditorialModel } from './dailyBriefingAiSettings'
import { dailyBriefingCutoffMinutes, type DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'

/** What a generation needs from the reader's schedule setting. */
export type DailyBriefingGeneration = Pick<DailyBriefingGenerationSettings, 'generationTime' | 'windowHours'>

const defaultGeneration: DailyBriefingGeneration = Object.freeze({
  generationTime: dailyBriefingGenerationPolicy.defaultGenerationTime,
  windowHours: dailyBriefingGenerationPolicy.defaultWindowHours
})

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
  buildPacket: (input: Readonly<{ asOf: string; locale: DailyBriefingLocale; timeZone: string; windowHours?: number }>) => Promise<DailyBriefingFactPacket>
}>

export type DailyBriefingTodayResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{
    state: 'unavailable'
    /**
     * `candidate-overflow`: one class held more candidates than the policy budget, so nothing was
     * generated or stored. `store-failed`: the edition was built but not persisted, so it is not
     * returned as if it were today's stored edition.
     */
    failureCode: 'time-invalid' | 'source-failed' | 'build-failed' | 'candidate-overflow' | 'store-failed'
  }>

export type DailyBriefingGetResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{ state: 'missing' }>

export type DailyBriefingListResultView =
  | Readonly<{ state: 'available'; result: DailyBriefingListResult }>
  | Readonly<{ state: 'unavailable'; failureCode: 'time-invalid' }>

export type DailyBriefingService = Readonly<{
  getToday: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingTodayResult>
  regenerate: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingTodayResult>
  list: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingListResultView>
  get: (input: Readonly<{ date: string; locale: DailyBriefingLocale }>) => Promise<DailyBriefingGetResult>
}>

export function createDailyBriefingService(deps: Readonly<{
  source: DailyBriefingSource
  store: DailyBriefingStore
  agentRunner?: DailyBriefAgentRunner
  /**
   * The model the editor session may call, resolved at generation time. When it reports `disabled`
   * or `unavailable` the agent turn is not started: a session on a stale model would fail (or
   * worse, be retried as if it were a normal editorial failure).
   */
  agentModel?: () => Promise<DailyBriefingEditorialModel>
  agentAllowedTools?: () => Promise<readonly string[] | undefined>
  backfillFactory?: (cutoff: string) => DailyBriefBackfillExecutor
  editorialEnabled?: () => Promise<boolean>
  /**
   * The reader's generation setting, read at generation time. A change therefore applies to the
   * next edition: an edition that already exists is returned as stored, never rebuilt with the new
   * cutoff.
   */
  generationSettings?: () => Promise<DailyBriefingGeneration>
  now?: () => string
}>): DailyBriefingService {
  const now = deps.now ?? (() => new Date().toISOString())
  const inFlight = new Map<string, Promise<DailyBriefingTodayResult>>()

  async function generation(): Promise<DailyBriefingGeneration> {
    if (!deps.generationSettings) return defaultGeneration
    try {
      const value = await deps.generationSettings()
      return Object.freeze({
        generationTime: isDailyBriefingGenerationTime(value?.generationTime)
          ? value.generationTime
          : defaultGeneration.generationTime,
        windowHours: isDailyBriefingWindowHours(value?.windowHours)
          ? value.windowHours
          : defaultGeneration.windowHours
      })
    } catch {
      return defaultGeneration
    }
  }

  async function getToday(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingTodayResult> {
    const window = briefingWindow(now(), input.timeZone, await generation())
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    const key = `${window.date}:${input.locale}`
    const running = inFlight.get(key)
    if (running) return running
    const promise = resolveToday({ asOf: window.windowEnd, date: window.date, locale: input.locale, timeZone: input.timeZone, windowHours: window.windowHours }, false).finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
    return promise
  }

  async function regenerate(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingTodayResult> {
    const window = briefingWindow(now(), input.timeZone, await generation())
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    return resolveToday({ asOf: window.windowEnd, date: window.date, locale: input.locale, timeZone: input.timeZone, windowHours: window.windowHours }, true)
  }

  async function resolveToday(input: Readonly<{ asOf: string; date: string; locale: DailyBriefingLocale; timeZone: string; windowHours: number }>, force: boolean): Promise<DailyBriefingTodayResult> {
    const cached = force ? undefined : await deps.store.get(input.date, input.locale).catch(() => undefined)
    if (cached && isCurrent( cached.document)) return { state: 'available', document: cached.document }
    let packet: DailyBriefingFactPacket
    try {
      packet = await withDeadline(deps.source.buildPacket({ asOf: input.asOf, locale: input.locale, timeZone: input.timeZone, windowHours: input.windowHours }), 15_000)
    } catch {
      return { state: 'unavailable', failureCode: 'source-failed' }
    }
    let document: DailyBriefingDocument
    try {
      const previous = await deps.store.get(previousDateOf(input.date), input.locale).catch(() => undefined)
      document = buildDailyBriefingDocument({ packet, date: input.date, ...(previous ? { previous: previous.document } : {}) })
    } catch {
      return { state: 'unavailable', failureCode: 'build-failed' }
    }
    // A pool above the per-class budget fails before any editorial work or write: the builder caps
    // its rendered sections, and a capped selection would silently stand in for the whole day.
    if (candidateOverflow(packet, document)) return { state: 'unavailable', failureCode: 'candidate-overflow' }
    let publish = true
    const editorialEnabled = deps.editorialEnabled ? await deps.editorialEnabled().catch(() => false) : true
    if (deps.agentRunner && editorialEnabled) {
      // The editor runs as an agent session, so the model must be resolved before the session
      // opens: a stored custom choice that stopped being callable would otherwise fail the whole
      // turn after the request was already sent. `ensureAgentModel` also moves the agent onto the
      // resolved model, so settings stay the single model choice.
      const model = deps.agentModel
        ? await deps.agentModel().catch(() => Object.freeze({ state: 'unavailable' as const, reason: 'default-unavailable' as const }))
        : undefined
      if (model?.state === 'unavailable') {
        publish = false
        document = markEditorialFailure(document, 'model-unavailable', model.reason)
      } else if (model?.state === 'disabled') {
        document = markEditorialFailure(document, 'editorial-disabled')
      } else {
        let turn: Awaited<ReturnType<typeof runDailyBriefAgentTurn>>
        const controller = new AbortController()
        let sessionId: string | undefined
        try {
          turn = await withDeadline(runDailyBriefAgentTurn({
            runner: deps.agentRunner,
            document,
            locale: input.locale,
            ...(deps.agentAllowedTools ? { allowedTools: await deps.agentAllowedTools() } : {}),
            ...(deps.backfillFactory ? { backfill: deps.backfillFactory(document.edition.windowEnd) } : {}),
            signal: controller.signal,
            onSession: (id) => { sessionId = id }
          }), 120_000, () => controller.abort())
        } catch {
          publish = false
          turn = { state: 'failed', failureCode: 'editorial-timeout', sessionId: sessionId ?? 'unknown', toolInvocations: [] }
          // The answer is no longer awaited, but the runtime session must stop. The port only
          // abandons a link that is still running, so a turn that finished at the deadline keeps its
          // terminal state. A deadline that fires before any session exists has nothing to close.
          if (sessionId) await deps.agentRunner.finish(sessionId, 'abandoned').catch(() => undefined)
        }
        if (turn.state === 'accepted') {
          document = model?.state === 'agent' ? withEditorialModel(turn.document, model) : turn.document
        } else {
          publish = false
          document = markEditorialFailure(document, turn.failureCode, turn.failureDetail, turn.sessionId)
        }
      }
    } else if (!editorialEnabled) {
      // AI off is the fact-layer edition: it is published, and the provenance records why no agent
      // ran. A failed agent turn or an unavailable model keeps `publish` false and is never stored.
      document = markEditorialFailure(document, 'editorial-disabled')
    }
    if (publish) {
      try {
        await deps.store.put({
          date: input.date,
          locale: input.locale,
          generatedAt: document.edition.generatedAt,
          windowStart: document.edition.windowStart,
          windowEnd: document.edition.windowEnd,
          document
        })
      } catch {
        // Returning the document here would report a stored edition that does not exist; the next
        // read would fall back to a different generation, so surface the write failure instead.
        return { state: 'unavailable', failureCode: 'store-failed' }
      }
    }
    await deps.store.prune(cutoffDate(input.date)).catch(() => undefined)
    return { state: 'available', document }
  }

  async function list(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingListResultView> {
    const window = briefingWindow(now(), input.timeZone, await generation())
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    const today = window.date
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

/**
 * The model the agent session actually ran. `editorialMeta` is what a reader (and the history
 * rail) can audit, so it names the concrete `providerId:modelId` rather than "agent-session", and
 * carries the fallback reason when the stored custom choice was not callable.
 */
function withEditorialModel(
  document: DailyBriefingDocument,
  model: Readonly<{ providerId: string; modelId: string; source: 'default' | 'custom'; fallback?: 'custom-unavailable' }>
): DailyBriefingDocument {
  const meta = document.provenance.editorialMeta
  return Object.freeze({
    ...document,
    provenance: Object.freeze({
      ...document.provenance,
      editorialMeta: Object.freeze({
        promptVersion: meta?.promptVersion ?? 'daily-briefing.agent.v1',
        model: `${model.providerId}:${model.modelId}`,
        source: model.source,
        ...(model.fallback ? { fallback: model.fallback } : {})
      })
    })
  })
}

function markEditorialFailure(
  document: DailyBriefingDocument,
  failureCode: string,
  failureDetail?: string,
  sessionId?: string
): DailyBriefingDocument {
  return Object.freeze({
    ...document,
    provenance: Object.freeze({
      ...document.provenance,
      ...(sessionId ? { aiSessionId: sessionId } : {}),
      editorialFailure: failureCode,
      ...(failureDetail ? { editorialFailureDetail: failureDetail } : {})
    })
  })
}

/**
 * The renderer validates a document against the same two budgets, so the service must never build
 * an edition whose candidate pool is larger than the document can carry. News candidates are the
 * directional rows the builder would select; title duplicates are collapsed during selection but
 * still count against the input budget, so a duplicate flood fails instead of shrinking silently.
 * Macro candidates are the builder's own released/high/actual list, which the document keeps whole
 * in `macroCandidates` so the count here reads the same implementation the writer saw.
 */
function candidateOverflow(packet: DailyBriefingFactPacket, document: DailyBriefingDocument): boolean {
  const newsCandidates = packet.news.items.filter((item) =>
    item.polarity !== 'neutral' && item.strength >= 2 && item.confidence >= 50).length
  const macroCandidates = document.news.macroCandidates?.length ?? 0
  return newsCandidates > dailyBriefingPolicy.maximumNewsItems ||
    macroCandidates > dailyBriefingPolicy.maximumMacroItems
}

async function withDeadline<T>(read: Promise<T>, milliseconds: number, onTimeout?: () => void): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          // The losing turn rejects later: it is being cancelled at this instant. `Promise.race`
          // already subscribes to its inputs, but observe the loser explicitly here so a future
          // rewrite of this deadline can never leave a rejection for the main process.
          void read.catch(() => undefined)
          // The timeout is a cancellation, not just an abandoned wait: the work behind `read` is
          // told to stop before the caller is released with a failure.
          onTimeout?.()
          reject(new Error('daily-briefing-generation-timeout'))
        }, milliseconds)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function isCurrent(document: DailyBriefingDocument): boolean {
  return document.schemaVersion === dailyBriefingPolicy.schemaVersion && document.policyVersion === dailyBriefingPolicy.policyVersion
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
  if (!row || row.locale !== locale) return { date, locale, availableLocales: [...new Set(availableLocales)], state: 'missing' }
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

/**
 * A daily edition is not a rolling read from "now": its window is
 * [the previous generation time, the current generation time), both local wall-clock. The cutoff is
 * the reader's generation setting, defaulting to 08:00, so moving the schedule moves the cutoff with
 * it. Generation before the cutoff belongs to the previous edition; generation after it reads the
 * same cutoff no matter when it is retried. `windowHours` only changes the start of the interval.
 */
export type DailyBriefingWindow = Readonly<{ date: string; windowStart: string; windowEnd: string; windowHours: number }>

export function briefingWindow(
  asOf: string,
  timeZone: string,
  settings: Partial<DailyBriefingGeneration> = {}
): DailyBriefingWindow | undefined {
  const parsed = Date.parse(asOf)
  if (!Number.isFinite(parsed)) return undefined
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC'
  const parts = localParts(parsed, zone)
  if (!parts) return undefined
  const generationTime = isDailyBriefingGenerationTime(settings.generationTime)
    ? settings.generationTime
    : dailyBriefingGenerationPolicy.defaultGenerationTime
  const windowHours = isDailyBriefingWindowHours(settings.windowHours)
    ? settings.windowHours
    : dailyBriefingGenerationPolicy.defaultWindowHours
  const cutoff = dailyBriefingCutoffMinutes(generationTime)
  const date = parts.hour * 60 + parts.minute < cutoff ? addDays(parts.date, -1) : parts.date
  const windowEnd = zonedIso(date, Math.floor(cutoff / 60), cutoff % 60, zone)
  if (!windowEnd) return undefined
  return Object.freeze({
    date,
    windowEnd,
    windowStart: new Date(Date.parse(windowEnd) - windowHours * 60 * 60 * 1000).toISOString(),
    windowHours
  })
}

function localParts(value: number, timeZone: string): { date: string; hour: number; minute: number } | undefined {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(value))
    const get = (type: string) => parts.find((part) => part.type === type)?.value
    const year = get('year'); const month = get('month'); const day = get('day')
    const hour = Number(get('hour')); const minute = Number(get('minute'))
    return year && month && day && Number.isInteger(hour) && Number.isInteger(minute)
      ? { date: `${year}-${month}-${day}`, hour, minute }
      : undefined
  } catch { return undefined }
}

function zonedIso(date: string, hour: number, minute: number, timeZone: string): string | undefined {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return undefined
  const target = Date.UTC(year, month - 1, day, hour, minute)
  let guess = target
  try {
    for (let index = 0; index < 3; index++) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
      }).formatToParts(new Date(guess))
      const get = (type: string) => Number(parts.find((part) => part.type === type)?.value)
      const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
      guess += target - asUtc
    }
    return new Date(guess).toISOString()
  } catch { return undefined }
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10)
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

function previousDateOf(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - 24 * 60 * 60 * 1_000).toISOString().slice(0, 10)
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
