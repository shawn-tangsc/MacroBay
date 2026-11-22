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
import type { BriefingPeriod } from '../../../contracts/dailyBriefingPeriod'
import {
  DEFAULT_PERIOD_ID,
  briefingGenerationStageIds,
  type DailyBriefingPeriodKind,
  type DailyBriefingRunTrigger,
  dailyBriefingGenerationPolicy,
  dailyBriefingPolicy,
  isDailyBriefingGenerationTime,
  isDailyBriefingWindowHours
} from '../../../contracts/dailyBriefing'
import { buildDailyBriefingDocument } from './dailyBriefingDocument'
import { createPublishToPhone, type BriefingPublishOutcome, type BriefingRedeliver } from './dailyBriefingPublishToPhone'
import { createBriefingProgressReader, progressLookup } from './dailyBriefingProgressReader'
import { isCurrent, markEditorialFailure, withEditorialModel } from './dailyBriefingEditorialState'
import type { DailyBriefingFactPacket } from './dailyBriefingFactPacket'
import type { DailyBriefAgentRunner } from './dailyBriefAgentRunner'
import { runDailyBriefAgentTurn, type DailyBriefTurnStageEvent, type DailyBriefBackfillExecutor } from './dailyBriefAgentTurn'
import { settleEditorialEdition } from './dailyBriefingPublish'
import { createDailyBriefingGenerationRecorder } from './dailyBriefingGenerationTrace'
import { prepareMarketForRun } from './dailyBriefProgressWaiting'
import { createDailyBriefingReads, restoreAndReportBriefingDisplayValues, type DailyBriefingGetResult } from './dailyBriefingReads'
import { notifyBriefingFailure, notifyDailyBriefing, type DailyBriefingNoticeSubmit } from './dailyBriefingNotifier'
import { createDailyBriefingAttemptJournal } from './dailyBriefingAttemptJournal'
import type { DailyBriefReadiness } from './dailyBriefReadinessGate'
export { createDailyBriefReadinessFor } from './dailyBriefReadinessGate'
import { finalizeRunDocument } from './dailyBriefRunFinalize'
import { previousEditionBefore } from './dailyBriefingPreviousEdition'
import { createDailyBriefingRunCoalescer } from './dailyBriefingRunCoalescer'
import { candidateBudget, cutoffDate, isOutputTruncation, turnFailureCode, withDeadline } from './dailyBriefingGenerationGuards'
import { openStoredEdition } from './dailyBriefingReadOnlyOpen'
import { withGenerationTrace, withStoredAttempt } from './dailyBriefingStoredAttempt'
import { briefingEditionRowIds, briefingFactDirection, restrictEditionRows } from './dailyBriefingEditionSet'
import { readBriefingListHistory } from './dailyBriefingListHistory'
import { missedScheduledPeriods } from './dailyBriefingMissedPeriods'
import { createAutoRetryingResolve } from './dailyBriefingAutoRetry'
export type { DailyBriefingAttemptEnd, DailyBriefingAttemptStart } from './dailyBriefingAttemptJournal'
import type { DailyBriefingAttemptEnd, DailyBriefingAttemptStart } from './dailyBriefingAttemptJournal'
import { createDailyBriefingRegenerate, type DailyBriefingRegenerateInput } from './dailyBriefingRegenerate'
import { briefingEditionSlotPeriodId, type BriefingAttemptRunStore, type BriefingEditionSlotStore } from './dailyBriefingEditionSlot'
import { briefingSnapshot, type DailyBriefingFactSnapshot } from './dailyBriefingFactSnapshot'
import { createDailyBriefingPeriodRunJournal } from './dailyBriefingPeriodRunJournal'
import type { DailyBriefingEditorialModel } from './dailyBriefingAiSettings'
import type { DailyBriefingDeleteAuditWriter } from './dailyBriefingPeriodDeletion'
import type { DailyBriefingGenerationSettings } from './dailyBriefingGenerationSettings'
import { briefingWindow, localDate, type DailyBriefingWindow, type DailyBriefingZoneSource } from './dailyBriefingWindow'

