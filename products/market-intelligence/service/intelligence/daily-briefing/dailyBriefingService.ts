import type {
  BriefingGenerationProgress,
  BriefingGenerationStageId,
  BriefingGenerationTrace,
  DailyBriefingAttemptRecord,
  DailyBriefingDocument,
  DailyBriefingEditionSummary,
  DailyBriefingListResult,
  DailyBriefingLocale,
  DailyBriefingProgressResult
} from '../../../contracts/dailyBriefing'
import {
  DEFAULT_PERIOD_ID,
  briefingGenerationStageIds,
  dailyBriefingGenerationPolicy,
  dailyBriefingPolicy,
  isDailyBriefingGenerationTime,
  isDailyBriefingWindowHours
} from '../../../contracts/dailyBriefing'
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
import { isCurrent, markEditorialFailure, withEditorialModel } from './dailyBriefingEditorialState'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { runDailyBriefAgentTurn, type DailyBriefTurnStageEvent, type DailyBriefBackfillExecutor } from './dailyBriefAgentTurn'
import { createDailyBriefingGenerationRecorder } from './dailyBriefingGenerationTrace'
import { prepareMarketForRun } from './dailyBriefProgressWaiting'
import { createDailyBriefingReads } from './dailyBriefingReads'
import { notifyDailyBriefing, type DailyBriefingNoticeSubmit } from './dailyBriefingNotifier'
import { createDailyBriefingAttemptJournal } from './dailyBriefingAttemptJournal'
import type { DailyBriefReadiness } from './dailyBriefReadinessGate'
export { createDailyBriefReadinessFor } from './dailyBriefReadinessGate'
import { withRunGaps } from './dailyBriefCrossAssetGap'
import { previousEditionBefore } from './dailyBriefingPreviousEdition'
import { createDailyBriefingRunCoalescer } from './dailyBriefingRunCoalescer'
import { candidateOverflow, cutoffDate, isOutputTruncation, withDeadline } from './dailyBriefingGenerationGuards'
import { openStoredEdition } from './dailyBriefingReadOnlyOpen'
import { withGenerationTrace, withStoredAttempt } from './dailyBriefingStoredAttempt'
import { briefingEditionRowIds, briefingFactDirection, restrictEditionRows } from './dailyBriefingEditionSet'
import { readBriefingHistory } from './dailyBriefingHistory'
import { briefingSnapshot, type DailyBriefingFactSnapshot } from './dailyBriefingFactSnapshot'
import { createDailyBriefingPeriodRunJournal } from './dailyBriefingPeriodRunJournal'
import type { DailyBriefingEditorialModel } from './dailyBriefingAiSettings'
import type { DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'
import { briefingWindow, localDate, type DailyBriefingWindow, type DailyBriefingZoneSource } from './dailyBriefingWindow'

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
  periodId?: string
  locale: DailyBriefingLocale
  generatedAt: string
  windowStart: string
  windowEnd: string
  document: DailyBriefingDocument
}>

/** An attempt is opened when the work starts, so an interrupted run is still a row. */
export type DailyBriefingAttemptStart = Readonly<{
  date: string
  /** Which issue this attempt belongs to; absent means `default`. */
  periodId?: string
  locale: DailyBriefingLocale
  startedAt: string
}>

/** The same row, settled. It is updated in place, never deleted: the attempt is history. */
export type DailyBriefingAttemptEnd = Readonly<{
  date: string
  periodId?: string
  locale: DailyBriefingLocale
  attemptNo: number
  state: 'succeeded' | 'failed'
  finishedAt: string
  failureCode?: string
  /** A failed attempt has no document, so its stage trace is the only record of what happened. */
  trace?: BriefingGenerationTrace
}>

/** A period's run: one per day and issue, holding what the editions of that run were written from. */
export type DailyBriefingPeriodRun = Readonly<{
  date: string
  periodId: string
  expectedLocales: readonly DailyBriefingLocale[]
  primaryRequested: string
  primaryUsed: DailyBriefingLocale
  fallbackReason?: string
  snapshotId: string
  snapshotHash: string
  contentVersion: number
  writingRounds: number
  /** The data layer's verdict; the writing may not call the opposite one. */
  direction: import('../../../contracts/marketAnalysisContracts').AnalysisConclusionDirection
  /** The ordered row ids both editions of this run must carry. */
  editionRows: readonly string[]
  state: 'running' | 'published' | 'partial' | 'failed'
  startedAt: string
  finishedAt?: string
}>

