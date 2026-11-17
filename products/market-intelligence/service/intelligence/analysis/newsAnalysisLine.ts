import { MARKET_ANALYSIS_CONTRACT_POLICY } from '../../../contracts/marketAnalysisContracts'
import type { AnalysisLine } from './analysisLineRegistry'
import { repairableRejection } from './analysisModelRepair'
import { validateAnalysisModelOutput } from './analysisOutputValidator'
import { buildAnalysisSummary } from './analysisRecordBuilders'
import { buildNewsAnalysisMessages } from './newsAnalysisPrompt'

/**
 * 新闻线（R39 §2 / B 笔过渡版）。
 *
 * 提示词与必答校验从市场线搬来（C 笔换成 `NewsInterpretation` 新契约与 13 条校验）。
 * 写库副作用与市场线不同：**没有**预测行、时间轴、组当前结论指针、会话摘要、推送——
 * 新闻解读只活在抽屉里，不进制读者看市场分析的任何一个面。
 *
 * `recordGroupPointer: false` 是必须的：组指针是「这个组当前的市场结论」，
 * `getWorkspaceBinding` 靠它绑工作区；一条新闻解读挂上去就会被当成市场分析。
 */
export const newsAnalysisLine: AnalysisLine = Object.freeze({
  analysisKind: 'news',
  promptVersion: 'news-analysis-v1',
  skillVersion: 'news-analysis-v1',
  outputSchemaVersion: MARKET_ANALYSIS_CONTRACT_POLICY.outputSchemaVersion,

  buildMessages(snapshot, significanceSignals, session, proseLanguage) {
    return buildNewsAnalysisMessages(snapshot, significanceSignals, session, proseLanguage)
  },

  validate(raw, evidence, focus) {
    return validateAnalysisModelOutput(raw, evidence, focus, { newsTriggerRules: true })
  },

  repairableRejections: repairableRejection,

  async persist(run, output, deps) {
    // 新闻组没有组指针可读，版本按行取最大；否则同一条新闻的第二次解读会撞唯一键。
    const version = (deps.repository.latestSummaryVersion?.(run.eventGroupId) ?? 0) + 1
    const summary = buildAnalysisSummary(run, output, version, deps.now, deps.idFactory, deps.proseLanguage)
    deps.repository.commitSuccessfulAnalysis({ runId: run.id, summary, predictions: [], recordGroupPointer: false })
  }
})