// Kept as the service's public surface: the window arithmetic moved out, the import path did not.
export { briefingWindow, localDate }
export type { DailyBriefingWindow }
// Same reason: the service's contract types moved out, the import path did not.
import type {
  DailyBriefCoreFactEnsure,
  DailyBriefingGeneration,
  DailyBriefingListResultView,
  DailyBriefingService,
  DailyBriefingSource,
  DailyBriefingStore,
  DailyBriefingTodayFailureCode,
  DailyBriefingTodayResult
} from './dailyBriefingServiceContracts'
import {
  DAILY_BRIEF_FACT_ENSURE_BUDGET_MS,
  DAILY_BRIEF_GENERATION_BUDGET_MS
} from './dailyBriefingServiceContracts'
export type {
  DailyBriefCoreFactEnsure,
  DailyBriefingAttemptsResult,
  DailyBriefingGeneration,
  DailyBriefingGetResult,
  DailyBriefingListResultView,
  DailyBriefingPeriodRun,
  DailyBriefingService,
  DailyBriefingSource,
  DailyBriefingStorageState,
  DailyBriefingStorageSurface,
  DailyBriefingStore,
  DailyBriefingStoredEdition,
  DailyBriefingTodayFailureCode,
  DailyBriefingTodayResult
} from './dailyBriefingServiceContracts'
export { DAILY_BRIEF_FACT_ENSURE_BUDGET_MS, DAILY_BRIEF_GENERATION_BUDGET_MS } from './dailyBriefingServiceContracts'

const defaultGeneration: DailyBriefingGeneration = Object.freeze({
  generationTime: dailyBriefingGenerationPolicy.defaultGenerationTime,
  windowHours: dailyBriefingGenerationPolicy.defaultWindowHours
})

