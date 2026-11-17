import type { AnalysisSummary } from './marketAnalysisContracts'

/**
 * 落库摘要（`mi_analysis_summaries.payload_json`）序列化后会出现的顶层键。
 *
 * **来源是 `AnalysisSummary` 类型本身**：`Record<keyof AnalysisSummary, true>` 要求这里覆盖
 * 每一个键——类型加了字段而这里没加，`tsc` 当场红。读取端白名单守卫拿它比对，于是
 * 「落库时新增字段」不会再悄悄溜过去。
 *
 * 2026-11-18 的 P0：A 笔给摘要加了 `analysisKind`（服务端落库时加，模型不输出），
 * 而旧守卫只比对**模型输出**的顶层键（`analysisOutputTopLevelKeys`），所以恒真；
 * 读取端白名单没这个键，`isExactRecordWithOptionals` 判整条不可读，最新结论卡与详情
 * 同时显示「读取失败」。这套键表就是为堵这类「落库时新增、模型不输出」的字段。
 */
const SUMMARY_PERSISTED_KEY_COVERAGE: Readonly<Record<keyof AnalysisSummary, true>> = {
  id: true,
  schemaVersion: true,
  analysisKind: true,
  analysisRunId: true,
  proseLanguage: true,
  eventGroupId: true,
  version: true,
  eventAssessment: true,
  conclusion: true,
  newsInterpretation: true,
  knownFacts: true,
  transmissionHypotheses: true,
  marketReaction: true,
  supportingEvidence: true,
  counterEvidence: true,
  scenarios: true,
  directions: true,
  nextCatalysts: true,
  dataCaveats: true,
  evidenceRefs: true,
  createdAt: true
}

/** 摘要落库时会写进 `payload_json` 的全部顶层键（顺序即上面声明顺序）。 */
export const ANALYSIS_SUMMARY_PERSISTED_KEYS: readonly (keyof AnalysisSummary)[] = Object.freeze(
  Object.keys(SUMMARY_PERSISTED_KEY_COVERAGE) as (keyof AnalysisSummary)[]
)
