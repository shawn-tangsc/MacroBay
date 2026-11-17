import type { JobRuntime } from '@platform/jobs'
import type { AnalysisPhase } from '../../../contracts/marketAnalysisContracts'
import type { AnalysisKind } from '../../../contracts/analysisKinds'
import { isStalledAnalysisRun } from '../analysis/analysisRunStaleness'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'

/**
 * 两条手动入口共用的**一段**：把冻结作业排上去、等冻结边界、回报结果。
 *
 * 架构师裁定 §9.1：`requestInitialAnalysis` 与按条解读共用建组、单飞、入队、冻结观察，但**不共用
 * IPC 语义**（旧命令返回 `queued`、新端点要 `in-flight` + `runId`；旧命令把冻结失败折成一句、
 * 新端点要分「事实不够」）。所以共用的就是这一层，解释留各自端点。
 */
export const analysisRunEnqueuePolicy = Object.freeze({
  freezeObservationTimeoutMs: 45_000,
  inFlightStatuses: ['queued', 'running'] as const
})

export type EnqueueAnalysisRunOutcome =
  | Readonly<{ state: 'enqueued'; runId?: string }>
  /** 同一组已有排队/运行中的冻结：没再排第二条，也没失败。 */
  | Readonly<{ state: 'in-flight'; runId?: string }>
  /** 冻结没跑成：`errorCode` 是作业的 `lastError`（上游码，由端点按闭集映射）。 */
  | Readonly<{ state: 'failed'; errorCode: string }>

export type EnqueueAnalysisRunInput = Readonly<{
  /** 这次冻结要落在哪条线上：冻结作业只带这一袋字段，run 行靠它选线。 */
  analysisKind: AnalysisKind
  eventGroupId: string
  triggerKey: string
  analysisPhase: AnalysisPhase
  asOf: string
  /** 按条解读才有：主触发条目，会随载荷进冻结，写触发指针。 */
  triggeredItemId?: string
}>

export function createAnalysisRunEnqueuer(deps: Readonly<{
  jobRuntime: Pick<JobRuntime, 'enqueueDefinition' | 'waitForRunTerminal' | 'listRuns'>
  repository: Readonly<{ listRuns: () => readonly { eventGroupId: string; status: string; id: string; queuedAt: string; startedAt: string | null }[] }>
  now: () => string
}>): (input: EnqueueAnalysisRunInput) => Promise<EnqueueAnalysisRunOutcome> {
  const pending = new Set<string>()
  return async function enqueueAnalysisRun(input: EnqueueAnalysisRunInput): Promise<EnqueueAnalysisRunOutcome> {
    const active = deps.jobRuntime.listRuns({
      handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB, statuses: ['queued', 'running'],
      payload: { eventGroupId: input.eventGroupId }, limit: 1
    })
    // 卡住的运行不挡新人：它不会再动，挡着只会让读者点一次换回一句「正在解读」。
    // 收尸归恢复与周期性清点，这里只保证这一次点击真的能排上。
    const inFlightRun = deps.repository.listRuns()
      .find(run => run.eventGroupId === input.eventGroupId &&
        (analysisRunEnqueuePolicy.inFlightStatuses as readonly string[]).includes(run.status) &&
        !isStalledAnalysisRun({ status: run.status as 'queued' | 'running', queuedAt: run.queuedAt, startedAt: run.startedAt }, deps.now()))
    if (pending.has(input.eventGroupId) || active.length > 0 || inFlightRun) {
      return { state: 'in-flight', ...(inFlightRun ? { runId: inFlightRun.id } : {}) }
    }
    pending.add(input.eventGroupId)
    try {
      const job = await deps.jobRuntime.enqueueDefinition({
        id: `market-analysis:manual-freeze:${input.eventGroupId}`, owner: 'product', productId: 'market-intelligence',
        handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
        title: input.analysisPhase === 'correction' ? 'Refresh market analysis snapshot' : 'Freeze first market analysis snapshot',
        trigger: { kind: 'manual' },
        payload: {
          eventGroupId: input.eventGroupId, triggerKey: input.triggerKey, analysisPhase: input.analysisPhase, asOf: input.asOf,
          analysisKind: input.analysisKind,
          ...(input.triggeredItemId ? { triggeredItemId: input.triggeredItemId } : {})
        }
      })
      // Observe the freeze boundary so pre-run query/storage errors cannot masquerade as queued work.
      const terminal = await deps.jobRuntime.waitForRunTerminal(job.id, { timeoutMs: analysisRunEnqueuePolicy.freezeObservationTimeoutMs })
      if (terminal.state !== 'terminal' || terminal.run.status !== 'completed') {
        return { state: 'failed', errorCode: terminal.state === 'terminal' ? (terminal.run.lastError ?? 'analysis-initial-request-failed') : 'analysis-initial-request-failed' }
      }
      const runId = typeof terminal.run.result === 'object' && terminal.run.result !== null
        ? (terminal.run.result as { analysisRunId?: unknown }).analysisRunId
        : undefined
      return { state: 'enqueued', ...(typeof runId === 'string' ? { runId } : {}) }
    } finally {
      pending.delete(input.eventGroupId)
    }
  }
}