export type DailyBriefingStorageState = Readonly<
  | { state: 'ready' }
  | { state: 'incomplete'; reason: 'backup-failed' | 'migration-failed' }
>

/** What the page shows when the storage upgrade could not run, and the way to try once more. */
export type DailyBriefingStorageSurface = Readonly<{
  getState: () => DailyBriefingStorageState
  retryUpgrade: () => Promise<DailyBriefingStorageState>
}>

export type DailyBriefingStore = Readonly<{
  /** `periodId` defaults to the single issue `default`, so existing callers read their row. */
  get: (date: string, locale: DailyBriefingLocale, periodId?: string) => Promise<DailyBriefingStoredEdition | undefined>
  put: (edition: DailyBriefingStoredEdition) => Promise<void>
  list: (from: string, to: string, locale: DailyBriefingLocale) => Promise<readonly DailyBriefingStoredEdition[]>
  prune: (beforeDate: string) => Promise<void>
  /**
   * Opens a row in state `running` and returns its attempt number. The number is allocated here and
   * nowhere else; a session link only refers to it.
   */
  beginAttempt?: (attempt: DailyBriefingAttemptStart) => Promise<number>
  finishAttempt?: (attempt: DailyBriefingAttemptEnd) => Promise<void>
  /** The newest attempt of that edition, whatever its state; a stored trace when it has one. */
  getAttempt?: (date: string, locale: DailyBriefingLocale, periodId?: string) => Promise<BriefingGenerationTrace | undefined>
  /**
   * The tombstone: the trace is cleared and `cleanedAt` written, the row stays. Returns the number
   * of rows changed — `0` means the row is already gone (pruned), which is not a failure. A real
   * write error throws: the caller keeps the session link as its retry anchor and would otherwise
   * never know the tombstone was never written. `null` is the third answer: the database has not
   * been upgraded, so it cannot hold a tombstone yet — the row is still there and the caller must
   * keep the link and try again later, not treat it as "the row is gone".
   */
  markAttemptCleaned?: (input: Readonly<{
    editionDate: string
    /** Required: without it the update could land on another issue's attempt of the same day. */
    periodId: string
    locale: DailyBriefingLocale
    attemptNo?: number
    cleanedAt: string
  }>) => Promise<number | null>
  /** Every attempt of that edition, newest first; the history rail expands this list. */
  listAttempts?: (date: string, locale: DailyBriefingLocale, periodId?: string) => Promise<readonly DailyBriefingAttemptRecord[]>
  /** The run of that period, holding the frozen facts every edition of it was written from. */
  getPeriodRun?: (date: string, periodId?: string) => Promise<DailyBriefingPeriodRun | undefined>
  /** Writes the first run of a period; a second call for the same period keeps the first facts. */
  openPeriodRun?: (run: DailyBriefingPeriodRun) => Promise<void>
  settlePeriodRun?: (run: Readonly<{
    date: string
    periodId: string
    state: 'published' | 'partial' | 'failed'
    finishedAt: string
    writingRounds?: number
  }>) => Promise<void>
  /** The edition row and the attempt that wrote it, in one transaction: never one without the other. */
  publishEdition?: (edition: DailyBriefingStoredEdition, attempt?: DailyBriefingAttemptEnd) => Promise<void>
  /**
   * Deletes one issue of one day: every language's edition, every attempt, and the period run — the
   * three tables of this database, in one transaction. Returns the row count of each; a date that
   * was already deleted returns zeros instead of throwing, so the caller can simply retry.
   */
  deletePeriod?: (date: string, periodId: string, locale: 'zh-CN' | 'en-US') => Promise<Readonly<{ editions: number; attempts: number; periodRuns: number }>>
  /** Whether the storage upgrade ran; `incomplete` means the old shape is still in use. */
  upgradeState?: () => DailyBriefingStorageState
  retryUpgrade?: () => Promise<DailyBriefingStorageState>
}>

/**
 * Two steps on purpose: the facts are read once and frozen, then each language renders its own
 * packet from them. A source that fetched per language would let two editions of one period read
 * different numbers, which is the thing this release exists to prevent.
 */
