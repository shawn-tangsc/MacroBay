import type { AnalysisRun, AnalysisPhase, EventGroup, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import type { AnalysisKind } from '../../../contracts/analysisKinds'
import { buildAnalysisIdempotencyKey } from './analysisHash'
import { lineFor } from './analysisLineRegistry'
import { ANALYSIS_RUN_INTERRUPTED, isStalledAnalysisRun } from './analysisRunStaleness'

export const analysisRunPolicy = Object.freeze({
  version: 'cryptoMarketAnalysisTriggerPolicy.v1',
  triggerLedgerIdPrefix: 'mi-ledger-',
  restartInitialWindowMs: 30 * 60 * 1_000
})

type Repository = {
  enqueueRun: (run: AnalysisRun) => { created: boolean; run: AnalysisRun }
  updateRunStatus: (input: { id: string; status: AnalysisRun['status']; completedAt?: string; failureCode?: string; failureDetailCode?: string }) => boolean
  listRuns?: () => readonly AnalysisRun[]
  listEventGroups?: () => readonly EventGroup[]
  listSnapshots?: (eventGroupId: string) => readonly EvidenceSnapshot[]
  appendTriggerLedger?: (value: { id: string; eventGroupId: string; triggerKey: string; changeHash: string; decision: string; reasonCode: string; snapshotHash: string | null; analysisRunId: string | null; createdAt: string }) => string
}
/** A recovered run that still needs its `runMarketAnalysis` job before it can ever finish. */
export type AnalysisRunDispatch = Readonly<{ analysisRunId: string; eventGroupId: string }>

/**
 * What a restart pass did, split by what the caller must do next.
 *
 * `dispatch` exists because writing the run row is not the same as running it: the freeze
 * path hands its new run to the job runtime from the freeze handler, and the recovery
 * compensation used to write rows nothing ever claimed. They sat `queued` forever, which
 * also blocked every later manual request for that group.
 */
export type AnalysisRunRecovery = Readonly<{
  /** Runs that were `running` when the process stopped; they can never finish. */
  failed: readonly string[]
  /** Runs whose snapshot is no longer the active one, or is too old to publish. */
  stale: readonly string[]
  /** Runs that need a `runMarketAnalysis` job created for them. */
  dispatch: readonly AnalysisRunDispatch[]
}>

/** The model the run was queued for. Kept on the run so a reader can tell what answered it. */
export type AnalysisRunModelRef = Readonly<{ providerId: string; modelId: string }>

export type AnalysisRunEnqueueInput = Readonly<{
  /** 这条运行属于哪条解析线。由调用方指定——`news` 只从按条解读入口进来。 */
  analysisKind: AnalysisKind
  eventGroupId: string
  snapshotId: string
  snapshotHash: string
  analysisPhase: AnalysisPhase
  triggerKey: string
  /** Absent for a run queued before the model could be known; the invocation then follows the platform default. */
  model?: AnalysisRunModelRef | null
  /** Which criterion the trigger-focus rule will use; decided at freeze, stored so passes can be grouped. */
  validationMode?: AnalysisRun['validationMode']
}>

export type AnalysisRunService = Readonly<{
  enqueue: (input: AnalysisRunEnqueueInput) => { created: boolean; run: AnalysisRun }
  /**
   * 重启对账。`model` 是启动时读者选的模型：恢复补排的运行带着它入队，调用层就不用退回
   * 平台第一个可用供应商（冷启动失败就是从这条路径来的）。
   */
  recover: (input?: Readonly<{ model?: AnalysisRunModelRef | null }>) => AnalysisRunRecovery
  /**
   * 把卡住的运行判成失败（`analysis-run-interrupted` / `run-stalled`）。
   *
   * 重启对账只在进程启动时跑一次；进程活着但调用、作业或计时器没了的那类，需要在运行中
   * 周期性地收尸，否则它会一直占着「这条新闻正在解读」。返回被判失败的运行 id。
   */
  sweepStalled: () => readonly string[]
  recordDecision: (input: Readonly<{ eventGroupId: string; triggerKey: string; changeHash: string; decision: 'queued' | 'skipped'; reasonCode: string; snapshotHash?: string | null; analysisRunId?: string | null }>) => string | undefined
}>

export function createAnalysisRunService(deps: Readonly<{ repository: Repository; now: () => string; idFactory: () => string }>): AnalysisRunService {
  const enqueue = (input: AnalysisRunEnqueueInput) => {
    const queuedAt = deps.now()
    // 提示词/技能/输出契约的版本是线的事实：运行行必须写「哪条线的第几版」，不能写全局常量。
    const line = lineFor(input.analysisKind)
    const run: AnalysisRun = {
      id: deps.idFactory(), schemaVersion: 1, analysisKind: input.analysisKind, eventGroupId: input.eventGroupId, snapshotId: input.snapshotId,
      snapshotHash: input.snapshotHash, analysisPhase: input.analysisPhase, triggerKey: input.triggerKey,
      idempotencyKey: buildAnalysisIdempotencyKey(input), status: 'queued', attempt: 1, retryOfRunId: null,
      modelProviderId: input.model?.providerId ?? null, modelId: input.model?.modelId ?? null, policyVersion: analysisRunPolicy.version,
      promptVersion: line.promptVersion, skillVersion: line.skillVersion, outputSchemaVersion: line.outputSchemaVersion,
      jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null, validationMode: input.validationMode ?? null, queuedAt, startedAt: null, completedAt: null
    }
    return deps.repository.enqueueRun(run)
  }
  /**
   * 重启对账。`model` 是「这次启动时读者选的模型」：恢复补排的运行也要带着它，
   * 否则调用时会退回平台第一个可用供应商——冷启动失败的根因。
   */
  const recover = (input: Readonly<{ model?: AnalysisRunModelRef | null }> = {}): AnalysisRunRecovery => {
    const model = input.model ?? null
    const failed: string[] = []
    const stale: string[] = []
    const dispatch: AnalysisRunDispatch[] = []
    const runs = deps.repository.listRuns?.() ?? []
    for (const run of runs) {
      if (run.status !== 'running') continue
      // 重启之后不可能还有代码在跑这次运行：判成「被打断」，不是模型失败。
      if (deps.repository.updateRunStatus({ id: run.id, status: 'failed', failureCode: ANALYSIS_RUN_INTERRUPTED, failureDetailCode: 'runtime-stopped', completedAt: deps.now() })) failed.push(run.id)
    }
    const groups = deps.repository.listEventGroups?.() ?? []
    for (const group of groups) {
      const snapshots = [...(deps.repository.listSnapshots?.(group.id) ?? [])]
      const latest = snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)).at(0)
      if (!latest) continue
      const groupRuns = runs.filter(run => run.eventGroupId === group.id)
      // R39：新闻解读没有自动触发。快照带触发指针的组里，旧的 **市场** 运行（升级前由自动
      // 新闻触发排下的）不许再被恢复去跑——重放出来的只会是一次读不到那条新闻的市场分析。
      // 新闻线的运行（`analysisKind: 'news'`）不受影响，手动解读的历史行照常恢复。
      const newsTriggeredGroup = Boolean(latest.trigger)
      const retiredNewsRuns = new Set<string>()
      for (const run of groupRuns) {
        if (run.status !== 'queued' && run.status !== 'running') continue
        if (newsTriggeredGroup && run.analysisKind !== 'news') {
          if (deps.repository.updateRunStatus({ id: run.id, status: 'stale', failureCode: 'news-trigger-retired', failureDetailCode: 'news-trigger-retired', completedAt: deps.now() })) {
            recordDecision({ eventGroupId: group.id, triggerKey: run.triggerKey, changeHash: run.snapshotHash, decision: 'skipped', reasonCode: 'news-trigger-retired', snapshotHash: latest.snapshotHash, analysisRunId: run.id })
            stale.push(run.id)
            retiredNewsRuns.add(run.id)
          }
          continue
        }
        if (run.snapshotId !== latest.id || run.snapshotHash !== latest.snapshotHash) {
          deps.repository.updateRunStatus({ id: run.id, status: 'stale', failureCode: 'restart-expired', failureDetailCode: 'restart-expired', completedAt: deps.now() })
          recordDecision({ eventGroupId: group.id, triggerKey: run.triggerKey, changeHash: run.snapshotHash, decision: 'skipped', reasonCode: 'restart-expired', snapshotHash: latest.snapshotHash, analysisRunId: run.id })
          stale.push(run.id)
        }
      }
      const activeRuns = groupRuns.filter(run => !retiredNewsRuns.has(run.id) && (run.status === 'queued' || run.status === 'running') && run.snapshotId === latest.id && run.snapshotHash === latest.snapshotHash)
      const hasSuccessfulInitial = groupRuns.some(run => run.analysisPhase === 'initial' && run.status === 'succeeded')
      const initialPending = activeRuns.some(run => run.analysisPhase === 'initial')
      const initialAge = Date.parse(deps.now()) - Date.parse(latest.createdAt)
      const withinRestartWindow = Number.isFinite(initialAge) && initialAge <= analysisRunPolicy.restartInitialWindowMs
      // A run pointing at the active snapshot must be either claimed by a job or expired.
      // Nothing else can move it: `runAnalysis` only writes terminal statuses after
      // `claimRun`, so a `queued` row means no job ever picked it up. Re-dispatching inside
      // the restart window is what makes the compensation real; outside it the evidence is
      // too old to publish as the current conclusion, so the row is expired instead of
      // blocking the group's manual requests forever.
      for (const run of activeRuns) {
        if (withinRestartWindow) {
          dispatch.push({ analysisRunId: run.id, eventGroupId: group.id })
          continue
        }
        if (!deps.repository.updateRunStatus({ id: run.id, status: 'stale', failureCode: 'restart-expired', failureDetailCode: 'restart-expired', completedAt: deps.now() })) continue
        recordDecision({ eventGroupId: group.id, triggerKey: run.triggerKey, changeHash: run.snapshotHash, decision: 'skipped', reasonCode: 'restart-expired', snapshotHash: latest.snapshotHash, analysisRunId: run.id })
        stale.push(run.id)
      }
      // 新闻组不补市场运行：它的组只为按条解读存在（R39）。
      if (!newsTriggeredGroup && !hasSuccessfulInitial && !initialPending && withinRestartWindow) {
        const result = enqueue({ analysisKind: 'market', eventGroupId: group.id, snapshotId: latest.id, snapshotHash: latest.snapshotHash, analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed', model })
        if (result.created) {
          recordDecision({ eventGroupId: group.id, triggerKey: result.run.triggerKey, changeHash: latest.snapshotHash, decision: 'queued', reasonCode: 'restart-initial-compensated', snapshotHash: latest.snapshotHash, analysisRunId: result.run.id })
          dispatch.push({ analysisRunId: result.run.id, eventGroupId: group.id })
        }
      }
      const reviewPending = activeRuns.some(run => run.analysisPhase === 'review')
      if (!newsTriggeredGroup && group.reviewCount < 2 && !reviewPending && Number.isFinite(Date.parse(group.reviewDeadlineAt)) && Date.parse(deps.now()) <= Date.parse(group.reviewDeadlineAt) && hasSuccessfulInitial) {
        const result = enqueue({ analysisKind: 'market', eventGroupId: group.id, snapshotId: latest.id, snapshotHash: latest.snapshotHash, analysisPhase: 'review', triggerKey: 'market-reaction.15m', model })
        if (result.created) {
          recordDecision({ eventGroupId: group.id, triggerKey: result.run.triggerKey, changeHash: latest.snapshotHash, decision: 'queued', reasonCode: 'restart-review-compensated', snapshotHash: latest.snapshotHash, analysisRunId: result.run.id })
          dispatch.push({ analysisRunId: result.run.id, eventGroupId: group.id })
        }
      }
    }
    return { failed, stale, dispatch }
  }
  const sweepStalled = (): readonly string[] => {
    const stalled: string[] = []
    for (const run of deps.repository.listRuns?.() ?? []) {
      if (!isStalledAnalysisRun(run, deps.now())) continue
      if (deps.repository.updateRunStatus({ id: run.id, status: 'failed', failureCode: ANALYSIS_RUN_INTERRUPTED, failureDetailCode: 'run-stalled', completedAt: deps.now() })) stalled.push(run.id)
    }
    return stalled
  }
  /**
   * Writes one attempt to the ledger and answers with the row id. The id is what a later stage
   * flips when it refuses the attempt: a refusal must rewrite *this* row, because the counting
   * formula reads "decision = queued" and a second skipped row would leave the attempt counted.
   */
  const recordDecision = (input: Readonly<{ eventGroupId: string; triggerKey: string; changeHash: string; decision: 'queued' | 'skipped'; reasonCode: string; snapshotHash?: string | null; analysisRunId?: string | null }>): string | undefined => {
    return deps.repository.appendTriggerLedger?.({ id: `${analysisRunPolicy.triggerLedgerIdPrefix}${deps.idFactory()}`, eventGroupId: input.eventGroupId, triggerKey: input.triggerKey, changeHash: input.changeHash, decision: input.decision, reasonCode: input.reasonCode, snapshotHash: input.snapshotHash ?? null, analysisRunId: input.analysisRunId ?? null, createdAt: deps.now() })
  }
  return { enqueue, recover, sweepStalled, recordDecision }
}
