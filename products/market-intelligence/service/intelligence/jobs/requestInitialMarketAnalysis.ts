import type { JobRuntime } from '@platform/jobs'
import type { AnalysisRun, EventGroup } from '../../../contracts/marketAnalysisContracts'
import type { NewsInterpretationReadResult } from '../../../contracts/marketAnalysisIpcContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { MarketAnalysisRepository } from '../store/marketAnalysisRepository'
import { resolveTriggerKey, type AnalysisTriggerSource } from '../analysis/analysisTriggerSourcePolicy'
import type { AnalysisSessionSlot } from '../analysis/analysisSchedulePolicy'
import { FREEZE_MARKET_ANALYSIS_SNAPSHOT_JOB } from './marketAnalysisJobIds'
import { createAnalysisRunEnqueuer } from './analysisRunEnqueue'
import { interpretationAdmission } from '../analysis/analysisNewsInterpretationAdmission'
import { interpretationKindForGroup } from '../analysis/analysisInterpretationKind'
import type { NewsSentimentRecord } from '../schema/newsSentiment'

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
  /** 遗留手动刷新落 news 线时的准入判据（有判定 = 能写第一段的偏向）。 */
  latestNewsSentiment?: (itemId: string, asOf: string) => NewsSentimentRecord | undefined
  /**
   * 新闻线的只读判读（与写端点同一个实现）。遗留刷新靠它回答「这条新闻是不是已经有一份读得了
   * 的解读」，判定不许在这里复制一份：指纹怎么算、什么算可读，只有那一个实现知道。
   */
  readNewsInterpretation?: (itemId: string) => Promise<NewsInterpretationReadResult>
  /** The capability's switch. Absent (headless/test wiring) leaves the request ungated. */
  isEnabled?: () => Promise<boolean>
}) {
  const enqueue = createAnalysisRunEnqueuer({ jobRuntime: deps.jobRuntime, repository: deps.repository, now: deps.now })
  return async (itemId: string | undefined, retryRunId: string | undefined, mode: 'initial' | 'refresh', source: AnalysisTriggerSource, slot?: AnalysisSessionSlot): Promise<{ itemId: string; queued: true }> => {
    if (mode !== 'initial' && mode !== 'refresh') throw new Error('analysis-invalid-request')
    // Asked before anything is written: a disabled capability must not create a group, a freeze job
    // or a run, so there is nothing left behind for a later run to trip over.
    if (deps.isEnabled && !await deps.isEnabled()) throw new Error('analysis-not-enabled')
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
    // R39 S1：组是消息面（sentiment）或带触发指针时，遗留的手动刷新在服务端分流到 news 线。
    // 判定看组与快照，不看载荷猜；返回形状仍是 `{itemId, queued:true}`。自动来源不动。
    const line = source === 'manual' ? interpretationKindForGroup(group, deps.repository) : 'market'
    if (line === 'news') {
      const admission = interpretationAdmission(item, {
        ...(deps.latestNewsSentiment === undefined ? {} : { latestNewsSentiment: deps.latestNewsSentiment }),
        now: deps.now
      })
      // 消息面里没有判定的条目今天写不出触发事实：fail-closed，不排一次注定失败的运行。
      if (!admission.ok) throw new Error('analysis-not-eligible')
      // 一条新闻只允许一份解读（按行数验收）：与写端点同一份读判——同一条、同证据指纹且已有
      // 可读摘要就复用，不再排一次冻结；指纹不同（新闻事实变了）才允许新建，旧的那份保留。
      // 判定不在这里复制：指纹怎么算、什么算可读，只有 `readNewsInterpretation` 知道。
      const read = deps.readNewsInterpretation ? await deps.readNewsInterpretation(item.itemId) : undefined
      if (read?.state === 'in-flight') return { itemId: item.itemId, queued: true }
      if (read?.state === 'available' && read.currentEvidenceFingerprint === read.evidenceFingerprint) {
        return { itemId: item.itemId, queued: true }
      }
      const outcome = await enqueue({
        analysisKind: 'news', eventGroupId: group.id, triggerKey: 'news.manual',
        analysisPhase: mode === 'refresh' ? 'correction' : 'initial', asOf: deps.now(), triggeredItemId: item.itemId
      })
      if (outcome.state === 'enqueued' || outcome.state === 'in-flight') return { itemId: item.itemId, queued: true }
      throw new Error('analysis-initial-request-failed')
    }
    // 入队与冻结观察是两条手动入口共用的那一段（§9.1）；旧命令对「在飞」返回 queued，语义不变。
    const outcome = await enqueue({
      analysisKind: 'market', eventGroupId: group.id, triggerKey, analysisPhase: mode === 'refresh' ? 'correction' : 'initial', asOf: deps.now()
    })
    if (outcome.state === 'enqueued' || outcome.state === 'in-flight') return { itemId: item.itemId, queued: true }
    throw new Error('analysis-initial-request-failed')
  }
}

function eligible(item: IntelligenceItem): boolean {
  if (item.sourceTrust !== 'high' || !item.publishedAt) return false
  try {
    const labels = JSON.parse(item.processingLabelsJson ?? '{}')
    return labels.relevanceOutcome === 'full-intelligence' && labels.sentimentEligible === true
  } catch { return false }
}
