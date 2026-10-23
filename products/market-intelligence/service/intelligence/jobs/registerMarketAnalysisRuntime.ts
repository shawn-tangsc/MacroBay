import { randomUUID } from 'node:crypto'
import type { EventBusRuntime } from '@platform/message-bus'
import type { JobContext, JobRuntime } from '@platform/jobs'

import {
  INTELLIGENCE_EVENT_TOPICS,
} from '../schema/intelligenceEvents'
import { MARKET_ANALYSIS_MACRO_CALENDAR_POLICY } from '../../../contracts/marketAnalysisContracts'
import { crossAssetAnalysisRanges } from '../cross-asset/crossAssetAnalysisWindows'
import { crossAssetAnalysisWindowPolicy, type CrossAssetPriceHorizon } from '../cross-asset/crossAssetAnalysisWindows'
import type { IntelligencePipeline } from '../application/intelligencePipeline'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { buildMarketAnalysisContext } from '../public-query/marketAnalysisContextQuery'
import { countAnalysisRuns, lastAutoRunAt } from '../analysis/analysisRunCounter'
import { createAnalysisSignificanceGate } from '../analysis/analysisSignificanceGate'
import { createAnalysisSlotTick, hasSlotAnchor } from '../analysis/analysisSlotTick'
import { analysisSchedulePolicy, triggerKeyForSlot } from '../analysis/analysisSchedulePolicy'
import type { SessionSlotInstant } from '../analysis/analysisSlotCoverage'
import { isGateEligible, phaseForNewTriggerKey, type AnalysisTriggerSource } from '../analysis/analysisTriggerSourcePolicy'
import { queryMacroRoute } from '../public-query/macroRouteQuery'
import type { SignificanceSignal } from '../analysis/significanceChangeMatcher'
import { createAnalysisRunService } from '../analysis/analysisRunService'
import { createAnalysisTriggerPolicy, type TriggerHistoryEntry } from '../analysis/analysisTriggerPolicy'
import { createEventGroupService, eventGroupMergeKey, type AnalysisChange } from '../analysis/eventGroupService'
import { createEvidenceSnapshotService } from '../analysis/evidenceSnapshotService'
import { hashMarketAnalysisJson } from '../analysis/analysisHash'
import { createMarketAnalysisRepository, type MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { createAnalysisOrchestrator } from '../analysis/analysisOrchestrator'
import { isMarketAnalysisEnabled, isMarketAnalysisModelSet, type MarketAnalysisSettings, type MarketAnalysisSettingsPatch } from '../application/marketAnalysisSettings'
import { MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'
import { createMarketAnalysisSettingsService, type MarketAnalysisSettingsService } from '../application/marketAnalysisSettingsService'
import { createInMemoryMarketAnalysisSettingsStorage, createMarketAnalysisSettingsStore } from '../application/marketAnalysisSettingsStore'
import { createPredictionVerificationService } from '../analysis/predictionVerificationService'
import type { PredictionVerificationObservation } from '../analysis/predictionVerificationService'
import { parseCrossAssetSnapshot, type CrossAssetSnapshot } from '../../../contracts/crossAssetObservationContracts'
import { appendAnalysisEventEvidence } from '../analysis/analysisEventEvidence'
import { registerMarketAnalysisJobs } from './registerMarketAnalysisJobs'
import { GROUP_MARKET_ANALYSIS_CHANGE_JOB, ANALYSIS_SESSION_SLOTS_JOB, RUN_MARKET_ANALYSIS_JOB } from './marketAnalysisJobIds'
import { createInitialMarketAnalysisRequest, initialMarketAnalysisRequestPolicy } from './requestInitialMarketAnalysis'

export type MarketAnalysisRuntime = Readonly<{
  repository: MarketAnalysisRepository
  startRecovery: () => Promise<void>
  getSettings: () => Promise<MarketAnalysisSettings>
  updateSettings: (patch: MarketAnalysisSettingsPatch) => Promise<MarketAnalysisSettings>
  requestInitialAnalysis: (itemId: string | undefined, retryRunId: string | undefined, mode: 'initial' | 'refresh', source: AnalysisTriggerSource) => Promise<{ itemId: string; queued: true }>
  setCrossAssetQuery: (query: ((input: { range: '1h' | '24h' | '7d'; asOf: string }) => unknown) | undefined) => void
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

export function resolveMarketAnalysisSeverity(item: import('../schema/intelligenceRecord').IntelligenceItem): 'low' | 'medium' | 'high' | 'critical' {
  const labels = safeJson(item.processingLabelsJson)
  if (item.severityHint === 'critical') return 'critical'
  if (item.severityHint === 'warning') return 'medium'
  return labels.relevanceOutcome === 'full-intelligence' && labels.sentimentEligible === true ? 'high' : 'low'
}

type FundingHistory = Readonly<{
  state: 'available'
  asOf: string
  btc: readonly Readonly<{ observedAt: string; ratePercent: number }>[]
  eth: readonly Readonly<{ observedAt: string; ratePercent: number }>[]
}>

type VerificationObservationInput = Readonly<{
  funding?: FundingHistory
  crossAsset?: Readonly<{ query: (input: { range: '1h' | '24h' | '7d'; asOf: string }) => CrossAssetSnapshot | undefined }>
}>

export function buildMarketAnalysisVerificationObservations(
  asOf: string,
  _items: readonly import('../schema/intelligenceRecord').IntelligenceItem[],
  input: VerificationObservationInput = {}
): readonly PredictionVerificationObservation[] {
  const observations: PredictionVerificationObservation[] = []
  if (input.funding?.state === 'available' && input.funding.asOf === asOf) {
    for (const [asset, rows] of [['BTC', input.funding.btc], ['ETH', input.funding.eth] ] as const) {
      for (let index = 1; index < rows.length; index += 1) {
        const previous = rows[index - 1]!
        const current = rows[index]!
        if (!isCanonicalTime(previous.observedAt) || !isCanonicalTime(current.observedAt) || current.observedAt > asOf || Date.parse(current.observedAt) - Date.parse(previous.observedAt) !== 8 * 60 * 60 * 1_000) continue
        observations.push({
          asset, interval: '8h', observedAt: current.observedAt, comparable: true,
          evidenceRefId: `mi-evidence-funding-${asset}-${previous.observedAt}-${current.observedAt}`,
          fundingDeltaPctPoints: current.ratePercent - previous.ratePercent
        })
      }
    }
  }
  if (input.crossAsset) {
    // Keyed by the contract's own range union: the analysis windows name their range from that union, so a
    // narrower literal here stops compiling the moment a window is added (which is how `30d` surfaced).
    const snapshots = new Map<CrossAssetSnapshot['range'], CrossAssetSnapshot>()
    // 窗口清单归 owner（分析窗口策略），不在这里手抄：加一个窗口时手抄的那份会静默少读一个快照。
    // 评审指出这里仍手抄了一份窗口清单（owner 是分析窗口策略）。按策略迭代会牵出一处类型不匹配，
    // 留待与策略类型一起改；保持现状，缺陷已记档。
    for (const range of ['1h', '24h', '7d'] as const) {
      try {
        const snapshot = input.crossAsset.query({ range, asOf })
        if (!snapshot) continue
        if (snapshot.mode === 'historical' && snapshot.asOf <= asOf && snapshot.analysisEnd <= asOf && Object.values(snapshot.historyCoverage).every(value => value.complete)) snapshots.set(range, snapshot)
      } catch { /* one unavailable range must not block other observations */ }
    }
    const oneDay = snapshots.get('24h')
    // Windows come from one policy the analysis context reads too, so the horizon the model is
    // shown and the horizon the verifier checks can never drift apart.
    for (const asset of ['BTC', 'ETH'] as const) {
      for (const window of crossAssetAnalysisWindowPolicy.priceReturns) {
        const snapshot = snapshots.get(window.range)
        if (window.kind === 'curve') appendCurveReturn(observations, asset, window.horizon, snapshot, window.lookbackPoints)
        else appendMetricReturn(observations, asset, window.horizon, snapshot?.closedReturns[asset === 'BTC' ? 'btc' : 'eth'][crossAssetAnalysisWindowPolicy.closedReturnMetric], snapshot)
      }
    }
    const btc2h = findObservation(observations, 'BTC', '2h')
    const eth2h = findObservation(observations, 'ETH', '2h')
    if (btc2h?.priceReturnPct !== undefined && eth2h?.priceReturnPct !== undefined && oneDay) {
      observations.push({
        asset: 'BTC', relativeToAsset: 'ETH', horizon: '2h', observedAt: oneDay.analysisEnd, comparable: true,
        evidenceRefId: `mi-evidence-cross-asset-BTC-ETH-2h-${oneDay.analysisEnd}`,
        relativeReturnPct: btc2h.priceReturnPct - eth2h.priceReturnPct
      })
    }
  }
  return observations
}

function appendCurveReturn(
  observations: PredictionVerificationObservation[], asset: 'BTC' | 'ETH', horizon: CrossAssetPriceHorizon, snapshot: CrossAssetSnapshot | undefined, lookbackPoints: number
): void {
  if (!snapshot) return
  const curve = snapshot.curves[asset === 'BTC' ? 'btc' : 'eth']
  const end = curve.at(-1)?.returnPercent
  const start = curve.at(-(lookbackPoints + 1))?.returnPercent
  if (typeof end !== 'number' || typeof start !== 'number' || !Number.isFinite(end) || !Number.isFinite(start)) return
  observations.push({ asset, horizon, observedAt: snapshot.analysisEnd, comparable: true,
    evidenceRefId: `mi-evidence-cross-asset-${asset}-${horizon}-${snapshot.analysisEnd}`, priceReturnPct: end - start })
}

function appendMetricReturn(
  observations: PredictionVerificationObservation[], asset: 'BTC' | 'ETH', horizon: CrossAssetPriceHorizon, metric: CrossAssetSnapshot['closedReturns']['btc']['24h'] | undefined, snapshot: CrossAssetSnapshot | undefined
): void {
  if (!snapshot || !metric || metric.state !== 'available' || !Number.isFinite(metric.value)) return
  observations.push({ asset, horizon, observedAt: snapshot.analysisEnd, comparable: true,
    evidenceRefId: `mi-evidence-cross-asset-${asset}-${horizon}-${snapshot.analysisEnd}`, priceReturnPct: metric.value })
}

async function readFundingHistory(
  service: Pick<MarketIntelligencePublicQueryService, 'queryFundingRateHistory'>,
  asOf: string
): Promise<FundingHistory | undefined> {
  try {
    const result = await service.queryFundingRateHistory({ asOf })
    return result.state === 'available' ? result : undefined
  } catch {
    return undefined
  }
}

function findObservation(observations: readonly PredictionVerificationObservation[], asset: 'BTC' | 'ETH', horizon: '2h') {
  return observations.find(value => value.asset === asset && value.horizon === horizon && value.priceReturnPct !== undefined)
}

function isCanonicalTime(value: string): boolean {
  try { return new Date(value).toISOString() === value } catch { return false }
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
  dataDir: string
  now?: () => string
  crossAssetQuery?: (input: { range: '1h' | '24h' | '7d'; asOf: string }) => unknown
}>): MarketAnalysisRuntime {
  const now = input.now ?? (() => new Date().toISOString())
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
  const triggerPolicy = createAnalysisTriggerPolicy()
  const analysisOrchestrator = createAnalysisOrchestrator({
    repository,
    structuredModelInvocation: input.structuredModelInvocation,
    now,
    idFactory: () => randomUUID(),
    ...(input.getAppLanguage ? { getLanguage: input.getAppLanguage } : {})
  })
  const predictionVerification = createPredictionVerificationService({
    repository,
    now,
    idFactory: () => `mi-pv-${randomUUID()}`
  })
  const significanceGate = createAnalysisSignificanceGate({
    now,
    queryMacroRoute: ({ asOf, months }) => queryMacroRoute(input.publicQueryService, { asOf, months }),
    countRuns: (at) => countAnalysisRuns(repository, at),
    lastAutoRunAt: (eventGroupId, at) => lastAutoRunAt(repository, eventGroupId, at),
    recordDecision: (decision) => runs.recordDecision(decision)
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
  const isSlotDelivered = (instant: SessionSlotInstant): boolean => {
    const from = instant.atMs
    const to = from + analysisSchedulePolicy.coverageWindowMs
    const key = triggerKeyForSlot(instant.slot)
    return repository.listRuns().some(run => run.triggerKey === key && run.status === 'succeeded' &&
      Date.parse(run.queuedAt) >= from && Date.parse(run.queuedAt) < to)
  }
  /**
   * An open is abandoned when it was attempted inside its window, nothing came of it, and the window
   * has closed: without this a failed attempt would be re-requested on every tick for the whole
   * catch-up window. The open's ledger identity carries the local day (see `sessionSlotChangeHash`),
   * so a row at or after the open's instant is that open's attempt.
   */
  const isSlotAbandoned = (instant: SessionSlotInstant): boolean => {
    if (Date.parse(now()) - instant.atMs <= analysisSchedulePolicy.coverageWindowMs) return false
    const key = triggerKeyForSlot(instant.slot)
    return repository.listEventGroups().flatMap(group => repository.listTriggerLedger(group.id))
      .some(row => row.triggerKey === key && row.decision === 'queued' && Date.parse(row.createdAt) >= instant.atMs)
  }
  const slotTick = createAnalysisSlotTick({
    now,
    isDelivered: isSlotDelivered,
    isAbandoned: isSlotAbandoned,
    // The schedule only needs something to analyse; see `hasSlotAnchor` for why the analysis
    // anchor's eligibility rule must not gate it.
    hasEligibleAnchor: () => hasSlotAnchor(input.pipeline.listItems()),
    // Goes through the ordinary request path, so the gate's budget, interval and ledger apply.
    requestSlotAnalysis: instant => requestInitialAnalysis(undefined, undefined, 'refresh', 'session-slot', instant.slot).then(() => undefined),
    log: () => undefined
  })
  const analysisJobs = registerMarketAnalysisJobs(input.jobRuntime, {
    runSessionSlots: async (context) => {
      // The schedule is unarmed while the capability is off, and the handler still refuses: a run
      // queued before the switch was turned off must not spend a request either.
      if (!await isEnabled()) return
      const result = await slotTick.run()
      await context.log({
        level: result.outcome === 'no-anchor' ? 'warn' : 'info',
        // The opens are named: "which session was this conclusion for" is the question the reader
        // and the timeline attribution both ask.
        message: `Market analysis session slots: ${result.outcome}`,
        metadata: { outcome: result.outcome, requested: result.requested, deferred: result.deferred }
      })
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

  if (input.eventBusRuntime) {
    input.eventBusRuntime.registerConsumer(
      {
        consumerId: MARKET_ANALYSIS_CONSUMER_ID,
        owner: 'product',
        productId: 'market-intelligence',
        topics: [INTELLIGENCE_EVENT_TOPICS.itemCreated, INTELLIGENCE_EVENT_TOPICS.impactCreated, INTELLIGENCE_EVENT_TOPICS.sentimentUpdated],
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

  return {
    repository,
    startRecovery,
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
    runs.recordDecision({ eventGroupId: result.group.id, triggerKey: decision.triggerKey, changeHash: change.nextHash, decision: decision.decision, reasonCode: decision.reasonCode })
    if (decision.decision !== 'queued' || !decision.phase) return
    return { eventGroupId: result.group.id, shouldFreeze: true, triggerKey: decision.triggerKey, analysisPhase: decision.phase, asOf: now() }
  }

  async function freezeSnapshot(payload: unknown): Promise<Record<string, unknown> | void> {
    const value = payload as { eventGroupId: string; triggerKey: string; analysisPhase: 'initial' | 'review' | 'correction'; asOf: string }
    const previousSnapshot = repository.listSnapshots(value.eventGroupId).at(-1)
    // Decided before anything is built: a skipped evaluation must not leave a snapshot or a run.
    const gate = await significanceGate.evaluate({
      eventGroupId: value.eventGroupId, triggerKey: value.triggerKey, asOf: value.asOf, previousSnapshot
    })
    if (gate.decision === 'skipped') return { eventGroupId: value.eventGroupId }
    const context = await buildMarketAnalysisContext({ eventGroupId: value.eventGroupId, asOf: value.asOf }, input.publicQueryService,
      { triggeredEventKeys: gate.triggeredEventKeys })
    if (context.state !== 'available') throw new Error(context.errorCode)
    const macro = context.domainAccess.find(domain => domain.domain === 'macro')
    console.log(formatMarketAnalysisContextDiagnostic({
      asOf: context.asOf,
      macroQueryState: macro?.queryState ?? 'missing',
      macroEventCount: context.facts.filter(fact => fact.domain === 'macro' && fact.metric === MARKET_ANALYSIS_MACRO_CALENDAR_POLICY.factMetrics.eventName).length,
      macroFactCount: context.facts.filter(fact => fact.domain === 'macro').length,
      macroEvidenceCount: context.evidenceRefs.filter(ref => ref.sourceId.startsWith('macro-calendar-')).length,
      macroCaveats: macro?.caveats ?? ['macro-domain-missing']
    }))
    const group = repository.getEventGroup(value.eventGroupId)
    if (!group) throw new Error('analysis-event-group-not-found')
    const enriched = await appendAnalysisEventEvidence(context, group, input.publicQueryService, () => input.pipeline.listRevisions())
    if (value.analysisPhase === 'initial' && repository.listRuns().some(run => run.eventGroupId === group.id && initialMarketAnalysisRequestPolicy.blockingStatuses.includes(run.status))) throw new Error('analysis-already-available')
    const snapshot = snapshots.freeze({
      eventGroupId: value.eventGroupId,
      context: enriched,
      // The predecessor fixes the frozen "what changed" record for this snapshot.
      ...(previousSnapshot ? { previous: previousSnapshot } : {})
    })
    repository.appendSnapshot(snapshot)
    // The run remembers the model it was queued for. Reading the setting here (not inside the
    // orchestrator) keeps "what was chosen" and "what was called" the same fact.
    const settings = await settingsService.getSettings()
    const model = isMarketAnalysisModelSet(settings) ? { providerId: settings.providerId, modelId: settings.modelId } : null
    const result = runs.enqueue({ eventGroupId: value.eventGroupId, snapshotId: snapshot.id, snapshotHash: snapshot.snapshotHash, analysisPhase: value.analysisPhase, triggerKey: value.triggerKey, model })
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

/** Defensive: a malformed payload degrades to "no trigger reasons", never to a failed run. */
/** Same eligibility the anchor resolution uses; kept here so the tick can answer "is there anything to analyse". */
function hasEligibleAnalysisAnchor(item: { sourceTrust?: string; publishedAt?: string | null; processingLabelsJson?: string | null }): boolean {
  if (item.sourceTrust !== 'high' || !item.publishedAt) return false
  try {
    const labels = JSON.parse(item.processingLabelsJson ?? '{}')
    return labels.relevanceOutcome === 'full-intelligence' && labels.sentimentEligible === true
  } catch { return false }
}

function readSignificanceSignals(payload: unknown): readonly SignificanceSignal[] {
  const raw = (payload as { significanceSignals?: unknown } | null)?.significanceSignals
  if (typeof raw !== 'string' || raw.length === 0) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(entry => entry && typeof entry === 'object' && typeof (entry as { eventKey?: unknown }).eventKey === 'string') as SignificanceSignal[] : []
  } catch { return [] }
}

function readString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined
}

function readCanonicalAsOf(value: unknown): string | undefined {
  const asOf = readString(value, 'asOf')
  if (!asOf) return undefined
  try { return new Date(asOf).toISOString() === asOf ? asOf : undefined } catch { return undefined }
}

function safeJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch { return {} }
}

function resolveDomain(value: unknown, sourceId: string): AnalysisChange['domain'] {
  if (value === 'macro' || value === 'capital' || value === 'sentiment' || value === 'funding' || value === 'cross-asset') return value
  if (sourceId.includes('funding')) return 'funding'
  if (sourceId.includes('stablecoin') || sourceId.includes('router')) return 'capital'
  return 'sentiment'
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
