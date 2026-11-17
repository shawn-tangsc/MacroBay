import type { AnalysisConclusionDirection } from './marketAnalysisContracts'

/**
 * 新闻线（R39 C）的内部契约。
 *
 * `schemaVersion` **按 kind 各自编号**：它和市场的 3 不是一个序列，读侧按
 * `(analysisKind, schemaVersion)` 解释，不比较两个数的大小。
 *
 * 读者只看得到三段正文（抽屉只读 `conclusion.summary / change / causalChain`），
 * 这里的 `what / reading / outlook` 是服务侧自用契约：校验、审计、将来换渲染都靠它，
 * 但不进渲染层。落库映射由 `toSummaryParagraphs(record)` 一个函数完成。
 */
export type NewsInterpretationStance = 'bullish' | 'bearish' | 'neutral'
export type NewsInterpretationCheckEffect = 'supports' | 'contradicts' | 'unrelated'
export type NewsInterpretationVerdict = NewsInterpretationCheckEffect
export type NewsInterpretationGapItem = 'amount' | 'symbol' | 'time' | 'market-data'
export type NewsInterpretationGapState = 'not-yet' | 'source-empty' | 'unreadable'
export type NewsInterpretationRefKind = 'calendar' | 'fact'

export type NewsInterpretationCheck = Readonly<{
  evidenceRefId: string
  effect: NewsInterpretationCheckEffect
  /** 读者读到的读数句；`observedAtText` 原串必须出现在这句里（第二段由它拼成）。 */
  statement: string
}>

export type NewsInterpretationWatchRef = Readonly<{
  refKind: NewsInterpretationRefKind
  /** factRef（事实）或日历事实的 factId；校验时必须在快照里指得到。 */
  ref: string
}>

export type NewsInterpretationInvalidation =
  | Readonly<{ refKind: 'fact'; factId: string }>
  | Readonly<{ refKind: 'instant'; at: string }>

export type NewsInterpretationGap = Readonly<{
  item: NewsInterpretationGapItem
  state: NewsInterpretationGapState
  /** 读者读到的「缺哪一项、何时能判断」；第二段由它补一句。 */
  note?: string
}>

export type NewsInterpretationRecord = Readonly<{
  analysisKind: 'news'
  schemaVersion: 1
  id: string
  runId: string
  itemId: string
  createdAt: string
  proseLanguage?: 'zh-CN' | 'en-US'
  what: Readonly<{
    /** 触发这条解读的新闻证据：必须等于快照触发指针的 evidenceRefId。 */
    evidenceRefId: string
    actor: string
    action: string
    whyRelated: string
    stance: NewsInterpretationStance
  }>
  reading: Readonly<{
    checks: readonly NewsInterpretationCheck[]
    contradiction: boolean
    verdict: NewsInterpretationVerdict
  }>
  outlook: Readonly<{
    direction: AnalysisConclusionDirection
    /** 第三段正文：方向 → 机制 → 盯什么 → 作废条件。 */
    mechanism: string
    watchFor: readonly NewsInterpretationWatchRef[]
    invalidation: NewsInterpretationInvalidation
  }>
  gaps: readonly NewsInterpretationGap[]
}>

/** 模型产出的结构化正文之外的部分：身份字段由写入侧补。 */
export type NewsInterpretationBody = Pick<
  NewsInterpretationRecord, 'analysisKind' | 'schemaVersion' | 'what' | 'reading' | 'outlook' | 'gaps'
>

/**
 * 三段正文（落库字段与抽屉渲染位）。
 *
 * 映射只有一个实现：`newsValidation.toSummaryParagraphs`。三段的顺序由字段承载，
 * 不靠界面排；落库前三段都必须非空——空段会被渲染侧静默丢掉，等于少一段。
 */
export type NewsInterpretationParagraphs = Readonly<{
  summary: string
  change: string
  causalChain: string
}>

export const NEWS_INTERPRETATION_STANCES: readonly NewsInterpretationStance[] = ['bullish', 'bearish', 'neutral']
export const NEWS_INTERPRETATION_EFFECTS: readonly NewsInterpretationCheckEffect[] = ['supports', 'contradicts', 'unrelated']
export const NEWS_INTERPRETATION_GAP_ITEMS: readonly NewsInterpretationGapItem[] = ['amount', 'symbol', 'time', 'market-data']
export const NEWS_INTERPRETATION_GAP_STATES: readonly NewsInterpretationGapState[] = ['not-yet', 'source-empty', 'unreadable']
