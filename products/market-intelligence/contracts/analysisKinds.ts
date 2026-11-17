/**
 * 一条解析属于哪条线。
 *
 * 两张存储表（`mi_analysis_runs` / `mi_analysis_summaries`）共用，列名是 `analysis_kind`——
 * 同一个库里 `mi_analysis_timeline.kind` 已经表示「初判 / 复核」，再叫一个 `kind` 会让同一个
 * 领域出现两个同名不同义的字段。闭集只在这里：SQLite 不能给既有表加 CHECK 而不重建，库上不设
 * 约束，由契约与写入校验守。
 *
 * 注意 `mi_analysis_timeline.kind` 的 `'analysis'` 与这里的 `'market'` 不是一回事，别互换。
 */
export const ANALYSIS_KINDS = Object.freeze(['market', 'news'] as const)

export type AnalysisKind = (typeof ANALYSIS_KINDS)[number]

/**
 * 写入侧缺类别的内部错误串。
 *
 * **不进** `MARKET_ANALYSIS_ERROR_CODES`，也不映射界面文案：它不是读者能采取动作的失败，
 * 而是「有一次写入忘了带类别」，正确做法是让那一次写入失败并留下可查的内部错误。
 */
export const ANALYSIS_KIND_MISSING_ERROR = 'storage-analysis-kind-missing'

export function isAnalysisKind(value: unknown): value is AnalysisKind {
  return typeof value === 'string' && (ANALYSIS_KINDS as readonly string[]).includes(value)
}

/**
 * 读侧的唯一归口：没有类别、类别不认识，一律读成市场分析。
 *
 * 只兜三类没有回填机会的行：旧归档还原回来的行、回退后由旧版写入的行、测试里模拟的旧行。
 * **写路径不许调用它**——新写入缺类别必须失败，静默落成 market 等于让一次遗忘变成今天的市场结论。
 */
export function analysisKindOf(value: Readonly<{ analysisKind?: unknown; analysis_kind?: unknown }> | null | undefined): AnalysisKind {
  if (!value) return 'market'
  // 列是存储事实，优先；归档记录只有载荷里的字段，退回它；两者都没有才是旧的 market 行。
  if (isAnalysisKind(value.analysis_kind)) return value.analysis_kind
  if (isAnalysisKind(value.analysisKind)) return value.analysisKind
  return 'market'
}
