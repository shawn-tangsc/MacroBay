import type { AnalysisRun, AnalysisPhase, EventGroup, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_CONTRACT_POLICY } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisIdempotencyKey } from './analysisHash'

export const analysisRunPolicy = Object.freeze({
  version: 'cryptoMarketAnalysisTriggerPolicy.v1',
  promptVersion: 'market-analysis-v2',
  skillVersion: 'market-analysis-v1',
  triggerLedgerIdPrefix: 'mi-ledger-',
  restartInitialWindowMs: 30 * 60 * 1_000
})

type Repository = {
  enqueueRun: (run: AnalysisRun) => { created: boolean; run: AnalysisRun }
  updateRunStatus: (input: { id: string; status: AnalysisRun['status']; completedAt?: string; failureCode?: string; failureDetailCode?: string }) => boolean
  listRuns?: () => readonly AnalysisRun[]
  listEventGroups?: () => readonly EventGroup[]
  listSnapshots?: (eventGroupId: string) => readonly EvidenceSnapshot[]
  appendTriggerLedger?: (value: { id: string; eventGroupId: string; triggerKey: string; changeHash: string; decision: string; reasonCode: string; snapshotHash: string | null; analysisRunId: string | null; createdAt: string }) => void
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
  eventGroupId: string
  snapshotId: string
  snapshotHash: string
  analysisPhase: AnalysisPhase
  triggerKey: string
  /** Absent for a run queued before the model could be known; the invocation then follows the platform default. */
  model?: AnalysisRunModelRef | null
}>

export type AnalysisRunService = Readonly<{
  enqueue: (input: AnalysisRunEnqueueInput) => { created: boolean; run: AnalysisRun }
  recover: () => AnalysisRunRecovery
  recordDecision: (input: Readonly<{ eventGroupId: string; triggerKey: string; changeHash: string; decision: 'queued' | 'skipped'; reasonCode: string; snapshotHash?: string | null; analysisRunId?: string | null }>) => void
}>

export function createAnalysisRunService(deps: Readonly<{ repository: Repository; now: () => string; idFactory: () => string }>): AnalysisRunService {
  const enqueue = (input: AnalysisRunEnqueueInput) => {
    const queuedAt = deps.now()
    const run: AnalysisRun = {
      id: deps.idFactory(), schemaVersion: 1, eventGroupId: input.eventGroupId, snapshotId: input.snapshotId,
      snapshotHash: input.snapshotHash, analysisPhase: input.analysisPhase, triggerKey: input.triggerKey,
      idempotencyKey: buildAnalysisIdempotencyKey(input), status: 'queued', attempt: 1, retryOfRunId: null,
      modelProviderId: input.model?.providerId ?? null, modelId: input.model?.modelId ?? null, policyVersion: analysisRunPolicy.version,
      promptVersion: analysisRunPolicy.promptVersion, skillVersion: analysisRunPolicy.skillVersion, outputSchemaVersion: MARKET_ANALYSIS_CONTRACT_POLICY.outputSchemaVersion,
      jobRunId: null, traceId: null, failureCode: null, failureDetailCode: null, queuedAt, startedAt: null, completedAt: null
    }
    return deps.repository.enqueueRun(run)
  }
  const recover = (): AnalysisRunRecovery => {
    const failed: string[] = []
    const stale: string[] = []
    const dispatch: AnalysisRunDispatch[] = []
    const runs = deps.repository.listRuns?.() ?? []
    for (const run of runs) {
      if (run.status !== 'running') continue
      if (deps.repository.updateRunStatus({ id: run.id, status: 'failed', failureCode: 'runtime-recovered', failureDetailCode: 'runtime-recovered', completedAt: deps.now() })) failed.push(run.id)
    }
    const groups = deps.repository.listEventGroups?.() ?? []
    for (const group of groups) {
      const snapshots = [...(deps.repository.listSnapshots?.(group.id) ?? [])]
      const latest = snapshots.sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)).at(0)
      if (!latest) continue
      const groupRuns = runs.filter(run => run.eventGroupId === group.id)
      for (const run of groupRuns) {
        if (run.status !== 'queued' && run.status !== 'running') continue
        if (run.snapshotId !== latest.id || run.snapshotHash !== latest.snapshotHash) {
          deps.repository.updateRunStatus({ id: run.id, status: 'stale', failureCode: 'restart-expired', failureDetailCode: 'restart-expired', completedAt: deps.now() })
          recordDecision({ eventGroupId: group.id, triggerKey: run.triggerKey, changeHash: run.snapshotHash, decision: 'skipped', reasonCode: 'restart-expired', snapshotHash: latest.snapshotHash, analysisRunId: run.id })
          stale.push(run.id)
        }
      }
      const activeRuns = groupRuns.filter(run => (run.status === 'queued' || run.status === 'running') && run.snapshotId === latest.id && run.snapshotHash === latest.snapshotHash)
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
      if (!hasSuccessfulInitial && !initialPending && withinRestartWindow) {
        const result = enqueue({ eventGroupId: group.id, snapshotId: latest.id, snapshotHash: latest.snapshotHash, analysisPhase: 'initial', triggerKey: 'macro.actual.first-confirmed' })
        if (result.created) {
          recordDecision({ eventGroupId: group.id, triggerKey: result.run.triggerKey, changeHash: latest.snapshotHash, decision: 'queued', reasonCode: 'restart-initial-compensated', snapshotHash: latest.snapshotHash, analysisRunId: result.run.id })
          dispatch.push({ analysisRunId: result.run.id, eventGroupId: group.id })
        }
      }
      const reviewPending = activeRuns.some(run => run.analysisPhase === 'review')
      if (group.reviewCount < 2 && !reviewPending && Number.isFinite(Date.parse(group.reviewDeadlineAt)) && Date.parse(deps.now()) <= Date.parse(group.reviewDeadlineAt) && hasSuccessfulInitial) {
        const result = enqueue({ eventGroupId: group.id, snapshotId: latest.id, snapshotHash: latest.snapshotHash, analysisPhase: 'review', triggerKey: 'market-reaction.15m' })
        if (result.created) {
          recordDecision({ eventGroupId: group.id, triggerKey: result.run.triggerKey, changeHash: latest.snapshotHash, decision: 'queued', reasonCode: 'restart-review-compensated', snapshotHash: latest.snapshotHash, analysisRunId: result.run.id })
          dispatch.push({ analysisRunId: result.run.id, eventGroupId: group.id })
        }
      }
    }
    return { failed, stale, dispatch }
  }
  const recordDecision = (input: Readonly<{ eventGroupId: string; triggerKey: string; changeHash: string; decision: 'queued' | 'skipped'; reasonCode: string; snapshotHash?: string | null; analysisRunId?: string | null }>): void => {
    deps.repository.appendTriggerLedger?.({ id: `${analysisRunPolicy.triggerLedgerIdPrefix}${deps.idFactory()}`, eventGroupId: input.eventGroupId, triggerKey: input.triggerKey, changeHash: input.changeHash, decision: input.decision, reasonCode: input.reasonCode, snapshotHash: input.snapshotHash ?? null, analysisRunId: input.analysisRunId ?? null, createdAt: deps.now() })
  }
  return { enqueue, recover, recordDecision }
}
