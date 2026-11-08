import { randomUUID } from 'node:crypto'
import type { EventBusRuntime } from '@platform/message-bus'
import type { JobContext, JobRuntime } from '@platform/jobs'
import type {
  NotificationSubmitOutcome,
  NotificationSubmitRequest
} from '@platform/notifications/contracts/notificationContracts'

import { MARKET_ANALYSIS_MACRO_CALENDAR_FACT_METRICS } from '../../../contracts/marketAnalysisContracts'
import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { crossAssetAnalysisRanges } from '../cross-asset/crossAssetAnalysisWindows'
import { buildMarketAnalysisVerificationObservations, readFundingHistory } from '../analysis/verificationObservations'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { buildMarketAnalysisContext } from '../public-query/marketAnalysisContextQuery'
import { countAnalysisRuns, lastAutoRunAt } from '../analysis/analysisRunCounter'
import { createAnalysisSignificanceGate } from '../analysis/analysisSignificanceGate'
import { createAnalysisSlotTick, hasSlotAnchor } from '../analysis/analysisSlotTick'
import type { SessionSlotInstant } from '../analysis/analysisSlotCoverage'
import { isGateEligible, phaseForNewTriggerKey, type AnalysisTriggerSource } from '../analysis/analysisTriggerSourcePolicy'
import { queryMacroRoute } from '../public-query/macroRouteQuery'
import { createAnalysisRunService } from '../analysis/analysisRunService'
import { createAnalysisTriggerPolicy, type TriggerHistoryEntry } from '../analysis/analysisTriggerPolicy'
import { createEventGroupService, eventGroupMergeKey, type AnalysisChange } from '../analysis/eventGroupService'
import { analysisReleaseCoalescingPolicy } from '../analysis/analysisReleaseCoalescing'
import { createEvidenceSnapshotService } from '../analysis/evidenceSnapshotService'
import { hashMarketAnalysisJson } from '../analysis/analysisHash'
import { createMarketAnalysisRepository, type MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { notifyAnalysisQuota } from '../analysis/analysisQuotaNotifier'
import { createAnalysisOrchestrator } from '../analysis/analysisOrchestrator'
import { createAnalysisConclusionManualSend, type AnalysisConclusionSend } from '../analysis/analysisConclusionManualSend'
import { createAnalysisNoticeDeps, createReleaseCoverageReader, notifyAbandonedRelease } from './analysisReleaseNoticeWiring'
import { createRunSessionBinding, type RunSessionPort } from './analysisRunSessionPort'
import { hasEligibleAnalysisAnchor, readCanonicalAsOf, readSignificanceSignals, readString, resolveDomain, safeJson } from './analysisRuntimePayload'
import { createSignalScanRunner } from '../signals/signalScanRunner'
import { createSessionSlotChecks } from './analysisSessionSlotChecks'
import { resolveTriggerFocus } from '../analysis/analysisTriggerFocus'
import { isMarketAnalysisEnabled, isMarketAnalysisModelSet, type MarketAnalysisSettings, type MarketAnalysisSettingsPatch } from '../application/marketAnalysisSettings'
import { MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'
import { createMarketAnalysisSettingsService, type MarketAnalysisSettingsService } from '../application/marketAnalysisSettingsService'
import { createInMemoryMarketAnalysisSettingsStorage, createMarketAnalysisSettingsStore } from '../application/marketAnalysisSettingsStore'
import { createPredictionVerificationService } from '../analysis/predictionVerificationService'
import type { PredictionVerificationObservation } from '../analysis/predictionVerificationService'
import { parseCrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { appendAnalysisEventEvidence } from '../analysis/analysisEventEvidence'
import { appendAnalysisNewsSentiment, newsSentimentSince } from '../analysis/analysisNewsSentimentEvidence'
import { registerMarketAnalysisJobs } from './registerMarketAnalysisJobs'
import { GROUP_MARKET_ANALYSIS_CHANGE_JOB, ANALYSIS_SESSION_SLOTS_JOB, RUN_MARKET_ANALYSIS_JOB } from './marketAnalysisJobIds'
import { createInitialMarketAnalysisRequest, initialMarketAnalysisRequestPolicy } from './requestInitialMarketAnalysis'
import { createSignalAnalysisRequest, type SignalAnalysisService } from './requestSignalAnalysis'

export { buildMarketAnalysisVerificationObservations } from '../analysis/verificationObservations'

export type MarketAnalysisRuntime = Readonly<{
  repository: MarketAnalysisRepository
  startRecovery: () => Promise<void>
  getSettings: () => Promise<MarketAnalysisSettings>
  updateSettings: (patch: MarketAnalysisSettingsPatch) => Promise<MarketAnalysisSettings>
  requestInitialAnalysis: (itemId: string | undefined, retryRunId: string | undefined, mode: 'initial' | 'refresh', source: AnalysisTriggerSource) => Promise<{ itemId: string; queued: true }>
  /** 最后一跳：规则线把一条模块信号交给它（见 `requestSignalAnalysis`）。 */
  requestSignalAnalysis: SignalAnalysisService
  /** 抽屉里那枚「发送到频道」：按运行 id 取结论，走与自动推送同一条提交路。 */
  sendConclusion: AnalysisConclusionSend
  setCrossAssetQuery: (query: ((input: { range: '1h' | '24h' | '7d'; asOf: string }) => unknown) | undefined) => void
  /** Mounted by the bootstrap: the session ports are injected there, not built here. */
  setRunSessionPort: (port: RunSessionPort | undefined) => void
  dispose: () => void
}>

export function formatMarketAnalysisContextDiagnostic(input: Readonly<{
  asOf: string
  macroQueryState: string
  macroEventCount: number
  macroFactCount: number
  macroEvidenceCount: number
  macroCaveats: readonly string[]
}>): string {
  return JSON.stringify({ marker: 'MI_ANALYSIS_MACRO_CONTEXT', ...input })
}

const MARKET_ANALYSIS_CONSUMER_ID = 'market-intelligence.market-analysis-trigger'

/**
 * 订阅话题与处理函数名都从 manifest 读（`MI-11-R22` A1）：手写第二份数组就是漂移的源头，
 * 之前 manifest 写着 `eventConsumers: []` 而这里实注册 3 个 topic，就是这么来的。
 *
 * 声明缺失时**返回 null 并报一条具名诊断，不抛**：这段跑在 `registerProductServices` 里，
 * 而外层的 `catch { markUnavailable(); return }`（`app.ts:2630`）会在主窗渲染（`:2723`）之前
 * 直接返回——抛出去就是「白窗 + 用户看不到任何报错」，等于拿整个应用陪一条声明。
 * 缺声明由用例钉住（`product.manifest.test.ts`），运行期由这条日志留痕。
 */
export function resolveMarketAnalysisConsumerRegistration(
  manifest: { eventConsumers?: readonly { id: string; topics: readonly string[]; handlerId: string }[] } = marketIntelligenceProductManifest
): { topics: readonly string[]; handlerId: string } | null {
  const registration = manifest.eventConsumers?.find((consumer) => consumer.id === MARKET_ANALYSIS_CONSUMER_ID)
  if (!registration) {
    console.error(
      `market-intelligence.event-consumer-undeclared: the manifest does not declare "${MARKET_ANALYSIS_CONSUMER_ID}", so the market analysis trigger stays off.`
    )
    return null
  }
  return registration
}

export function resolveMarketAnalysisSeverity(item: import('../schema/intelligenceRecord').IntelligenceItem): 'low' | 'medium' | 'high' | 'critical' {
  const labels = safeJson(item.processingLabelsJson)
  if (item.severityHint === 'critical') return 'critical'
  if (item.severityHint === 'warning') return 'medium'
  return labels.relevanceOutcome === 'full-intelligence' && labels.sentimentEligible === true ? 'high' : 'low'
}

export function registerMarketAnalysisRuntime(input: Readonly<{
  jobRuntime: JobRuntime
  eventBusRuntime?: EventBusRuntime
  pipeline: IntelligencePipeline
  publicQueryService: MarketIntelligencePublicQueryService
  structuredModelInvocation: Pick<import('@platform/ai/invocation/structuredModelInvocation').StructuredModelInvocationService, 'invoke'>
  /**
   * Absent in headless wiring (and in most tests): the runtime then behaves as a fresh install with
   * no settings yet, which is the documented default rather than a wiring error.
   */
  settingsService?: MarketAnalysisSettingsService
  /** 读者当前语言；分析正文按它在提交时决定用哪种语言书写。 */
  getAppLanguage?: () => Promise<'zh-CN' | 'en-US'>
  /**
   * 重点舆情读取器（`newsSentiment.query`）。缺省时该域不可用，快照记一条
   * `news-sentiment-unavailable`，而不是把「没有舆情」当成「没有新闻」。
   */
  newsSentimentQuery?: import('../analysis/analysisNewsSentimentEvidence').AnalysisNewsSentimentQuery
  dataDir: string
  now?: () => string
  /**
   * 读者时区（主进程唯一提供者）。缺省 UTC：headless 与绝大多数测试没有读者可问，
   * 固定值比「回落到运行机器的时区」诚实得多。
   */
  timeZone?: () => string
  /** 通知端口（额度提醒等）；缺省表示未装配运行时，分析与结算照常。日历发布不走这里，见下。 */
  submitNotification?: (request: NotificationSubmitRequest) => Promise<NotificationSubmitOutcome>
  crossAssetQuery?: (input: { range: '1h' | '24h' | '7d'; asOf: string }) => unknown
}>): MarketAnalysisRuntime {
  const now = input.now ?? (() => new Date().toISOString())
  const timeZone = input.timeZone ?? (() => 'UTC')
  // Wiring with no settings service (headless product probes and most tests) keeps the previous
  // behaviour — enabled, following the platform default model — because there is no reader to ask.
  // The product itself always passes the file-backed service, whose default is off.
  const settingsService = input.settingsService ?? createMarketAnalysisSettingsService({
    store: createMarketAnalysisSettingsStore(
      createInMemoryMarketAnalysisSettingsStorage({ enabled: true, providerId: '', modelId: '', updatedAt: now() }),
      now
    ),
    now
  })
  const repository = createMarketAnalysisRepository({ filePath: `${input.dataDir}/market-analysis.sqlite` })
  const groups = createEventGroupService({ now, idFactory: () => `mi-eg-${randomUUID()}` })
  const snapshots = createEvidenceSnapshotService({ now, idFactory: () => `mi-es-${randomUUID()}` })
  const runs = createAnalysisRunService({ repository, now, idFactory: () => `mi-ar-${randomUUID()}` })
  // 覆盖查询的接线（这次发布是不是已经有分析在管）：groupChange 是函数声明，可能在下面的装配
  // 期间就被调用，所以它在任何调用之前初始化。
  const releaseCoverage = createReleaseCoverageReader({ now, repository, pipeline: input.pipeline })
  const triggerPolicy = createAnalysisTriggerPolicy()
  const runSession = createRunSessionBinding()
  const analysisOrchestrator = createAnalysisOrchestrator({
    repository,
    // 原文存档：每次模型调用一行，提示词在调用前落盘、回答在回来后回填。存储那半在
    // `repository.analysisIo`，这里只是把它交给编排器，不另开一条写路径。
    ...(repository.analysisIo ? { analysisIo: repository.analysisIo } : {}),
    timeZone,
    structuredModelInvocation: input.structuredModelInvocation,
    now,
    idFactory: () => randomUUID(),
    ...(input.getAppLanguage ? { getLanguage: input.getAppLanguage } : {}),
    ...createAnalysisNoticeDeps({ ...input, now, timeZone }),
    ensureRunSession: runSession.ensureRunSession,
    appendRunSummary: runSession.appendRunSummary
  })
  const predictionVerification = createPredictionVerificationService({
    repository,
    now,
    idFactory: () => `mi-pv-${randomUUID()}`
  })
  const significanceGate = createAnalysisSignificanceGate({
    now,
    queryMacroRoute: ({ asOf, months }) => queryMacroRoute(input.publicQueryService, { asOf, months }),
    countRuns: (at, excludedRowId) => countAnalysisRuns(repository, at, excludedRowId),
    lastAutoRunAt: (eventGroupId, at) => lastAutoRunAt(repository, eventGroupId, at),
    recordDecision: (decision) => { void runs.recordDecision(decision) },
    updateDecision: (rowId, decision, reasonCode) => repository.updateTriggerLedgerDecision(rowId, decision, reasonCode),
    // P3：当日额度被拒时告诉读者一次；按 UTC 日的键由平台声明展开，同一天重复被拒不会多一条。
    notifyQuotaExhausted: async ({ used, limit, occurredAt }) => {
      await notifyAnalysisQuota(input.submitNotification, { used, limit, occurredAt })
    }
  })
  let crossAssetQuery = input.crossAssetQuery
  let disposed = false

  /**
   * An open counts as served only by a run that was requested *for that open* and succeeded inside
   * its delivery window.
   *
   * Deliberately not "a succeeded run in the window" — that rule silently collapsed two opens into
   * one: the previous day's 16:00 open was caught up at 01:21, its run finished at 01:22, and because
   * that instant sits inside the 00:00 open's window the 00:00 open was counted as served and never
   * analysed. The reader noticed before the code did ("那美洲盘的呢？").
   *
   * Not "a queued ledger row exists" either: the gate writes that row before the model call, so a
   * row alone would mark a failed attempt as delivered. A manual or data-driven analysis near an open
   * does not cancel the open for the same reason — the open's own analysis is what says what the
   * session looked like.
   */
  const slotChecks = createSessionSlotChecks({
    now,
    listRuns: () => repository.listRuns(),
    listEventGroups: () => repository.listEventGroups(),
    listTriggerLedger: eventGroupId => repository.listTriggerLedger(eventGroupId)
  })
  // The tick's log line is the record a reader/operator can see for "no more retries today"; the
  // job context that can write it only exists while the job runs.
  let jobLog: ((input: { level: 'info' | 'warn'; message: string; metadata?: Record<string, unknown> }) => Promise<void>) | undefined
  const slotTick = createAnalysisSlotTick({
    now,
    timeZone,
    isDelivered: slotChecks.isDelivered,
    isAbandoned: slotChecks.isAbandoned,
    attemptsToday: slotChecks.attemptsToday,
    // The schedule only needs something to analyse; see `hasSlotAnchor` for why the analysis
    // anchor's eligibility rule must not gate it.
    hasEligibleAnchor: () => hasSlotAnchor(input.pipeline.listItems()),
    // Goes through the ordinary request path, so the gate's budget, interval and ledger apply.
    requestSlotAnalysis: instant => requestInitialAnalysis(undefined, undefined, 'refresh', 'session-slot', instant.slot).then(() => undefined),
    log: (message, metadata) => jobLog?.({ level: 'info', message, metadata }) ?? Promise.resolve()
  })
  const analysisJobs = registerMarketAnalysisJobs(input.jobRuntime, {
    runSessionSlots: async (context) => {
      // The schedule is unarmed while the capability is off, and the handler still refuses: a run
      // queued before the switch was turned off must not spend a request either.
      if (!await isEnabled()) return
      jobLog = async input => { await context.log(input) }
      let result: Awaited<ReturnType<typeof slotTick.run>>
      try {
        result = await slotTick.run()
      } finally {
        // Keep the logger until the signal phase is done; only then clear it.
      }
      // Re-checked after the slot phase: the switch may have been turned off during this tick.
      if (!await isEnabled()) { jobLog = undefined; return }
      await context.log({
        level: result.outcome === 'no-anchor' ? 'warn' : 'info',
        // The opens are named: "which session was this conclusion for" is the question the reader
        // and the timeline attribution both ask.
        message: `Market analysis session slots: ${result.outcome}`,
        metadata: { outcome: result.outcome, requested: result.requested, deferred: result.deferred }
      })
      try {
        await runSignalScan()
      } finally {
        jobLog = undefined
      }
    },
    groupChange: async (payload) => {
      if (!await isEnabled()) return
      return groupChange(payload)
    },
    freezeSnapshot: async (payload) => {
      if (!await isEnabled()) return
      return freezeSnapshot(payload)
    },
    runAnalysis: async (payload, context) => runAnalysis(payload, context),
    // The job run id only exists once the enqueue answers, so this is the write-back point rather
    // than the run handler: a queued analysis that never starts must still be reachable from the
    // run log, which is where a reader looks when a run did not happen.
    linkAnalysisRunToJob: (analysisRunId, jobRunId) => {
      repository.linkRunJobRun({ id: analysisRunId, jobRunId })
    },
    verifyPredictions: async (payload, context) => {
      if (!await isEnabled()) return
      const asOf = readCanonicalAsOf(payload)
      if (!asOf) throw new Error('analysis-invalid-job-payload')
      const result = predictionVerification.verifyDue({
        asOf,
        observations: buildMarketAnalysisVerificationObservations(asOf, input.pipeline.listItems(), {
          funding: await readFundingHistory(input.publicQueryService, asOf),
          crossAsset: crossAssetQuery ? { query: query => {
            try { return parseCrossAssetSnapshot(crossAssetQuery!(query)) }
            catch { return undefined }
          } } : undefined
        })
      })
      // 结算本身不发通知：N8 `calibration.result` 已从批准表撤回（编号不复用），结算结果由校准视图呈现。
      await context.log({
        level: 'info',
        message: `Verified ${result.verified} due market prediction(s); skipped ${result.skipped}.`,
        metadata: { asOf, verified: result.verified, skipped: result.skipped }
      })
    },
    recoverRuns: async (_payload, context) => {
      if (!await isEnabled()) return
      const recovery = runs.recover()
      // The service can only write rows; this is the only place that can hand a recovered
      // run to the job runtime, and the freeze path is not available to it (recovery
      // analyses a snapshot that already exists, so there is nothing to freeze). A run
      // that still has a live job is left alone: dispatching it twice would make the
      // second run job fail on `claimRun`.
      const dispatch = recovery.dispatch.filter(run => input.jobRuntime.listRuns({
        handlerId: RUN_MARKET_ANALYSIS_JOB,
        statuses: ['queued', 'running'],
        payload: { analysisRunId: run.analysisRunId },
        limit: 1
      }).length === 0)
      await context.log({
        level: 'info',
        message: `Recovered ${recovery.failed.length} market analysis run(s); expired ${recovery.stale.length}; dispatching ${dispatch.length}.`,
        metadata: { failed: recovery.failed.length, stale: recovery.stale.length, dispatching: dispatch.length }
      })
      return { dispatch }
    }
  }, { startRecovery: false })

  /**
   * The capability is armed from the stored switch, and only from it.
   *
   * Reading it may fail (a locked file, a store that is not ready yet); the failure is treated as
   * "off" so a broken settings read cannot silently re-arm automatic model calls.
   */
  const isEnabled = async (): Promise<boolean> => {
    try {
      return isMarketAnalysisEnabled(await settingsService.getSettings())
    } catch {
      return false
    }
  }
  const syncAnalysisSchedules = async (): Promise<void> => {
    analysisJobs.applySchedules(await isEnabled())
  }
  void syncAnalysisSchedules().catch(() => undefined)

  const startRecovery = async (): Promise<void> => {
    await input.jobRuntime.enqueueStartup('market-intelligence.recoverMarketAnalysisRuns').then(() => undefined).catch(() => undefined)
    // The staleness floor's 6-hour startup catch-up used to live here. The session slot tick owns
    // that job now: it runs on its own startup instance, and it decides what is owed from the opens
    // rather than from "the newest conclusion is old", which is what makes it able to catch up a
    // specific missed open instead of producing an unattributed refresh.
  }

  const consumerRegistration = resolveMarketAnalysisConsumerRegistration()
  if (input.eventBusRuntime && consumerRegistration) {
    input.eventBusRuntime.registerConsumer(
      {
        consumerId: MARKET_ANALYSIS_CONSUMER_ID,
        owner: 'product',
        productId: 'market-intelligence',
        topics: [...consumerRegistration.topics],
        retryPolicy: { maxAttempts: 3, backoff: 'exponential', baseDelayMs: 1_000, maxDelayMs: 30_000 }
      },
      async (event) => {
        const payload = event.payload as Record<string, unknown>
        const eventRef = typeof payload.itemId === 'string' ? payload.itemId : typeof payload.aggregateId === 'string' ? payload.aggregateId : undefined
        if (!eventRef) return
        await input.jobRuntime.enqueueDefinition({
          id: `market-analysis:group:${event.eventId}`,
          owner: 'product',
          productId: 'market-intelligence',
          handlerId: GROUP_MARKET_ANALYSIS_CHANGE_JOB,
          title: 'Group market analysis change',
          trigger: { kind: 'event', topic: event.topic },
          payload: { changeId: eventRef, eventRef },
          redact: value => ({ changeId: readString(value, 'changeId'), eventRef: readString(value, 'eventRef') })
        })
      }
    )
  }

  const requestInitialAnalysis = createInitialMarketAnalysisRequest({ repository, jobRuntime: input.jobRuntime, listItems: () => input.pipeline.listItems(), now, isEnabled: isEnabled,
      createGroup: itemId => {
        const change = resolveChange({ changeId: itemId })
        if (!change) throw new Error('analysis-not-eligible')
        const group = groups.create(change)
        repository.appendEventGroup(group)
        return group
      }
    })

  // 最后一跳的接收端：规则线把一条信号交给它，它建组、写账本行、入 freeze。额度在闸门里判，
  // 这里只保证入口认得 `signal.*`（事件线）并把尝试行的 id 带进载荷。
  const requestSignalAnalysis = createSignalAnalysisRequest({
    repository,
    jobRuntime: input.jobRuntime,
    now,
    idFactory: () => randomUUID(),
    isEnabled
  })
  // The tick is the only entry that asks for a signal analysis; the push paths were removed with it.
  const runSignalScan = createSignalScanRunner({
    now,
    querySignals: query => input.publicQueryService.queryModuleSignals(query),
    requestAnalysis: request => requestSignalAnalysis(request),
    log: async input => { await jobLog?.(input) }
  })

  return {
    repository,
    startRecovery,
    // 「发送到频道」：与自动推送同一个构造器、同一个提交入口，只换去重分量与收窄。
    sendConclusion: createAnalysisConclusionManualSend({
      repository,
      now,
      ...(input.submitNotification === undefined ? {} : { submit: input.submitNotification })
    }),
    getSettings: settingsService.getSettings,
    updateSettings: async (patch) => {
      const before = await settingsService.getSettings()
      const saved = await settingsService.updateSettings(patch)
      // Arming and storage stay one step: a stored "off" that left a schedule running would be a
      // lie the reader cannot see until the next automatic run.
      await syncAnalysisSchedules()
      // Turning it on also picks up whatever the previous session left queued, which is the one
      // moment that work exists and no schedule has run yet.
      if (!isMarketAnalysisEnabled(before) && isMarketAnalysisEnabled(saved)) await startRecovery()
      return saved
    },
    requestInitialAnalysis,
    requestSignalAnalysis,
    setRunSessionPort: runSession.setPort,
    setCrossAssetQuery(query) {
      crossAssetQuery = query
    },
    dispose() {
      if (disposed) return
      disposed = true
      input.eventBusRuntime?.unregisterConsumer(MARKET_ANALYSIS_CONSUMER_ID)
      crossAssetQuery = undefined
      repository.close()
    }
  }

  /**
   * Whether this indicator still has a chance: covered by an attempt that lives or succeeded,
   * abandoned because both attempts are spent, or uncovered (its own trigger decides).
   *
   * The scan and the decision live in `analysisReleaseAttempts`; the runtime only supplies the
   * sources, so this step stays one call and the runtime file stays on its baseline.
   */


  async function groupChange(payload: unknown): Promise<Record<string, unknown> | void> {
    const change = resolveChange(payload)
    if (!change) return
    const existing = repository.findEventGroupByMergeKey(eventGroupMergeKey(change))
    const result = groups.addChange(existing, change)
    if (result.previousGroupId) {
      const previous = repository.getEventGroup(result.previousGroupId)
      if (previous) repository.appendEventGroup({ ...previous, status: 'superseded', supersededByGroupId: result.group.id, revision: previous.revision + 1, updatedAt: now() })
    }
    repository.appendEventGroup(result.group)
    const previousLedger = repository.listTriggerLedger(result.group.id)
    const existingRuns = repository.listRuns().filter(run => run.eventGroupId === result.group.id)
    // Real counts, not the zeros this call used to pass: the policy declared hourly and daily
    // limits that could never fire because nobody supplied the numbers.
    const counts = countAnalysisRuns(repository, now())
    const decision = triggerPolicy.decide({
      eventGroupId: result.group.id,
      now: now(),
      change,
      confirmedDomains: [change.domain],
      recentTriggers: previousLedger.map(toTriggerHistory),
      reviewCount: result.group.reviewCount,
      hourTriggerCount: counts.hourRuns,
      dayTriggerCount: counts.dayRuns,
      runningCount: existingRuns.filter(run => run.status === 'running').length,
      hasInitialRun: existingRuns.some(run => run.analysisPhase === 'initial' && run.status !== 'cancelled'),
      lastTriggeredAt: previousLedger.at(-1)?.createdAt ?? null,
      lastTriggeredPhase: previousLedger.at(-1) ? toTriggerHistory(previousLedger.at(-1)!).phase : undefined
    })
    // One release, one analysis. The other indicators of a publication the trigger line already
    // allowed are not a second event: this one records "same release" and opens no run. Checked only
    // for an attempt that would otherwise be queued, because a skip recorded for another reason is
    // already explained and must not be relabelled.
    if (decision.decision === 'queued' && decision.phase) {
      const coverage = releaseCoverage(change, result.group.id)
      if (coverage.decision !== 'uncovered') {
        runs.recordDecision({
          eventGroupId: result.group.id, triggerKey: decision.triggerKey, changeHash: change.nextHash,
          decision: 'skipped',
          // Two codes, never one: merged-into-an-analysis and there-is-no-analysis are different
          // facts, and collapsing them would report five failed attempts as one successful merge.
          reasonCode: coverage.decision === 'covered'
            ? analysisReleaseCoalescingPolicy.reasonCode
            : analysisReleaseCoalescingPolicy.abandonedReasonCode
        })
        if (coverage.decision === 'abandoned') {
          await notifyAbandonedRelease({ triggerKey: decision.triggerKey, groupId: result.group.id, repository, occurredAt: now(), ...(input.submitNotification ? { submit: input.submitNotification } : {}) })
        }
        return
      }
    }
    const attemptLedgerId = runs.recordDecision({ eventGroupId: result.group.id, triggerKey: decision.triggerKey, changeHash: change.nextHash, decision: decision.decision, reasonCode: decision.reasonCode })
    if (decision.decision !== 'queued' || !decision.phase) return
    // The row id rides the freeze payload so a later refusal can rewrite this very attempt instead
    // of leaving it counted as a spent call.
    return { eventGroupId: result.group.id, shouldFreeze: true, triggerKey: decision.triggerKey, analysisPhase: decision.phase, asOf: now(), ...(attemptLedgerId ? { attemptLedgerId } : {}) }
  }

  async function freezeSnapshot(payload: unknown): Promise<Record<string, unknown> | void> {
    const value = payload as { eventGroupId: string; triggerKey: string; analysisPhase: 'initial' | 'review' | 'correction'; asOf: string; attemptLedgerId?: string }
    const previousSnapshot = repository.listSnapshots(value.eventGroupId).at(-1)
    // Decided before anything is built: a skipped evaluation must not leave a snapshot or a run.
    const gate = await significanceGate.evaluate({
      eventGroupId: value.eventGroupId, triggerKey: value.triggerKey, asOf: value.asOf, previousSnapshot,
      ...(value.attemptLedgerId ? { attemptLedgerId: value.attemptLedgerId } : {})
    })
    if (gate.decision === 'skipped') return { eventGroupId: value.eventGroupId }
    // 日历发布的通知**不在这里**：它跟着采集走（`macroEventLandedNotifier`）。挂在分析闸门上，
    // 读者就会在「日历已刷新、分析没跑/被跳过」时什么也收不到——一件事发生了，不该由另一个开关
    // 决定要不要说出来。
    const context = await buildMarketAnalysisContext({ eventGroupId: value.eventGroupId, asOf: value.asOf }, input.publicQueryService,
      { triggeredEventKeys: gate.triggeredEventKeys })
    if (context.state !== 'available') throw new Error(context.errorCode)
    const macro = context.domainAccess.find(domain => domain.domain === 'macro')
    console.log(formatMarketAnalysisContextDiagnostic({
      asOf: context.asOf,
      macroQueryState: macro?.queryState ?? 'missing',
      macroEventCount: context.facts.filter(fact => fact.domain === 'macro' && fact.metric === MARKET_ANALYSIS_MACRO_CALENDAR_FACT_METRICS.eventName).length,
      macroFactCount: context.facts.filter(fact => fact.domain === 'macro').length,
      macroEvidenceCount: context.evidenceRefs.filter(ref => ref.sourceId.startsWith('macro-calendar-')).length,
      macroCaveats: macro?.caveats ?? ['macro-domain-missing']
    }))
    const group = repository.getEventGroup(value.eventGroupId)
    if (!group) throw new Error('analysis-event-group-not-found')
    const enriched = await appendAnalysisEventEvidence(context, group, input.publicQueryService, () => input.pipeline.listRevisions())
    // Decided before the (up to twenty) per-item evidence reads: a refused first analysis must not
    // pay for the sentiment window it is not going to publish.
    const runHistory = repository.listRuns()
    if (value.analysisPhase === 'initial' && runHistory.some(run => run.eventGroupId === group.id && initialMarketAnalysisRequestPolicy.blockingStatuses.includes(run.status))) throw new Error('analysis-already-available')
    // 「重点舆情」从上次生成开始累计到本次：同一个窗口内的新闻只进入一次结论，中性条目被过滤。
    // 上次生成的时间取最近一次已发布运行的开始时刻；没有就退回本组上一份快照的时点。
    // 模块再把窗口压到「理论上的上一档盘口」——分析最大跨度 8 小时，关播三天也不会倒灌三天新闻。
    const sentimentSince = newsSentimentSince(runHistory, previousSnapshot?.asOf)
    const withSentiment = await appendAnalysisNewsSentiment(enriched, input.publicQueryService, input.newsSentimentQuery, {
      timeZone: timeZone(),
      asOf: value.asOf,
      ...(sentimentSince ? { since: sentimentSince } : {})
    }, () => input.pipeline.listRevisions())
    const snapshot = snapshots.freeze({
      eventGroupId: value.eventGroupId,
      context: withSentiment,
      // The predecessor fixes the frozen "what changed" record for this snapshot.
      ...(previousSnapshot ? { previous: previousSnapshot } : {})
    })
    repository.appendSnapshot(snapshot)
    // The run remembers the model it was queued for. Reading the setting here (not inside the
    // orchestrator) keeps "what was chosen" and "what was called" the same fact.
    const settings = await settingsService.getSettings()
    const model = isMarketAnalysisModelSet(settings) ? { providerId: settings.providerId, modelId: settings.modelId } : null
    const result = runs.enqueue({
      eventGroupId: value.eventGroupId, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash,
      analysisPhase: value.analysisPhase, triggerKey: value.triggerKey, model,
      // Decided here, with the snapshot in hand: no change record / cut facts / degraded subject are
      // all knowable now, so nothing needs a later write-back.
      validationMode: resolveTriggerFocus(snapshot).mode
    })
    // The attempt row was written before this run existed; now that it does, fill it in. The sweep
    // that decides whether a queued row is still waiting or was never claimed reads this column, so
    // leaving it null would make a row that does have a run look abandoned.
    if (value.attemptLedgerId) {
      repository.linkTriggerLedgerRun({ id: value.attemptLedgerId, analysisRunId: result.run.id, snapshotHash: snapshot.snapshotHash })
    }
    return {
      eventGroupId: value.eventGroupId, analysisRunId: result.run.id,
      // Carried to the run job so the prompt can say what triggered this analysis.
      ...(gate.signals.length > 0 ? { significanceSignals: JSON.stringify(gate.signals) } : {})
    }
  }

  async function runAnalysis(payload: unknown, context: JobContext): Promise<void> {
    const analysisRunId = readString(payload, 'analysisRunId')
    const run = analysisRunId ? repository.getRun(analysisRunId) : undefined
    if (!run) return
    // The switch may have been turned off while this run sat in the queue. Ending it as cancelled
    // says what happened; calling the model anyway would spend the request the switch was there to
    // prevent.
    if (!await isEnabled()) {
      repository.updateRunStatus({ id: run.id, status: 'cancelled', completedAt: now(), failureCode: MARKET_ANALYSIS_ERROR_CODES.cancelled, failureDetailCode: MARKET_ANALYSIS_ERROR_CODES.notEnabled })
      await context.log({ level: 'info', message: 'Market analysis skipped: disabled', metadata: { analysisRunId: run.id } })
      return
    }
    const carried = readSignificanceSignals(payload)
    const result = await analysisOrchestrator.run({ analysisRunId: run.id, signal: context.signal, ...(carried.length > 0 ? { significanceSignals: carried } : {}) })
    await context.log({ level: result.status === 'succeeded' ? 'info' : 'error', message: 'Market analysis result', metadata: { analysisRunId: run.id, status: result.status, ...(result.errorCode ? { errorCode: result.errorCode } : {}) } })
  }

  function resolveChange(payload: unknown): AnalysisChange | undefined {
    const itemId = readString(payload, 'changeId') ?? readString(payload, 'eventRef')
    const item = itemId ? input.pipeline.listItems().find(candidate => candidate.itemId === itemId || candidate.clusterId === itemId) : undefined
    if (!item) return
    const labels = safeJson(item.processingLabelsJson)
    const previousRevision = input.pipeline.listRevisions()
      .filter(revision => revision.itemId === item.itemId)
      .sort((left, right) => left.detectedAt.localeCompare(right.detectedAt))
      .at(-2)
    const domain = resolveDomain(labels.dataDomain, item.sourceId)
    const severity = resolveMarketAnalysisSeverity(item)
    return {
      changeId: item.itemId,
      domain,
      eventRef: item.itemId,
      subject: item.title,
      severity,
      changedFields: ['item'],
      previousHash: previousRevision ? hashMarketAnalysisJson({ itemId: item.itemId, title: previousRevision.title ?? null, summary: previousRevision.summary ?? null, publishedAt: previousRevision.publishedAt ?? null }) : null,
      nextHash: hashMarketAnalysisJson({ itemId: item.itemId, title: item.title, summary: item.summary ?? null, publishedAt: item.publishedAt ?? null }),
      observedAt: item.detectedAt,
      publishedAt: item.publishedAt ?? null,
      confirmed: item.sourceTrust === 'high' && Boolean(item.publishedAt),
      sourceCount: 1,
      marketMove15mPct: null,
      fundingDeltaPctPoints: null,
      sourceKind: item.sourceTrust === 'high' ? 'official' : 'proxy',
      comparability: 'comparable',
      groupType: domain === 'macro' ? 'macro' : domain === 'capital' ? 'capital' : domain === 'funding' ? 'funding' : domain === 'cross-asset' ? 'cross-asset' : 'sentiment'
    }
  }
}

/**
 * Maps a ledger row to the history `analysisTriggerPolicy` reasons about.
 *
 * Only the keys this plan introduces map to `correction`: they must not feed the item path's
 * phase cooldown or move its review-window start. Every pre-existing key keeps today's mapping
 * exactly, including `manual.*` — those rows genuinely reach the ledger (recovery records
 * them), and re-phasing them would silently let item triggers fire earlier.
 */
export function toTriggerHistory(value: { triggerKey: string; createdAt: string }): TriggerHistoryEntry {
  if (isGateEligible(value.triggerKey)) return { phase: phaseForNewTriggerKey(value.triggerKey), triggeredAt: value.createdAt }
  return { phase: value.triggerKey === 'market-reaction.15m' ? 'review' : 'initial', triggeredAt: value.createdAt }
}