/** Attaches which zone produced the window, but only where there is an edition to describe. */
function withTimeZoneSource(
  result: DailyBriefingTodayResult,
  zoneSource: DailyBriefingZoneSource
): DailyBriefingTodayResult {
  return result.state === 'available' ? { ...result, timeZoneSource: zoneSource } : result
}

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
  /** 期配置列表：`regenerate` 按 `periodId` 取这一期自己的时刻、窗口与语言（缺省退回旧口径）。 */
  readPeriods?: () => Promise<readonly BriefingPeriod[]>
  /**
   * E9：这一版最新一次生成用的会话 id。**查不到或读失败都返回 `null`**——列表据此不显示
   * 「打开会话」，而不是显示一个禁用占位（那等于承诺"本来该有"）。
   */
  sessionIdOf?: (input: Readonly<{ date: string; periodId: string; locale: DailyBriefingLocale }>) => Promise<string | null>
  noticeSubmit?: DailyBriefingNoticeSubmit; /** 出图（自动推送带图）：缺省＝不出图，行为回到只发正文。 */ renderPoster?: import('./briefingPosterProducer').BriefingPosterProducer['render']
  /** 结构化诊断（appLog）：导读被扣时那条日志走它；缺省时只是不记。 */
  log?: import('./dailyBriefReadinessGate').BriefingDiagnosticLog
  redeliverPush?: BriefingRedeliver
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

  /** One named period's edition when the scheduler fired it; an unscheduled caller means `default`. */
  const resolveToday = createAutoRetryingResolve({ run: resolveAttempt, now })

  async function getToday(input: Readonly<{
    locale: DailyBriefingLocale
    timeZone: string
    periodId?: string
    generation?: DailyBriefingGeneration
    periodKind?: DailyBriefingPeriodKind
    runTrigger?: DailyBriefingRunTrigger
    generate?: boolean
    signal?: AbortSignal
  }>): Promise<DailyBriefingTodayResult> {
    const periodId = input.periodId ?? DEFAULT_PERIOD_ID
    const window = briefingWindow(now(), input.timeZone, input.generation ?? await generation())
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    // Opening the page is a read. A caller that passes `generate: false` gets what is stored, or a
    // code that says nothing was written yet — never a model run the reader did not ask for.
    if (input.generate === false) {
      return openStoredEdition({ store: deps.store, date: window.date, locale: input.locale, periodId, zoneSource: window.zoneSource, isCurrent })
    }
    return runs.join(runs.key(window.date, periodId, input.locale), async () => {
      const result = await resolveToday({
        asOf: window.windowEnd, date: window.date, periodId, locale: input.locale, timeZone: input.timeZone, windowHours: window.windowHours,
        ...(input.periodKind ? { periodKind: input.periodKind } : {}), ...(input.runTrigger ? { runTrigger: input.runTrigger } : {}), ...(input.signal ? { signal: input.signal } : {})
      }, false)
      return withTimeZoneSource(await withStoredAttempt(deps.store, result, window.date, input.locale, periodId), window.zoneSource)
    })
  }

  const regenerate = createDailyBriefingRegenerate({
    now, readGeneration: generation, runs, resolve: resolveToday, withZone: withTimeZoneSource,
    ...(deps.readPeriods ? { readPeriods: deps.readPeriods } : {})
  })

  async function resolveAttempt(rawInput: Readonly<{
    asOf: string
    date: string
    periodId: string
    locale: DailyBriefingLocale
    timeZone: string
    windowHours: number
    periodKind?: DailyBriefingPeriodKind
    runTrigger?: DailyBriefingRunTrigger
    signal?: AbortSignal
  }>, force: boolean): Promise<DailyBriefingTodayResult> {
    // 一个 (日期, 截止, 语言) 只允许一版：槽被别的期占着就写进它，不另插一行。
    const slotPeriodId = await briefingEditionSlotPeriodId(deps.store, rawInput)
    const input = slotPeriodId === rawInput.periodId ? rawInput : Object.freeze({ ...rawInput, periodId: slotPeriodId })
    const cached = force ? undefined : await deps.store.get(input.date, input.locale, input.periodId).catch(() => undefined)
    if (cached && isCurrent(cached.document)) return { state: 'available', document: restoreAndReportBriefingDisplayValues(cached.document) }
    // 读数的那一刻（运行时刻）≠ 统计截止（`input.asOf`）：窗口按截止，读的是此刻最新的库；取一次时钟整跑共用。
    const readAt = now()
    // 先开 attempt 行：一个跑不完的进程也要留下"试过但没成"的记录，而不是"从未发生"。
    // Nothing is recorded while the market is unreadable: the wait happens before the attempt row.
    const progressKey = `${input.date}:${input.periodId}:${input.locale}`
    const market = await prepareMarketForRun({ backfill: deps.marketBackfill?.(), readiness: deps.readiness, asOf: input.asOf, manual: force, publish: (progress) => runs.progress.set(progressKey, progress), now })
    // 尝试记录写下这一次的**来源、窗口与名义截止**：列表要就着这一行说清"这是哪一次、覆盖多长、
    // 截止是哪一刻"（`asOf` 只影响这一次运行，不写回任何期配置）。
    const attempts = createDailyBriefingAttemptJournal(deps.store, {
      date: input.date, periodId: input.periodId, locale: input.locale, now,
      trigger: input.runTrigger ?? 'scheduled', windowHours: input.windowHours, nominalAt: input.asOf
    })
    if (!await attempts.open()) return { state: 'unavailable', failureCode: 'attempt-not-recorded' }
    const recorder = createDailyBriefingGenerationRecorder({
      attemptId: `${input.date}:${input.locale}:${input.asOf}`,
      now,
      onChange: () => runs.progress.set(progressKey, recorder.snapshot())
    })
    // 开工前先发第一份快照：否则轮询的读者在请求与第一个阶段之间会被告知"什么都没在跑"。
    runs.progress.set(progressKey, recorder.snapshot())
    // 这一期的事实只冻一次；这一次跑的每一版都从那份文档写出来。
    const run = createDailyBriefingPeriodRunJournal(deps.store, { date: input.date, periodId: input.periodId, locale: input.locale, now })
    let activeStage: BriefingGenerationStageId | undefined
    let failedStage: BriefingGenerationStageId | undefined
    const fail = async (failureCode: DailyBriefingTodayFailureCode): Promise<DailyBriefingTodayResult> => {
      const generationTrace = recorder.complete('failed')
      await attempts.settle('failed', generationTrace.finishedAt, { failureCode, trace: generationTrace })
      await run.settle('failed', 0)
      await notifyBriefingFailure(deps.noticeSubmit, { variant: 'not-generated', date: input.date, periodId: input.periodId, locale: input.locale, asOf: input.asOf, timeZone: input.timeZone }, now())
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
      facts = await withDeadline(deps.source.readFacts({ asOf: readAt, windowEnd: input.asOf, windowHours: input.windowHours, periodId: input.periodId }), 15_000)
      // Rendering is text-only work over the frozen facts; it is not a second read.
      // The facts are period-independent; the identity is this run's, so it is attached here rather
      // than inside the source (which never sees a period). Every edition this run writes then
      // carries the id it was generated for, not a literal `default`.
      packet = Object.freeze({
        ...(await deps.source.renderPacket(facts, input.locale, input.timeZone)),
        periodId: input.periodId,
        periodTime: input.asOf,
        periodKind: input.periodKind ?? ((input.runTrigger ?? 'scheduled') === 'manual' ? 'manual' : 'scheduled'),
        runTrigger: input.runTrigger ?? 'scheduled'
      })
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
      document = finalizeRunDocument(document, { gap: { failure: packet.market.crossAssetFailure, readinessWait: market.readinessWait, backfilled: market.backfillAttempted, locale: input.locale }, packet })
      recorder.end('candidates', 'success')
    } catch {
      recorder.end('candidates', 'failed', { failureCode: 'build-failed' })
      return fail('build-failed')
    }
    // A pool above the per-class budget fails before any editorial work or write: the builder caps
    // its rendered sections, and a capped selection would silently stand in for the whole day.
    const budget = candidateBudget(packet, document)
    if (budget.overflow) {
      /* 只在日志里带上数量：这一档如果真触发，要能证明「确实超了」、超在哪一类，
         而不是和「读不到」「没有发布」混成一句。不给它做界面。 */
      deps.log?.('warn', 'briefing.candidate-overflow', {
        failureCode: 'candidate-overflow',
        newsCandidates: budget.newsCandidates, newsLimit: budget.newsLimit,
        macroCandidates: budget.macroCandidates, macroLimit: budget.macroLimit
      })
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
          const failureCode = turnFailureCode(error)
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
          // The answer is no longer awaited, but the runtime session must stop. The port only abandons
          // a link that is still running, so a turn that finished at the deadline keeps its state.
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
    // 写作没出来之后发不发、按什么记：判定与两个出口都住在 `settleEditorialEdition`（一处实现）。
    return settleEditorialEdition({
      document, store: deps.store, attempts, run, recorder, now,
      ...(deps.noticeSubmit ? { noticeSubmit: deps.noticeSubmit } : {}), ...(deps.renderPoster ? { renderPoster: deps.renderPoster } : {}),
      date: input.date, periodId: input.periodId, locale: input.locale, asOf: input.asOf, timeZone: input.timeZone, force
    })
  }
  async function list(input: Readonly<{ locale: DailyBriefingLocale; timeZone: string }>): Promise<DailyBriefingListResultView> {
    const schedule = await generation()
    const window = briefingWindow(now(), input.timeZone, schedule)
    if (!window) return { state: 'unavailable', failureCode: 'time-invalid' }
    const listed = await readBriefingListHistory({
      store: deps.store, locale: input.locale, today: window.date, timeZone: input.timeZone,
      generationTime: schedule.generationTime, now: now(),
      periods: await (deps.readPeriods?.().catch(() => []) ?? Promise.resolve([])),
      // "Generating" is a live fact: the stored run row outlives the process that wrote it.
      progressKeys: () => runs.progress.keys(),
      ...(deps.sessionIdOf ? { sessionIdOf: deps.sessionIdOf } : {})
    })
    return { state: 'available', result: { editions: listed.editions, dates: listed.dates, today: window.date } }
  }

  const getProgress = createBriefingProgressReader({ now, readGeneration: generation, progressOf: progressLookup(runs.progress, runs.key) })
  return { getToday, regenerate, publishToPhone: createPublishToPhone({ store: deps.store, submit: deps.noticeSubmit, redeliver: deps.redeliverPush, log: deps.log, now }), list, ...reads, getProgress }
}
