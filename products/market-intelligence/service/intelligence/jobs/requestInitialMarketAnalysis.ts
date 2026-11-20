import type { JobRuntime } from '@platform/jobs'
import { MARKET_ANALYSIS_ERROR_CODES, type AnalysisRun, type EventGroup } from '../../../contracts/marketAnalysisContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { resolveTriggerKey, type AnalysisTriggerSource } from '../analysis/analysisTriggerSourcePolicy'
import type { AnalysisSessionSlot } from '../analysis/analysisSchedulePolicy'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'
import { createAnalysisRunEnqueuer } from './analysisRunEnqueue'

// Product-owned manual retry policy: an observation timeout never ends the background job.
export const initialMarketAnalysisRequestPolicy = Object.freeze({
  freezeObservationTimeoutMs: 45_000,
  retryableStatuses: ['failed', 'invalid-output', 'cancelled'] as readonly AnalysisRun['status'][],
  blockingStatuses: ['queued', 'running', 'succeeded'] as readonly AnalysisRun['status'][],
  /**
   * Statuses that mean "work for this group is already on its way". A duplicate request must
   * not create a second one, and they are the only statuses a correction refuses.
   */
  inFlightStatuses: ['queued', 'running'] as readonly AnalysisRun['status'][]
})

export function createInitialMarketAnalysisRequest(deps: {
  repository: MarketAnalysisRepository
  jobRuntime: JobRuntime
  listItems: () => IntelligenceItem[]
  /** 建组读当刻的情绪判定，所以允许异步；同步实现（测试与无判定装配）照样能用。 */
  createGroup: (itemId: string) => EventGroup | Promise<EventGroup>
  now: () => string
  /** The capability's switch. Absent (headless/test wiring) leaves the request ungated. */
  isEnabled?: () => Promise<boolean>
  /**
   * 读者选好的模型还在不在。排冻结之前就问：没有模型时排上去也只会失败，
   * 而失败原因会晚一步才出现，读者看到的是「点了没反应」。
   *
   * **必填，没有默认值**：漏传时这道门会整道消失，退回「照常入队然后 401」的旧行为。
   * 真的没有模型服务时传 `async () => false`（语义是「没有可用模型」，请求落
   * `analysis-provider-not-ready`），而不是靠可选参数跳过检查。
   */
  hasModel: () => Promise<boolean>
}) {
  const enqueue = createAnalysisRunEnqueuer({ jobRuntime: deps.jobRuntime, repository: deps.repository, now: deps.now })
  return async (itemId: string | undefined, retryRunId: string | undefined, mode: 'initial' | 'refresh', source: AnalysisTriggerSource, slot?: AnalysisSessionSlot): Promise<{ itemId: string; queued: true }> => {
    if (mode !== 'initial' && mode !== 'refresh') throw new Error('analysis-invalid-request')
    // Asked before anything is written: a disabled capability must not create a group, a freeze job
    // or a run, so there is nothing left behind for a later run to trip over.
    if (deps.isEnabled && !await deps.isEnabled()) throw new Error('analysis-not-enabled')
    // 模型没选好就不排冻结：这个码和按条解读端点共用，界面照着说「还没有可用的模型」，
    // 而不是把「排不上队」当成网络或容量问题（用户 2026-11-20 点重试那次就是这样被吞的）。
    if (!await deps.hasModel()) throw new Error(MARKET_ANALYSIS_ERROR_CODES.providerNotReady)
    // `source` is required and has no default: a caller that forgets it must not silently
    // inherit the manual exemption from the gate.
    const triggerKey = resolveTriggerKey(source, mode, slot)
    const previousRun = retryRunId ? deps.repository.getRun(retryRunId) : undefined
    if (retryRunId && (!previousRun || !initialMarketAnalysisRequestPolicy.retryableStatuses.includes(previousRun.status))) throw new Error('analysis-invalid-request')
    const retryGroup = previousRun ? deps.repository.getEventGroup(previousRun.eventGroupId) : undefined
    if (retryRunId && !retryGroup) throw new Error('analysis-invalid-request')
    const items = deps.listItems().filter(eligible)
    const item = retryGroup ? items.find(candidate => retryGroup.eventRefs.includes(candidate.itemId))
      : itemId ? items.find(candidate => candidate.itemId === itemId)
        : items.sort((left, right) => left.detectedAt.localeCompare(right.detectedAt)).at(-1)
    if (!item) throw new Error('analysis-not-eligible')
    const group = retryGroup ?? deps.repository.listEventGroups().find(candidate => candidate.eventRefs.includes(item.itemId)) ?? await deps.createGroup(item.itemId)
    const activeFreeze = deps.jobRuntime.listRuns({ handlerId: FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB,
      statuses: ['queued', 'running'], payload: { eventGroupId: group.id }, limit: 1 })
    const manual = source === 'manual'
    // The single-flight guard still holds -- a duplicate must not start a second freeze -- but
    // the reader who clicked 重新分析 is asking for the run that is already on its way, so
    // reporting it as queued is the honest answer. Refusing the click with "已有最新分析"
    // told the reader nothing was happening at the exact moment something was.
    const inFlight = activeFreeze.length > 0 ||
      deps.repository.listRuns().some(run => run.eventGroupId === group.id && initialMarketAnalysisRequestPolicy.inFlightStatuses.includes(run.status))
    if (inFlight) {
      if (manual) return { itemId: item.itemId, queued: true }
      throw new Error('analysis-already-available')
    }
    // 重新分析 exists to replace the published conclusion, so for a manual correction the
    // remaining "already available" rules are exactly what it is meant to override. Every
    // other caller keeps them: for a data-driven trigger a skip is a budget decision, and for
    // `initial` the freeze boundary enforces the same invariant this gate would.
    const manualCorrection = manual && mode === 'refresh'
    const blockingStatuses = mode === 'refresh'
      ? initialMarketAnalysisRequestPolicy.inFlightStatuses
      : initialMarketAnalysisRequestPolicy.blockingStatuses
    if (!manualCorrection && ((mode === 'initial' && group.currentSummaryId) || deps.repository.listRuns().some(run => run.eventGroupId === group.id && blockingStatuses.includes(run.status)))) throw new Error('analysis-already-available')
    // 手动入口就是「按当前数据做一次市场分析」：不再因为组是消息面、或缺了新闻触发指针，
    // 就把读者点给市场分析的按钮改道去新闻解读线。新闻解读有自己的写端点
    // （`requestNewsInterpretation`），「一条新闻一份解读」的判定归那条线。
    //
    // 2026-11-20 的事故：市场分析页的手动点击被改道到新闻线，而那条新闻的原始记录已不在
    // 保留期，冻结第一步就失败；界面把它说成「重新分析未成功」，读者只能反复点。
    // 入队与冻结观察是两条手动入口共用的那一段（§9.1）；旧命令对「在飞」返回 queued，语义不变。
    const outcome = await enqueue({
      analysisKind: 'market', eventGroupId: group.id, triggerKey, analysisPhase: mode === 'refresh' ? 'correction' : 'initial', asOf: deps.now()
    })
    if (outcome.state === 'enqueued' || outcome.state === 'in-flight') return { itemId: item.itemId, queued: true }
    throw new Error(enqueueFailureCode(outcome.errorCode))
  }
}