export type DailyBriefingSource = Readonly<{
  readFacts: (input: Readonly<{ asOf: string; windowHours?: number }>) => Promise<DailyBriefingFactSnapshot>
  renderPacket: (facts: DailyBriefingFactSnapshot, locale: DailyBriefingLocale, timeZone: string) => Promise<DailyBriefingFactPacket>
}>

/** Attaches which zone produced the window, but only where there is an edition to describe. */
function withTimeZoneSource(
  result: DailyBriefingTodayResult,
  zoneSource: DailyBriefingZoneSource
): DailyBriefingTodayResult {
  return result.state === 'available' ? { ...result, timeZoneSource: zoneSource } : result
}

export type DailyBriefingTodayFailureCode =
  | 'time-invalid' | 'source-failed' | 'build-failed' | 'candidate-overflow' | 'store-failed'
  | 'attempt-not-recorded' | 'run-timeout' // attempt row refused; the caller gave up waiting.
  | 'not-generated' // Not a failure: a read-only open found nothing written for this issue yet.

export type DailyBriefingTodayResult =
  | Readonly<{
    state: 'available'
    document: DailyBriefingDocument
    /**
     * Which zone produced this edition's window. `system` means the reader's setting was empty or
     * invalid and the machine's zone stood in — the caller must say so on screen, because the day may
     * differ from the one the reader configured.
     */
    timeZoneSource?: DailyBriefingZoneSource
  }>
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

/**
 * The attempts of one edition. A read that failed is its own answer: an empty list would say "no
 * attempts", which is the opposite of what a failed read tells the reader.
 */
export type DailyBriefingAttemptsResult = Readonly<
  | { state: 'available'; attempts: readonly DailyBriefingAttemptRecord[] }
  | { state: 'unavailable'; failureCode: 'attempts-unreadable' }
>

