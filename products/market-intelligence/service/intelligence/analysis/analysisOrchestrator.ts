import type { StructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { StructuredModelTaskResult } from '@platform/ai/invocation/structuredModelInvocationTypes'
import {
  MARKET_ANALYSIS_ERROR_CODES,
  type AnalysisRun,
  type AnalysisSummary,
  type EvidenceSnapshot,
  type Prediction,
  type TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import { formatUnsafeOutputRedaction, validateAnalysisModelOutput, type FrozenAnalysisEvidence, type ValidatedAnalysisModelOutput } from './analysisOutputValidator'
import { buildAnalysisMessages, type AnalysisSessionInput } from './analysisModelPrompt'
import { sessionBriefForTriggerKey } from './analysisSessionContext'
import { slotInstantAtOrBefore } from './analysisSlotCoverage'
import type { SignificanceSignal } from './significanceChangeMatcher'
import { withSnapshotChange } from './snapshotChange'

type Repository = Readonly<{
  getRun: (id: string) => AnalysisRun | undefined
  getSnapshot?: (id: string) => EvidenceSnapshot | undefined
  listSnapshots?: (eventGroupId: string) => readonly EvidenceSnapshot[]
  getEventGroup: (id: string) => { id: string; currentSummaryId: string | null } | undefined
  getSummary?: (id: string) => { version: number } | undefined
  claimRun: (id: string, startedAt: string) => boolean
  updateRunStatus: (input: { id: string; status: AnalysisRun['status']; completedAt?: string; failureCode?: string; failureDetailCode?: string }) => boolean
  commitSuccessfulAnalysis: (input: { runId: string; summary: AnalysisSummary; predictions: readonly Prediction[]; timeline: TimelineEntry }) => void
}>

type InvocationResult = StructuredModelTaskResult<unknown>

// The market snapshot can contain a bounded historical ETF/funding window. The
// owner of this policy keeps the model and job budgets aligned with that input
// size; changing either value requires updating the corresponding regression
// tests and job policy.
//
// The budget has to cover the *whole* answer, not the first token: the call is one non-streamed
// request that must return the complete structured JSON (see `requestOpenAiCompatibleChatCompletion`).
// At 120s a reasoning model that spends a minute thinking and then emits the schema had no room to
// finish, and every such run was published as `analysis-timeout`. Four minutes covers a thinking
// model on this input size while still ending a genuinely hung connection; a real timeout still
// surfaces, it just no longer arrives before the model could have answered.
export const marketAnalysisInvocationPolicy = Object.freeze({
  modelTimeoutMs: 240_000
})

export type AnalysisOrchestratorResult = Readonly<{
  status: 'succeeded' | 'failed' | 'invalid-output' | 'cancelled'
  errorCode?: string
}>

export function createAnalysisOrchestrator(deps: Readonly<{
  repository: Repository
  structuredModelInvocation: Pick<StructuredModelInvocationService, 'invoke'>
  now: () => string
  idFactory: () => string
  /**
   * 正文语言在**提交时**读取：读者切换语言后，后续运行按新语言写，已发布结论保持原样。
   * 缺省（headless / 测试）按契约原语言处理。
   */
  getLanguage?: () => Promise<import('@platform/settings/schema/appSettings').AppLanguage>
}>): Readonly<{ run: (input: { analysisRunId: string; signal?: AbortSignal; significanceSignals?: readonly unknown[] }) => Promise<AnalysisOrchestratorResult> }> {
  async function run(input: { analysisRunId: string; signal?: AbortSignal; significanceSignals?: readonly unknown[] }): Promise<AnalysisOrchestratorResult> {
    const runRecord = deps.repository.getRun(input.analysisRunId)
    if (!runRecord || !deps.repository.claimRun(runRecord.id, deps.now())) return { status: 'failed', errorCode: 'analysis-run-not-available' }
    if (input.signal?.aborted) return cancel(runRecord.id)
    const signal = input.signal ?? new AbortController().signal

    const snapshot = deps.repository.getSnapshot?.(runRecord.snapshotId) ?? deps.repository.listSnapshots?.(runRecord.eventGroupId).find(value => value.id === runRecord.snapshotId)
    if (!snapshot || snapshot.snapshotHash !== runRecord.snapshotHash) return fail(runRecord.id, 'failed', 'analysis-snapshot-changed')
    // Snapshots frozen before the change record existed derive it from their
    // immutable predecessor, so the model always receives "what moved".
    const withChange = withSnapshotChange(snapshot, deps.repository.listSnapshots?.(runRecord.eventGroupId) ?? [])
    const evidenceIds = new Set(withChange.evidenceRefs.map(ref => ref.evidenceRefId))
    const facts = withChange.facts.filter(fact => fact.evidenceRefId && evidenceIds.has(fact.evidenceRefId))
    if (!facts.length) return fail(runRecord.id, 'failed', MARKET_ANALYSIS_ERROR_CODES.missingEvidence)
    const frozenEvidence: FrozenAnalysisEvidence = { facts, evidenceRefs: withChange.evidenceRefs }

    // The run's own trigger key says which open it serves; recovery runs and manual runs keep the
    // prompt they had.
    const brief = sessionBriefForTriggerKey(runRecord.triggerKey)
    const openInstant = brief ? slotInstantAtOrBefore(brief.slot, new Date(runRecord.queuedAt)) : null
    const session: AnalysisSessionInput | undefined = brief && openInstant ? { brief, openInstant } : undefined
    let invocation: InvocationResult
    try {
      // The run carries the model it was queued for, so the analysis calls exactly the model the
      // reader chose instead of whatever provider happens to be first in the store. Runs without a
      // recorded model keep following the platform default.
      const model = runRecord.modelProviderId && runRecord.modelId
        ? { providerId: runRecord.modelProviderId, modelId: runRecord.modelId }
        : {}
      const proseLanguage = deps.getLanguage ? await deps.getLanguage() : undefined
      invocation = await deps.structuredModelInvocation.invoke({
        taskId: runRecord.id,
        messages: buildAnalysisMessages({ ...withChange, facts }, (input.significanceSignals ?? []) as readonly SignificanceSignal[], session, proseLanguage),
        timeoutMs: marketAnalysisInvocationPolicy.modelTimeoutMs,
        abortSignal: signal,
        ...model,
        parse: value => value
      })
    } catch {
      return fail(runRecord.id, 'failed', MARKET_ANALYSIS_ERROR_CODES.providerError)
    }
    // A cancelled invocation never spent its budget: the caller ended it (the window closed, the
    // job was cancelled, the app is shutting down). Recording that as a timeout told the reader the
    // model was slow when nothing had gone wrong with the model at all.
    if (!invocation.ok && invocation.errorCode === 'cancelled') return cancel(runRecord.id)
    if (!invocation.ok) return fail(runRecord.id, 'failed', mapInvocationError(invocation.errorCode))

    const validated = validateAnalysisModelOutput(JSON.stringify(invocation.output), frozenEvidence)
    if (!validated.ok) {
      // The coarse code is what the reader sees; the rule is what the next investigation needs.
      // Three different defects used to arrive as one "missing evidence" message.
      console.log(JSON.stringify({
        marker: 'MI_ANALYSIS_OUTPUT_REJECTED',
        analysisRunId: runRecord.id,
        errorCode: validated.errorCode,
        rule: validated.rule ?? null
      }))
      return fail(runRecord.id, 'invalid-output', validated.errorCode, validated.rule ?? validated.errorCode)
    }
    // A removed prohibited value is recorded rather than silently dropped: the
    // conclusion stays usable, and the run says what was taken out and where.
    if (validated.redactions.length > 0) console.log(formatUnsafeOutputRedaction(runRecord.id, validated.redactions))
    if (signal.aborted) return cancel(runRecord.id)

    const group = deps.repository.getEventGroup(runRecord.eventGroupId)
    if (!group) return fail(runRecord.id, 'failed', 'analysis-event-group-not-found')
    const currentVersion = group.currentSummaryId ? deps.repository.getSummary?.(group.currentSummaryId)?.version ?? 0 : 0
    const summary = toSummary(runRecord, validated.value, currentVersion + 1, deps.now(), deps.idFactory)
    const predictions = toPredictions(summary, validated.value, deps.now(), deps.idFactory)
    const timeline: TimelineEntry = {
      id: makeId('mi-tl-', deps.idFactory()), schemaVersion: 1, eventGroupId: runRecord.eventGroupId, analysisRunId: runRecord.id,
      kind: runRecord.analysisPhase === 'review' ? 'review' : 'analysis', status: 'published', occurredAt: summary.createdAt,
      summaryRef: summary.id,
      safeTitle: '市场分析已生成',
      safeExcerpt: summary.conclusion?.summary ?? summary.eventAssessment ?? null,
      direction: summary.conclusion?.direction ?? null,
      version: summary.version
    }
    try {
      deps.repository.commitSuccessfulAnalysis({ runId: runRecord.id, summary, predictions, timeline })
    } catch {
      return fail(runRecord.id, 'failed', MARKET_ANALYSIS_ERROR_CODES.storageFailed)
    }
    return { status: 'succeeded' }
  }

  function cancel(id: string): AnalysisOrchestratorResult {
    deps.repository.updateRunStatus({ id, status: 'cancelled', completedAt: deps.now(), failureCode: MARKET_ANALYSIS_ERROR_CODES.cancelled })
    return { status: 'cancelled', errorCode: MARKET_ANALYSIS_ERROR_CODES.cancelled }
  }

  function fail(id: string, status: 'failed' | 'invalid-output', errorCode: string, failureDetailCode = errorCode): AnalysisOrchestratorResult {
    deps.repository.updateRunStatus({ id, status, completedAt: deps.now(), failureCode: errorCode, failureDetailCode })
    return { status, errorCode }
  }

  return { run }
}

function toSummary(run: AnalysisRun, output: ValidatedAnalysisModelOutput, version: number, createdAt: string, idFactory: () => string): AnalysisSummary {
  return { id: makeId('mi-as-', idFactory()), schemaVersion: 1, analysisRunId: run.id, eventGroupId: run.eventGroupId, version, ...output, createdAt }
}

function toPredictions(summary: AnalysisSummary, output: ValidatedAnalysisModelOutput, createdAt: string, idFactory: () => string): Prediction[] {
  return output.scenarios.map((scenario) => {
    const horizonMs = scenario.horizon === '0-15m' ? 15 * 60_000 : scenario.horizon === '15m-2h' ? 2 * 60 * 60_000 : scenario.horizon === '2h-24h' ? 24 * 60 * 60_000 : 3 * 24 * 60 * 60_000
    const horizonEnd = new Date(Date.parse(createdAt) + horizonMs).toISOString()
    return { id: makeId('mi-pr-', idFactory()), schemaVersion: 1, summaryId: summary.id, asset: scenario.asset, horizonStart: createdAt, horizonEnd, baseCase: scenario.baseCase, conditions: scenario.conditions, invalidation: scenario.invalidation, nextCatalyst: output.nextCatalysts[0]?.statement ?? null, status: 'pending', verificationDueAt: horizonEnd, createdAt }
  })
}

function makeId(prefix: string, value: string): string {
  return value.startsWith(prefix) ? value : `${prefix}${value}`
}

function mapInvocationError(errorCode: string): string {
  if (errorCode === 'model-not-ready' || errorCode === 'provider-disabled' || errorCode === 'missing-api-key') return MARKET_ANALYSIS_ERROR_CODES.providerNotReady
  if (errorCode === 'timeout') return MARKET_ANALYSIS_ERROR_CODES.timeout
  if (errorCode === 'invalid-json' || errorCode === 'schema-validation-failed') return MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema
  return MARKET_ANALYSIS_ERROR_CODES.providerError
}
