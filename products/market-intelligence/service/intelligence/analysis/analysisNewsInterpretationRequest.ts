import type { EventGroup } from '../../../contracts/marketAnalysisContracts'
import {
  NEWS_INTERPRETATION_FAILURE_CODES, NEWS_INTERPRETATION_INSUFFICIENT_REASONS, NEWS_INTERPRETATION_NOT_ELIGIBLE_REASONS,
  type NewsInterpretationReadResult, type NewsInterpretationRequestResult
} from '../../../contracts/marketAnalysisIpcContracts'
import type { IntelligenceItem } from '../schema/intelligenceRecord'
import type { NewsSentimentRecord } from '../schema/newsSentiment'
import type { EnqueueAnalysisRunInput, EnqueueAnalysisRunOutcome } from '../jobs/analysisRunEnqueue'
import { isNewsSeveritySource } from './analysisItemSeverity'
import { createNewsInterpretationReader } from './analysisNewsInterpretationRead'
import type { PreparationDependencies } from './analysisSnapshotPreparation'

/**
 * 按条「AI 解读」：写端点的判读流程（R37 §1.1 / §9.4）。
 *
 * 顺序是有意的——**先判能不能跑，再判要不要跑**：
 * 1. 条目不存在 / 源不在覆盖范围 / 没有可引用的发布时间 → `not-eligible` 三档；自动分析那把
 *    「值不值得花预算」的尺子（信任度、`relevanceOutcome`、`sentimentEligible`）不在这里用；
 * 2. 没有情绪判定 → `no-judgment`（读者只能等，不给重试；不先补判定，那要为一次点击多花一次模型调用）；
 * 3. 开关与模型就绪 → `not-ready`，**在入队前判**，否则先回 queued 再变成一次失败；
 * 4. 同组在飞 → `in-flight`（单飞，连点不会排第二条）；
 * 5. 同 item + 同证据指纹且已有可读摘要 → `already-available`；指纹不同才允许新建；
 * 6. 建不出触发项证据 → `insufficient-facts`（我们的问题，带可查原因）；
 * 7. 排队并观察冻结边界；失败按 §9.4 闭集映射，表外一律落默认码。
 *
 * 「市场事实最低 2 条」只在冻结路径判一次：端点若自己再判一遍，自动路径 1 条事实能跑、手动路径
 * 被拒，就是两把尺子。所以这里只把冻结回来的 `analysis-insufficient-data` 翻成读者能懂的原因。
 */
export type NewsInterpretationEndpointDependencies = PreparationDependencies & Readonly<{
  isEnabled: () => Promise<boolean>
  /** 模型是否已配置（provider + model）。与开关分开判：两种「没就绪」读者的下一步不同。 */
  hasModel: () => Promise<boolean>
  ensureGroup: (itemId: string) => Promise<EventGroup | undefined>
  enqueue: (input: EnqueueAnalysisRunInput) => Promise<EnqueueAnalysisRunOutcome>
  now: () => string
}>

