import type {
  BriefingGenerationProgress,
  BriefingGenerationStageId,
  BriefingGenerationTrace,
  DailyBriefingDocument,
  DailyBriefingEditionSummary,
  DailyBriefingListResult,
  DailyBriefingLocale,
  DailyBriefingProgressResult
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
import { runDailyBriefAgentTurn, type DailyBriefTurnStageEvent, type DailyBriefBackfillExecutor } from './dailyBriefAgentTurn'
import { createDailyBriefingGenerationRecorder } from './dailyBriefingGenerationTrace'
import type { DailyBriefingEditorialModel } from './dailyBriefingAiSettings'
import type { DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'
import { briefingWindow, localDate, type DailyBriefingWindow } from './dailyBriefingWindow'

// Kept as the service's public surface: the window arithmetic moved out, the import path did not.
export { briefingWindow, localDate }
export type { DailyBriefingWindow }

/** What a generation needs from the reader's schedule setting. */
export type DailyBriefingGeneration = Pick<DailyBriefingGenerationSettings, 'generationTime' | 'windowHours'>

const defaultGeneration: DailyBriefingGeneration = Object.freeze({
  generationTime: dailyBriefingGenerationPolicy.defaultGenerationTime,
  windowHours: dailyBriefingGenerationPolicy.defaultWindowHours
})

/** The stored shape. The store owns the file; the service owns when a row is written. */
export type DailyBriefingStoredEdition = Readonly<{
  date: string
  /** Which issue of that day this edition is; absent means the only one, `default`. */
  editionSerial?: string
  locale: DailyBriefingLocale
  generatedAt: string
  windowStart: string
  windowEnd: string
  document: DailyBriefingDocument
}>

export type DailyBriefingAttempt = Readonly<{
  date: string
  /** Which issue the failed attempt belonged to; absent means `default`. */
  editionSerial?: string
  locale: DailyBriefingLocale
  trace: BriefingGenerationTrace
}>

export type DailyBriefingStore = Readonly<{
  /** `editionSerial` defaults to the single-issue `default`, so existing callers read their row. */
  get: (date: string, locale: DailyBriefingLocale, editionSerial?: string) => Promise<DailyBriefingStoredEdition | undefined>
  put: (edition: DailyBriefingStoredEdition) => Promise<void>
  list: (from: string, to: string, locale: DailyBriefingLocale) => Promise<readonly DailyBriefingStoredEdition[]>
  prune: (beforeDate: string) => Promise<void>
  /** A failed attempt has no document, so its stage trace is kept beside the edition key. */
  putAttempt?: (attempt: DailyBriefingAttempt) => Promise<void>
  getAttempt?: (date: string, locale: DailyBriefingLocale) => Promise<BriefingGenerationTrace | undefined>
  clearAttempt?: (date: string, locale: DailyBriefingLocale) => Promise<void>
}>

export type DailyBriefingSource = Readonly<{
  buildPacket: (input: Readonly<{ asOf: string; locale: DailyBriefingLocale; timeZone: string; windowHours?: number }>) => Promise<DailyBriefingFactPacket>
}>

export type DailyBriefingTodayFailureCode =
  | 'time-invalid' | 'source-failed' | 'build-failed' | 'candidate-overflow' | 'store-failed'

export type DailyBriefingTodayResult =
  | Readonly<{ state: 'available'; document: DailyBriefingDocument }>
  | Readonly<{
    state: 'unavailable'
    /**
     * `candidate-overflow`: one class held more candidates than the policy budget, so nothing was
     * generated or stored. `store-failed`: the edition was built but not persisted, so it is not
     * returned as if it were today's stored edition.
     */
    failureCode: DailyBriefingTodayFailureCode
    /** The failed attempt's stages; persisted beside the edition key so a refresh keeps them. */
    generationTrace?: BriefingGenerationTrace
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
  /**
   * Where the attempt that is running right now has got to.
   *
   * Reads the live snapshot only; a finished attempt is never reported here, because its trace
   * already travels with the result or with the stored edition. One attempt, one owner.
   */
  getProgress: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingProgressResult>
}>

/**
 * Wall-clock budget for one editorial generation, measured from the first agent round to the last
 * repair. One generation is up to five rounds (select, field answer, write, two repairs), and the
 * platform caps every single round at `DEFAULT_AGENT_TURN_TIMEOUT_MS` (120 s), so a smaller budget
 * would guarantee a timeout on any edition that needs more than the select round. Five minutes is
 * the ceiling the acceptance criteria promise the reader; a generation that cannot make it fails
 * with `editorial-timeout` and its session is abandoned instead of running on.
 */
export const DAILY_BRIEF_GENERATION_BUDGET_MS = 300_000

/**
 * The deterministic core-fact pass runs after the packet/document is built and before any model
 * call. It is bounded because it may touch a provider's history: a slow reader leaves the gaps for
 * the Agent protocol instead of holding the whole generation hostage.
 */
export const DAILY_BRIEF_FACT_ENSURE_BUDGET_MS = 20_000

/** The service contract for the deterministic pass; the module binds it to the shared ensure. */
export type DailyBriefCoreFactEnsure = (
  input: Readonly<{ document: DailyBriefingDocument; cutoff: string }>
) => Promise<DailyBriefingDocument>

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
  /**
   * Deterministic core-fact fill, called after the document is built and before the editorial
   * turn. Optional: a build without a historian keeps today's behaviour, and a failing or slow pass
   * leaves the document's named gaps for the Agent backfill protocol.
   */
  coreFactEnsure?: DailyBriefCoreFactEnsure
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
  /**
   * Live snapshots for the edits being generated right now, keyed like `inFlight`.
   *
   * Dropped the moment the run settles: the finished trace is written to the store (or returned
   * with the result), so keeping a copy here would be a second version of the same attempt.
   */
  const progress = new Map<string, BriefingGenerationProgress>()

  /**
   * The most recent edition published before today — not necessarily yesterday's.
   *
   * A publication-day baseline is the previous *release*, so a day the app was not open must not
   * erase the comparison: the store is walked back through the retention window and the newest
   * edition that actually exists is used. Its date travels with the baseline, which is what lets the
   * row state the real span instead of calling every move a day move.
   */
  async function previousEditionBefore(
    date: string,
    locale: DailyBriefingLocale
  ): Promise<DailyBriefingStoredEdition | undefined> {
    const start = Date.parse(`${date}T00:00:00.000Z`) - dailyBriefingPolicy.retentionDays * 24 * 60 * 60 * 1_000
    const from = Number.isFinite(start) ? new Date(start).toISOString().slice(0, 10) : date
    const listed = await deps.store.list(from, previousDateOf(date), locale).catch(() => [])
    return listed.at(-1)
  }

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
    const promise = resolveToday({ asOf: window.windowEnd, date: window.date, locale: input.locale, timeZone: input.timeZone, windowHours: window.windowHours }, false)
      .then((result) => withStoredAttempt(deps.store, result, window.date, input.locale))
      .finally(() => {
        progress.delete(key)
        inFlight.delete(key)
      })
    inFlight.set(key, promise)
    return promise
  }

  async function regenerate(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingTodayResult> {
    const window = briefingWindow(now(), input.timeZone, await generation())
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    // One run per edition, whichever path asked for it. The open path already coalesced, but a
    // reader who presses 重新生成 three times started three concurrent runs, and each of them
    // published its own agent session and its own edition. A second request now joins the run that
    // is already working on that edition instead of starting another one.
    const key = `${window.date}:${input.locale}`
    const running = inFlight.get(key)
    if (running) return running
    const promise = resolveToday({ asOf: window.windowEnd, date: window.date, locale: input.locale, timeZone: input.timeZone, windowHours: window.windowHours }, true)
      .finally(() => {
        progress.delete(key)
        inFlight.delete(key)
      })
    inFlight.set(key, promise)
    return promise
  }

  async function resolveToday(input: Readonly<{ asOf: string; date: string; locale: DailyBriefingLocale; timeZone: string; windowHours: number }>, force: boolean): Promise<DailyBriefingTodayResult> {
    const cached = force ? undefined : await deps.store.get(input.date, input.locale).catch(() => undefined)
    if (cached && isCurrent(cached.document)) return { state: 'available', document: cached.document }
    const progressKey = `${input.date}:${input.locale}`
    const recorder = createDailyBriefingGenerationRecorder({
      attemptId: `${input.date}:${input.locale}:${input.asOf}`,
      now,
      onChange: () => progress.set(progressKey, recorder.snapshot())
    })
    // Publish the first snapshot before any work starts: a reader that polls between the request
    // and the first stage would otherwise be told nothing is running.
    progress.set(progressKey, recorder.snapshot())
    let activeStage: BriefingGenerationStageId | undefined
    let failedStage: BriefingGenerationStageId | undefined
    const fail = async (failureCode: DailyBriefingTodayFailureCode): Promise<DailyBriefingTodayResult> => {
      const generationTrace = recorder.complete('failed')
      await deps.store.putAttempt?.({ date: input.date, locale: input.locale, trace: generationTrace }).catch(() => undefined)
      return { state: 'unavailable', failureCode, generationTrace }
    }
    const onStage = (event: DailyBriefTurnStageEvent): void => {
      if (event.state === 'begin') {
        activeStage = event.stage
        recorder.begin(event.stage)
        return
      }
      if (event.state === 'skipped') {
        recorder.skip(event.stage)
        return
      }
      recorder.end(event.stage, event.state, {
        ...(event.failureCode ? { failureCode: event.failureCode } : {}),
        ...(event.failureDetail ? { failureDetail: event.failureDetail } : {})
      })
      if (event.state === 'failed') failedStage = event.stage
      if (activeStage === event.stage) activeStage = undefined
    }

    recorder.begin('source')
    let packet: DailyBriefingFactPacket
    try {
      packet = await withDeadline(deps.source.buildPacket({ asOf: input.asOf, locale: input.locale, timeZone: input.timeZone, windowHours: input.windowHours }), 15_000)
      recorder.end('source', 'success')
    } catch {
      recorder.end('source', 'failed', { failureCode: 'source-failed' })
      return fail('source-failed')
    }
    recorder.begin('candidates')
    let document: DailyBriefingDocument
    try {
      const previous = await previousEditionBefore(input.date, input.locale)
      document = buildDailyBriefingDocument({ packet, date: input.date, ...(previous ? { previous: previous.document } : {}) })
      recorder.end('candidates', 'success')
    } catch {
      recorder.end('candidates', 'failed', { failureCode: 'build-failed' })
      return fail('build-failed')
    }
    // A pool above the per-class budget fails before any editorial work or write: the builder caps
    // its rendered sections, and a capped selection would silently stand in for the whole day.
    if (candidateOverflow(packet, document)) {
      recorder.end('candidates', 'failed', { failureCode: 'candidate-overflow' })
      return fail('candidate-overflow')
    }
    // The deterministic pass owns the core numeric rows; the Agent protocol below sees only what is
    // still missing. It is deliberately before the editorial switch: the fact-layer edition benefits
    // from the same fill, and a failure here must not fail the generation.
    if (deps.coreFactEnsure) {
      recorder.begin('field-backfill')
      try {
        document = await withDeadline(
          deps.coreFactEnsure({ document, cutoff: document.edition.windowEnd }),
          DAILY_BRIEF_FACT_ENSURE_BUDGET_MS
        )
        recorder.end('field-backfill', 'success')
      } catch {
        // Keep the gaps. The Agent backfill protocol and the named gap rows remain the fallback.
        recorder.end('field-backfill', 'failed', { failureCode: 'field-backfill-failed' })
      }
    } else {
      recorder.skip('field-backfill')
    }
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
        recorder.begin('selection')
        recorder.end('selection', 'failed', { failureCode: 'model-unavailable', failureDetail: model.reason })
        failedStage = 'selection'
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
            priorConclusions: packet.priorConclusions ?? [],
            ...(deps.agentAllowedTools ? { allowedTools: await deps.agentAllowedTools() } : {}),
            ...(deps.backfillFactory ? { backfill: deps.backfillFactory(document.edition.windowEnd) } : {}),
            signal: controller.signal,
            onSession: (id) => { sessionId = id },
            onStage
          }), DAILY_BRIEF_GENERATION_BUDGET_MS, () => controller.abort())
        } catch (error) {
          publish = false
          const failureCode = isOutputTruncation(error) ? 'agent-turn-output-truncated' : 'editorial-timeout'
          const detail = error instanceof Error && error.message ? error.message : undefined
          if (activeStage) {
            recorder.end(activeStage, 'failed', { failureCode, ...(detail ? { failureDetail: detail } : {}) })
            failedStage = activeStage
            activeStage = undefined
          } else if (!failedStage) {
            recorder.begin('writing')
            recorder.end('writing', 'failed', { failureCode, ...(detail ? { failureDetail: detail } : {}) })
            failedStage = 'writing'
          }
          turn = {
            state: 'failed',
            failureCode,
            ...(detail ? { failureDetail: detail } : {}),
            sessionId: sessionId ?? 'unknown',
            toolInvocations: []
          }
          // The answer is no longer awaited, but the runtime session must stop. The port only
          // abandons a link that is still running, so a turn that finished at the deadline keeps its
          // terminal state. A deadline that fires before any session exists has nothing to close.
          if (sessionId) await deps.agentRunner.finish(sessionId, 'abandoned').catch(() => undefined)
        }
        if (turn.state === 'accepted') {
          document = model?.state === 'agent' ? withEditorialModel(turn.document, model) : turn.document
        } else {
          publish = false
          if (!failedStage) {
            recorder.begin('writing')
            recorder.end('writing', 'failed', {
              failureCode: turn.failureCode,
              ...(turn.failureDetail ? { failureDetail: turn.failureDetail } : {})
            })
            failedStage = 'writing'
          }
          document = markEditorialFailure(document, turn.failureCode, turn.failureDetail, turn.sessionId)
        }
      }
    } else if (!editorialEnabled) {
      // AI off is the fact-layer edition: it is published, and the provenance records why no agent
      // ran. A failed agent turn or an unavailable model keeps `publish` false and is never stored.
      document = markEditorialFailure(document, 'editorial-disabled')
    }
    if (publish) {
      recorder.begin('store')
      recorder.end('store', 'success')
      const traced = withGenerationTrace(document, recorder.complete('success'))
      try {
        await deps.store.put({
          date: input.date,
          locale: input.locale,
          generatedAt: traced.edition.generatedAt,
          windowStart: traced.edition.windowStart,
          windowEnd: traced.edition.windowEnd,
          document: traced
        })
        await deps.store.clearAttempt?.(input.date, input.locale).catch(() => undefined)
      } catch {
        // Returning the document here would report a stored edition that does not exist; the next
        // read would fall back to a different generation, so surface the write failure instead.
        recorder.end('store', 'failed', { failureCode: 'store-failed' })
        return fail('store-failed')
      }
      await deps.store.prune(cutoffDate(input.date)).catch(() => undefined)
      return { state: 'available', document: traced }
    }
    await deps.store.prune(cutoffDate(input.date)).catch(() => undefined)
    // A failed editorial turn still returns the fact-layer document; the page renders its failure
    // panel from `provenance.editorialFailure`. The trace travels with it so the panel can show the
    // stage that stopped, while no edition is stored.
    return { state: 'available', document: withGenerationTrace(document, recorder.complete('failed')) }
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

  async function getProgress(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingProgressResult> {
    const window = briefingWindow(now(), input.timeZone, await generation())
    // A schedule the reader has not set a valid hour for cannot say which edition is running.
    if (!window) return { state: 'idle' }
    const running = progress.get(`${window.date}:${input.locale}`)
    return running ? { state: 'running', progress: running } : { state: 'idle' }
  }

  return { getToday, regenerate, list, get, getProgress }
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
        promptVersion: meta?.promptVersion ?? 'daily-briefing.agent.v2',
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

/** A failed read without a fresh trace still shows the last persisted attempt for that edition. */
async function withStoredAttempt(
  store: DailyBriefingStore,
  result: DailyBriefingTodayResult,
  date: string,
  locale: DailyBriefingLocale
): Promise<DailyBriefingTodayResult> {
  if (result.state !== 'unavailable' || result.generationTrace || !store.getAttempt) return result
  try {
    const generationTrace = await store.getAttempt(date, locale)
    return generationTrace ? { ...result, generationTrace } : result
  } catch {
    return result
  }
}

/** A stored edition carries its own trace, so a later read does not need a second store hit. */
function withGenerationTrace(document: DailyBriefingDocument, generationTrace: BriefingGenerationTrace): DailyBriefingDocument {
  return Object.freeze({
    ...document,
    provenance: Object.freeze({ ...document.provenance, generationTrace })
  })
}

/** A model round that ran out of output is a writing failure, not a generic timeout. */
function isOutputTruncation(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  return /truncat|max[_-]?tokens|stop_reason/i.test(`${error.name} ${error.message}`)
}