export type DailyBriefingService = Readonly<{
  /** One named period's edition when the scheduler says which fired; unscheduled callers mean `default`. */
  getToday: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string; periodId?: string; generation?: DailyBriefingGeneration; /** `false` opens the page as a read; no run. */ generate?: boolean }>) => Promise<DailyBriefingTodayResult>
  regenerate: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingTodayResult>
  list: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingListResultView>
  get: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }>) => Promise<DailyBriefingGetResult>
  listAttempts: (input: Readonly<{ date: string; locale: DailyBriefingLocale; periodId?: string }>) => Promise<DailyBriefingAttemptsResult>
  /**
   * Where the attempt that is running right now has got to.
   *
   * Reads the live snapshot only; a finished attempt is never reported here, because its trace
   * already travels with the result or with the stored edition. One attempt, one owner.
   */
  getProgress: (input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>) => Promise<DailyBriefingProgressResult>
  /** Which table shape the store is on, and a way to retry an upgrade that did not finish. */
  getStorageState: () => DailyBriefingStorageState
  retryUpgrade: () => Promise<DailyBriefingStorageState>
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
  noticeSubmit?: DailyBriefingNoticeSubmit
  /** Waits for the market the brief reads; absent means generate at once, as before. */
  readiness?: DailyBriefReadiness
  /** Late-bound: the collector is built after this service in the composition root. */
  marketBackfill?: () => Parameters<typeof prepareMarketForRun>[0]['backfill']
  now?: () => string
}>): DailyBriefingService {
  const now = deps.now ?? (() => new Date().toISOString())
  const reads = createDailyBriefingReads({ store: deps.store })
  const runs = createDailyBriefingRunCoalescer<DailyBriefingTodayResult>()

  /**
   * The most recent edition published before today — not necessarily yesterday's.
   *
   * A publication-day baseline is the previous *release*, so a day the app was not open must not
   * erase the comparison: the store is walked back through the retention window and the newest
   * edition that actually exists is used. Its date travels with the baseline, which is what lets the
   * row state the real span instead of calling every move a day move.
   */

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

  /**
   * Open today's edition — one named period's when the scheduler says which fired.
   *
   * `generation` is that period's own time and window, so a period never borrows another one's
   * cutoff; an unscheduled caller (the reader opening the page) means the period `default`.
   */
  async function getToday(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string; periodId?: string; generation?: DailyBriefingGeneration; generate?: boolean }>): Promise<DailyBriefingTodayResult> {
    const periodId = input.periodId ?? DEFAULT_PERIOD_ID
    const window = briefingWindow(now(), input.timeZone, input.generation ?? await generation())
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    // Opening the page is a read. A caller that passes `generate: false` gets what is stored, or a
    // code that says nothing was written yet — never a model run the reader did not ask for.
    if (input.generate === false) {
      return openStoredEdition({ store: deps.store, date: window.date, locale: input.locale, periodId, zoneSource: window.zoneSource, isCurrent })
    }
    return runs.join(runs.key(window.date, periodId, input.locale), async () => {
      const result = await resolveToday({ asOf: window.windowEnd, date: window.date, periodId, locale: input.locale, timeZone: input.timeZone, windowHours: window.windowHours }, false)
      return withTimeZoneSource(await withStoredAttempt(deps.store, result, window.date, input.locale, periodId), window.zoneSource)
    })
  }

  async function regenerate(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingTodayResult> {
    const window = briefingWindow(now(), input.timeZone, await generation())
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    // One run per edition, whichever path asked for it. The open path already coalesced, but a
    // reader who presses 重新生成 three times started three concurrent runs, and each of them
    // published its own agent session and its own edition. A second request now joins the run that
    // is already working on that edition instead of starting another one.
    return runs.join(runs.key(window.date, DEFAULT_PERIOD_ID, input.locale), async () =>
      withTimeZoneSource(await resolveToday({ asOf: window.windowEnd, date: window.date, periodId: DEFAULT_PERIOD_ID, locale: input.locale, timeZone: input.timeZone, windowHours: window.windowHours }, true), window.zoneSource))
  }

  async function resolveToday(input: Readonly<{ asOf: string; date: string; periodId: string; locale: DailyBriefingLocale; timeZone: string; windowHours: number }>, force: boolean): Promise<DailyBriefingTodayResult> {
    const cached = force ? undefined : await deps.store.get(input.date, input.locale, input.periodId).catch(() => undefined)
    if (cached && isCurrent(cached.document)) return { state: 'available', document: cached.document }
    // The attempt row is opened before any work: a run the process never finishes is still a
    // record of an attempt that did not succeed, instead of an attempt that never happened.
    // Nothing is recorded while the market is unreadable: the wait happens before the attempt row.
    const progressKey = `${input.date}:${input.periodId}:${input.locale}`
    const market = await prepareMarketForRun({ backfill: deps.marketBackfill?.(), readiness: deps.readiness, asOf: input.asOf, manual: force, publish: (progress) => runs.progress.set(progressKey, progress), now })
    const attempts = createDailyBriefingAttemptJournal(deps.store, { date: input.date, periodId: input.periodId, locale: input.locale, now })
    if (!await attempts.open()) return { state: 'unavailable', failureCode: 'attempt-not-recorded' }
    const recorder = createDailyBriefingGenerationRecorder({
      attemptId: `${input.date}:${input.locale}:${input.asOf}`,
      now,
      onChange: () => runs.progress.set(progressKey, recorder.snapshot())
    })
    // Publish the first snapshot before any work starts: a reader that polls between the request
    // and the first stage would otherwise be told nothing is running.
    runs.progress.set(progressKey, recorder.snapshot())
    // The facts of this period are frozen once, once they exist; every edition of the run is
    // written from that document.
    const run = createDailyBriefingPeriodRunJournal(deps.store, { date: input.date, periodId: input.periodId, locale: input.locale, now })
    let activeStage: BriefingGenerationStageId | undefined
    let failedStage: BriefingGenerationStageId | undefined
    const fail = async (failureCode: DailyBriefingTodayFailureCode): Promise<DailyBriefingTodayResult> => {
      const generationTrace = recorder.complete('failed')
      await attempts.settle('failed', generationTrace.finishedAt, { failureCode, trace: generationTrace })
      await run.settle('failed', 0)
      await notifyDailyBriefing(deps.noticeSubmit, { kind: 'failed', variant: 'not-generated', date: input.date, periodId: input.periodId }, now())
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
    let facts: DailyBriefingFactSnapshot
    try {
      facts = await withDeadline(deps.source.readFacts({ asOf: input.asOf, windowHours: input.windowHours }), 15_000)
      // Rendering is text-only work over the frozen facts; it is not a second read.
      packet = await deps.source.renderPacket(facts, input.locale, input.timeZone)
      recorder.end('source', 'success')
    } catch {
      recorder.end('source', 'failed', { failureCode: 'source-failed' })
      return fail('source-failed')
    }
    recorder.begin('candidates')
    let document: DailyBriefingDocument
    try {
      const previous = await previousEditionBefore(deps.store, input.date, input.locale)
      document = buildDailyBriefingDocument({ packet, date: input.date, ...(previous ? { previous: previous.document } : {}) })
      document = withRunGaps(document, { failure: packet.market.crossAssetFailure, readinessWait: market.readinessWait, backfilled: market.backfillAttempted, locale: input.locale })
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
    // The digest is what lets a later reader check "same batch" instead of trusting that two
    // generations happened to agree.
    // One derivation per run: the row ids and the verdict are read off the frozen facts once, then
    // handed to every version of it.
    const periodFacts = Object.freeze({ rowIds: briefingEditionRowIds(document), direction: briefingFactDirection(document) })
    await run.open(document, facts, periodFacts)
    document = restrictEditionRows(document, periodFacts.rowIds)
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
            periodFacts,
            locale: input.locale,
            priorConclusions: packet.priorConclusions ?? [],
            ...(deps.agentAllowedTools ? { allowedTools: await deps.agentAllowedTools() } : {}),
            ...(deps.backfillFactory ? { backfill: deps.backfillFactory(document.edition.windowEnd) } : {}),
            signal: controller.signal,
            onSession: (id) => { sessionId = id },
            onStage
          }), DAILY_BRIEF_GENERATION_BUDGET_MS, () => controller.abort())
        } catch (error) {
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
          // The fact layer is publishable on its own: the reader gets today's numbers and a stated
          // "this edition has no interpretation", which is a different thing from "no brief today".
          // The one thing that must not happen is a silent success, so the provenance records the code.
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
      // AI off is the fact-layer edition too: published, with the reason in the provenance.
      document = markEditorialFailure(document, 'editorial-disabled')
    }
    recorder.begin('store')
    recorder.end('store', 'success')
    const traced = withGenerationTrace(document, recorder.complete(document.provenance.editorialFailure ? 'failed' : 'success'))
    try {
      const edition = {
        date: input.date,
        periodId: input.periodId,
        locale: input.locale,
        generatedAt: traced.edition.generatedAt,
        windowStart: traced.edition.windowStart,
        windowEnd: traced.edition.windowEnd,
        document: traced
      }
      const settled = attempts.build('succeeded', traced.provenance.generationTrace?.finishedAt ?? now())
      // The edition row and the attempt that wrote it are one write: a reader never sees one
      // without the other.
      if (deps.store.publishEdition) {
        await deps.store.publishEdition(edition, settled)
      } else {
        await deps.store.put(edition)
        if (settled) await deps.store.finishAttempt?.(settled).catch(() => undefined)
      }
      await run.settle('published', 1)
    } catch {
      // Returning the document here would report a stored edition that does not exist; the next
      // read would fall back to a different generation, so surface the write failure instead.
      recorder.end('store', 'failed', { failureCode: 'store-failed' })
      return fail('store-failed')
    }
    await deps.store.prune(cutoffDate(input.date)).catch(() => undefined)
    // 完成类一天一期。自动运行投递；读者按「重新生成」照常写记录但不投递——记录是「发布频道」
    // 要核对的那一版，投递与否由按钮决定，不再靠「不发」把它整个丢掉。
    await notifyDailyBriefing(deps.noticeSubmit, {
      kind: 'ready', date: input.date, editionId: `${input.date}:${input.locale}:${input.periodId}`, locale: input.locale, deliver: !force
    }, now())
    return { state: 'available', document: traced }
  }
  async function list(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingListResultView> {
    const schedule = await generation()
    const window = briefingWindow(now(), input.timeZone, schedule)
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    const editions = await readBriefingHistory({
      store: deps.store,
      locale: input.locale,
      today: window.date,
      retentionDays: dailyBriefingPolicy.retentionDays,
      scheduledTime: schedule.generationTime
    })
    return { state: 'available', result: { editions, today: window.date } }
  }

  async function getProgress(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingProgressResult> {
    const window = briefingWindow(now(), input.timeZone, await generation())
    // A schedule the reader has not set a valid hour for cannot say which edition is running.
    if (!window) return { state: 'idle' }
    const running = runs.progress.get(runs.key(window.date, DEFAULT_PERIOD_ID, input.locale))
    return running ? { state: 'running', progress: running } : { state: 'idle' }
  }

  return { getToday, regenerate, list, ...reads, getProgress }
}
