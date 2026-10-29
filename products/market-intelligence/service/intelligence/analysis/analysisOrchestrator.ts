import type { StructuredModelInvocationService } from '@platform/ai/invocation/structuredModelInvocation'
import type { StructuredModelMessage, StructuredModelTaskResult } from '@platform/ai/invocation/structuredModelInvocationTypes'
import {
  MARKET_ANALYSIS_ERROR_CODES,
  type AnalysisRun,
  type AnalysisSummary,
  type EvidenceSnapshot,
  type Prediction,
  type TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import {
  formatUnsafeOutputRedaction,
  validateAnalysisModelOutput,
  type AnalysisOutputValidationResult,
  type FrozenAnalysisEvidence,
  type ValidatedAnalysisModelOutput
} from './analysisOutputValidator'
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
  modelTimeoutMs: 240_000,
  /**
   * One immediate repair attempt after a contract rejection, inside the same run.
   *
   * A reply outside the schema is usually a sampling accident, not a broken prompt: the same
   * reader pressed the button again and the second answer was published. Re-asking in place keeps
   * the frozen snapshot and the run row, and the reader never sees a failure they have to act on.
   * The enclosing job budget (`marketAnalysisJobPolicy.runTimeoutMs`) must cover both attempts.
   */
  maxModelAttempts: 2
})

/**
 * The rejections worth another sample.
 *
 * Not retried: unsafe output (a policy problem, not a formatting one), timeouts, provider errors,
 * and cancellation — each already says something the reader can act on, and another call would
 * only spend the same budget twice.
 */
const repairableRejection: ReadonlySet<string> = new Set([
  MARKET_ANALYSIS_ERROR_CODES.invalidJson,
  MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema,
  MARKET_ANALYSIS_ERROR_CODES.missingEvidence
])

/**
 * What the model is told when it has to answer again.
 *
 * Deliberately short and specific: the system prompt already carries the full schema, and
 * repeating a 30KB rejected answer would spend the context the repair needs. The defect names
 * the part that failed, which is the one thing the first attempt could not see.
 */
function repairMessage(defect: Readonly<{ errorCode: string; rule?: string }>): StructuredModelMessage {
  const reason = defect.errorCode === MARKET_ANALYSIS_ERROR_CODES.invalidJson
    ? '上一次回复不是合法 JSON（可能被截断）。'
    : defect.errorCode === MARKET_ANALYSIS_ERROR_CODES.missingEvidence
      ? `上一次输出引用了快照里不存在的证据（${defect.rule ?? 'evidence'}）。`
      : `上一次输出未通过字段结构校验（${defect.rule ?? 'shape'}）。`
  return { role: 'user', content: `${reason}请重新输出同一个 JSON 对象：只输出 JSON，不加 Markdown；顶层字段必须恰好是 conclusion、knownFacts、transmissionHypotheses、marketReaction、supportingEvidence、counterEvidence、scenarios、directions、nextCatalysts、dataCaveats、evidenceRefs，不增加、不删除字段；必要时压缩每个数组的条数，确保 JSON 完整闭合。事实与证据只能引用输入里给出的 factRef / evidenceRef 原文。` }
}

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
    // The run carries the model it was queued for, so the analysis calls exactly the model the
    // reader chose instead of whatever provider happens to be first in the store. Runs without a
    // recorded model keep following the platform default.
    const model = runRecord.modelProviderId && runRecord.modelId
      ? { providerId: runRecord.modelProviderId, modelId: runRecord.modelId }
      : {}
    const proseLanguage = deps.getLanguage ? await deps.getLanguage() : undefined
    let messages = buildAnalysisMessages({ ...withChange, facts }, (input.significanceSignals ?? []) as readonly SignificanceSignal[], session, proseLanguage)
    let invocation: InvocationResult | undefined
    let validated: AnalysisOutputValidationResult | undefined
    // One immediate repair attempt, inside the same run and against the same frozen snapshot.
    // A model that answers outside the contract once is not a failed analysis: the previous
    // product required the reader to press "Analyze now" again (which is exactly what they did,
    // and the second answer was published). Asking again in place costs one call and no re-freeze.
    for (let attempt = 1; attempt <= marketAnalysisInvocationPolicy.maxModelAttempts; attempt += 1) {
      if (signal.aborted) return cancel(runRecord.id)
      try {
        invocation = await deps.structuredModelInvocation.invoke({
          taskId: runRecord.id,
          messages,
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
      if (!invocation.ok) {
        if (invocation.errorCode === 'cancelled') return cancel(runRecord.id)
        const repairable = invocation.errorCode === 'invalid-json'
        if (!repairable || attempt >= marketAnalysisInvocationPolicy.maxModelAttempts) {
          return fail(runRecord.id, 'failed', mapInvocationError(invocation.errorCode))
        }
        messages = [...messages, repairMessage({ errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidJson })]
        continue
      }
      validated = validateAnalysisModelOutput(JSON.stringify(invocation.output), frozenEvidence)
      if (validated.ok) break
      if (attempt >= marketAnalysisInvocationPolicy.maxModelAttempts || !repairableRejection.has(validated.errorCode)) break
      messages = [...messages, repairMessage(validated)]
    }
    if (!invocation?.ok || !validated) return fail(runRecord.id, 'failed', MARKET_ANALYSIS_ERROR_CODES.providerError)

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
  // A reply that is not JSON at all is a different defect from a JSON object with the wrong
  // shape, and the reader can act on the difference ("it was cut off" vs "it invented a field").
  // Keeping both as `analysis-invalid-output-schema` is what made every rejection read the same.
  if (errorCode === 'invalid-json') return MARKET_ANALYSIS_ERROR_CODES.invalidJson
  if (errorCode === 'schema-validation-failed') return MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema
  return MARKET_ANALYSIS_ERROR_CODES.providerError
}