export function createNewsInterpretationEndpoints(deps: NewsInterpretationEndpointDependencies): Readonly<{
  readNewsInterpretation: (itemId: string) => Promise<NewsInterpretationReadResult>
  requestNewsInterpretation: (itemId: string) => Promise<NewsInterpretationRequestResult>
}> {
  const readNewsInterpretation = createNewsInterpretationReader({ ...deps, now: deps.now })

  async function requestNewsInterpretation(itemId: string): Promise<NewsInterpretationRequestResult> {
    const item = deps.pipeline.listItems().find(candidate => candidate.itemId === itemId)
    if (!item) return { state: 'not-eligible', itemId, reason: NEWS_INTERPRETATION_NOT_ELIGIBLE_REASONS.itemNotFound }
    if (!isNewsSeveritySource(item.sourceId)) return { state: 'not-eligible', itemId, reason: NEWS_INTERPRETATION_NOT_ELIGIBLE_REASONS.sourceNotCovered }
    if (!hasCitablePublication(item)) return { state: 'not-eligible', itemId, reason: NEWS_INTERPRETATION_NOT_ELIGIBLE_REASONS.itemNotEligible }
    if (!deps.latestNewsSentiment?.(itemId, deps.now())) return { state: 'no-judgment', itemId }
    if (!await deps.isEnabled()) return { state: 'not-ready', itemId, failureCode: NEWS_INTERPRETATION_FAILURE_CODES.notEnabled }
    if (!await deps.hasModel()) return { state: 'not-ready', itemId, failureCode: NEWS_INTERPRETATION_FAILURE_CODES.providerNotReady }

    // 先确保事件组存在：当前证据指纹是按组算的，第一次点这条时还没有组，先建组才能判断
    // 「这条新闻此刻能不能建出可引用的证据」，也才能在排运行之前 fail-closed。
    const group = await deps.ensureGroup(itemId)
    if (!group) return { state: 'failed', itemId, failureCode: NEWS_INTERPRETATION_FAILURE_CODES.eventGroupNotFound }
    const read = await readNewsInterpretation(itemId)
    if (read.state === 'in-flight') return { state: 'in-flight', itemId, runId: read.runId }
    if (read.state === 'available' && read.currentEvidenceFingerprint === read.evidenceFingerprint) {
      // 同一条新闻、同一份证据、摘要真的读得到：复用，不新建一次运行。
      return {
        state: 'already-available', itemId, runId: read.runId, summaryId: read.summaryId,
        generatedAt: read.generatedAt, snapshotHash: read.snapshotHash, dataAsOf: read.dataAsOf,
        evidenceScope: read.evidenceScope, evidenceFingerprint: read.evidenceFingerprint
      }
    }
    // 指纹变了是「证据变了，应该重读」；算不出指纹是「这条新闻建不出可引用的证据」。
    if (read.currentEvidenceFingerprint === null) {
      return { state: 'insufficient-facts', itemId, details: { reason: NEWS_INTERPRETATION_INSUFFICIENT_REASONS.triggerEvidenceMissing } }
    }
    // 组里已经有一份分析时，冻结必须以「重跑」而不是「首跑」进入：首跑在冻结边界会被
    // `analysis-already-available` 挡掉，读者会看到「点了没反应」。两条路径都必须带触发指针——
    // 串 `manual.refresh` = 一篇市场综述，正是这次线上看到的样子。
    const existing = Boolean(group.currentSummaryId) || deps.repository.listRuns()
      .some(run => run.eventGroupId === group.id && run.status === 'succeeded')
    const outcome = await deps.enqueue({
      eventGroupId: group.id,
      triggerKey: existing ? 'manual.refresh' : 'manual.initial',
      analysisPhase: existing ? 'correction' : 'initial',
      asOf: deps.now(), triggeredItemId: itemId
    })
    if (outcome.state === 'enqueued') return { state: 'queued', itemId, ...(outcome.runId ? { runId: outcome.runId } : {}) }
    if (outcome.state === 'in-flight') return { state: 'in-flight', itemId, ...(outcome.runId ? { runId: outcome.runId } : {}) }
    return failureFor(itemId, outcome.errorCode)
  }

  return { readNewsInterpretation, requestNewsInterpretation }
}

/** 冻结失败的上游码 → 读者能行动的那几档；表外一律默认码（§9.4）。 */
function failureFor(itemId: string, errorCode: string): NewsInterpretationRequestResult {
  if (errorCode.includes('news-trigger-evidence-missing') || errorCode.includes('analysis-missing-evidence')) {
    return { state: 'insufficient-facts', itemId, details: { reason: NEWS_INTERPRETATION_INSUFFICIENT_REASONS.triggerEvidenceMissing } }
  }
  if (errorCode.includes('analysis-insufficient-data')) {
    return { state: 'insufficient-facts', itemId, details: { reason: NEWS_INTERPRETATION_INSUFFICIENT_REASONS.marketFactsBelowMinimum } }
  }
  if (errorCode.includes('analysis-event-group-not-found')) return { state: 'failed', itemId, failureCode: NEWS_INTERPRETATION_FAILURE_CODES.eventGroupNotFound }
  return { state: 'failed', itemId, failureCode: NEWS_INTERPRETATION_FAILURE_CODES.requestFailed }
}

/**
 * 手动入口的准入**不套自动分析那把尺子**：自动分析判的是「这条值不值得花预算」，所以要信任度、
 * 要 `relevanceOutcome: full-intelligence`、要 `sentimentEligible`；读者在界面上点名要读这一条，
 * 这个意愿本身就是准入。用预算的尺子量读者的点名，就会出现「点一条已经有情绪判定的新闻，
 * 被告知不在可单独解读的范围内」——今天这次。
 *
 * 这里只留「这条新闻能不能被解读」的一条硬前提：有发布时间（触发事实要引它当发生时刻；
 * 没有时间戳的残片建不出触发事实，冻结那边本就会 fail-closed）。没有判定由下一步回 `no-judgment`，
 * 有判定却建不出证据引用由冻结回 `insufficient-facts`——两件事各有出口，不混进「不够格」。
 */
function hasCitablePublication(item: IntelligenceItem): boolean {
  return Boolean(item.publishedAt)
}

/** 判定是否已经写下来（端点只用它判 `no-judgment`；方向与强度由冻结路径与校验负责）。 */
export type NewsJudgementReader = (itemId: string, asOf: string) => NewsSentimentRecord | undefined