/**
 * 冻结失败的上游码 → 读者能行动的那几档。表外的码不直通（`lastError` 可能是任意内部文本），
 * 但也不再静默折成一个通用码：先留一条结构化日志，界面那层的兜底句才说得出口。
 *
 * 这条替换的是「排不上就只说 `analysis-initial-request-failed`」——那句话把模型未就绪、
 * 事实不够、组对不上全说成同一件事，读者无法行动。
 */
const ENQUEUE_FAILURE_CODES = [
  MARKET_ANALYSIS_ERROR_CODES.providerNotReady,
  'analysis-already-available',
  'analysis-not-eligible',
  'analysis-event-group-not-found',
  'analysis-insufficient-data',
  // 原始记录已不在保留期 / 引不出可核对的证据：不是网络或模型问题，重试也不会自己好。
  'analysis-missing-evidence'
] as const

function enqueueFailureCode(errorCode: string): string {
  const known = ENQUEUE_FAILURE_CODES.find(code => errorCode.includes(code))
  if (known) return known
  console.log(JSON.stringify({ marker: 'MI_ANALYSIS_ENQUEUE_UNMAPPED', errorCode }))
  return 'analysis-initial-request-failed'
}

function eligible(item: IntelligenceItem): boolean {
  if (item.sourceTrust !== 'high' || !item.publishedAt) return false
  try {
    const labels = JSON.parse(item.processingLabelsJson ?? '{}')
    return labels.relevanceOutcome === 'full-intelligence' && labels.sentimentEligible === true
  } catch { return false }
}
