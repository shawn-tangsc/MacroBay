import type { AppLanguage } from '@platform/settings/schema/appSettings'

import { MARKET_ANALYSIS_CONTRACT_POLICY } from '../../../contracts/marketAnalysisContracts'
import { analysisConclusionPushEligible } from './analysisConclusionPush'
import type { AnalysisLine } from './analysisLineRegistry'
import { buildAnalysisMessages, type AnalysisSessionInput } from './analysisModelPrompt'
import { repairableRejection } from './analysisModelRepair'
import { validateAnalysisModelOutput } from './analysisOutputValidator'
import { buildAnalysisSummary, buildPredictionRecords, buildPublishedTimeline } from './analysisRecordBuilders'

/**
 * 市场线（R39 §2）。
 *
 * 它不认识 `snapshot.trigger`：提示词、输出契约与校验都不带触发段。写库副作用是它独有的
 * ——预测行、发布时间轴、组当前结论指针、会话摘要、结论推送。
 *
 * 版本号是线的事实：运行行写的是「哪条线的第几版提示词/技能」，不是全局常量。
 */
export const marketAnalysisLine: AnalysisLine = Object.freeze({
  analysisKind: 'market',
  promptVersion: 'market-analysis-v2',
  skillVersion: 'market-analysis-v1',
  outputSchemaVersion: MARKET_ANALYSIS_CONTRACT_POLICY.outputSchemaVersion,

  buildMessages(snapshot, significanceSignals, session, proseLanguage) {
    return buildAnalysisMessages(snapshot, significanceSignals, session, proseLanguage)
  },

  validate(raw, evidence, focus) {
    // 市场线关掉新闻触发型必答块（R39）：它不读触发指针，不该被「没回答那条新闻」拒收。
    return validateAnalysisModelOutput(raw, evidence, focus, { newsTriggerRules: false })
  },

  repairableRejections: repairableRejection,

  async persist(run, output, deps) {
    const group = deps.repository.getEventGroup?.(run.eventGroupId)
    if (!group) throw new Error('analysis-event-group-not-found')
    const currentVersion = group.currentSummaryId ? deps.repository.getSummary?.(group.currentSummaryId)?.version ?? 0 : 0
    const summary = buildAnalysisSummary(run, output, currentVersion + 1, deps.now, deps.idFactory, deps.proseLanguage)
    const predictions = buildPredictionRecords(summary, output, deps.now, deps.idFactory)
    const timeline = buildPublishedTimeline(run, summary, deps.idFactory)
    deps.repository.commitSuccessfulAnalysis({ runId: run.id, summary, predictions, timeline })
    // 摘要写进会话；原文仍在 mi_analysis_io，按 run id 读出，不复制到这来。失败不阻断发布，
    // 留痕在 helper 里（读者打开只剩卡片时，事后只有那条 marker 能查得到）。
    await deps.appendRunSummary?.({ runId: run.id, summary: summary.conclusion?.summary ?? summary.eventAssessment ?? '' })
    // N12：**达到门槛**的那次、写入记录之后，提交一次结论推送。判据是原因码，不是触发键——
    // 键记的是阶段，消息面达门槛的运行也长着宏观的样子（`analysisConclusionPushEligible` 一处判）。
    const triggerReasonCode = deps.repository.triggerReasonOf?.(run.id)
    if (deps.notifyAnalysisConclusion !== undefined && analysisConclusionPushEligible({
      triggerKey: run.triggerKey,
      ...(triggerReasonCode === undefined ? {} : { reasonCode: triggerReasonCode })
    })) {
      try {
        const trigger = deps.readTriggerSignal?.(run.triggerKey) ?? {}
        const citedFactIds = Object.freeze([...new Set([
          ...output.knownFacts.map((claim) => claim.factId),
          ...output.marketReaction.flatMap((claim) => claim.factIds)
        ])])
        await deps.notifyAnalysisConclusion({
          runId: run.id,
          triggerKey: run.triggerKey,
          // 桶 = 原因码 + 事件：不同事件各算一次，同一条事件重复触发仍是一个桶。
          bucket: `${triggerReasonCode ?? 'signal'}:${run.eventGroupId}`,
          cutoff: deps.snapshot.asOf,
          summary: output.conclusion.summary,
          conclusionDirection: output.conclusion.direction,
          citedFactIds,
          ...(trigger.direction === undefined ? {} : { triggerDirection: trigger.direction }),
          ...(trigger.factIds === undefined ? {} : { triggerFactIds: trigger.factIds }),
          citedCount: output.evidenceRefs.length,
          occurredAt: deps.now
        })
      } catch {
        // 通知是记录的附加物：发不出去不许把一次成功的分析变成失败。
      }
    }
  }
})
