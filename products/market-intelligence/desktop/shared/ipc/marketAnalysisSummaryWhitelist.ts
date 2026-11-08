/**
 * 分析摘要载荷的**顶层键白名单**：服务侧能写什么、读取端必须认得什么。
 *
 * 为什么单独一个文件（而不是留在 `marketAnalysisTimelineClient` 里）：
 *
 * 1. **体积**：那个 client 已经是 570 行的基线文件，只能变小；白名单连注释搬出来，
 *    它不必为「多认一个键」这种契约跟进付行数。
 * 2. **唯一实现**：读取端（`sanitizeSummary`）与守卫用例都从这里读同一份，
 *    不允许 client 里一份、测试里再抄一份——手抄必然漂移，而漂移的代价是读者看到
 *    「这项数据暂时读不到」（2026-11-08 的事故：服务侧多写了可选的 `divergences`，
 *    读取端白名单没跟上，整条详情被判不可用）。
 *
 * 这里**不 import 服务侧模块**：渲染层打包不该被服务端依赖拖进来。守卫用例在测试里
 * 把服务侧常量传进来比较（`missingSummaryWhitelistKeys`），比较逻辑仍然只有这一份。
 */

/** 摘要载荷**必须**有的顶层键（信封字段 + 模型必填段）。 */
export const SUMMARY_REQUIRED_FIELDS = [
  'id', 'schemaVersion', 'analysisRunId', 'eventGroupId', 'version', 'knownFacts', 'transmissionHypotheses',
  'marketReaction', 'supportingEvidence', 'counterEvidence', 'scenarios', 'nextCatalysts', 'dataCaveats',
  'evidenceRefs', 'createdAt'
] as const

/**
 * 摘要在服务侧**可以不出现**的顶层键：`directions` / `eventAssessment`（旧版自由文本）/
 * `conclusion`（结构化结论）/ `divergences`（背离自我声明）。
 *
 * `divergences` 的口径（产品 2026-11-08）：**该字段进入分析结果，不进入详情渲染**——
 * 模型对某一对的判断与卡片上那条确定性判定是同一条事实的两个判断，详情再列一遍就是第二套说法；
 * 真要解释"这条背离不影响判断"，由结论正文那句话负责。冲突由分析侧硬校验拒收，界面不并列两种说法。
 * 但读取端**必须认得这个键**：认得 ≠ 渲染，这里只做到"有它不整条拒"。
 */
export const SUMMARY_OPTIONAL_FIELDS = ['directions', 'eventAssessment', 'conclusion', 'divergences'] as const

/** 白名单覆盖的键全集（读取端允许出现的全部顶层键）。 */
export const SUMMARY_ACCEPTED_FIELDS: ReadonlySet<string> = new Set<string>([
  ...SUMMARY_REQUIRED_FIELDS,
  ...SUMMARY_OPTIONAL_FIELDS
])

/**
 * 服务侧能持久化的键里，白名单还漏了哪些。
 *
 * 用例拿服务侧的常量传进来比较：**返回空数组才算对齐**，少一个键读者就可能看到「读不到」。
 */
export function missingSummaryWhitelistKeys(persistableKeys: readonly string[]): readonly string[] {
  return persistableKeys.filter((key) => !SUMMARY_ACCEPTED_FIELDS.has(key))
}
