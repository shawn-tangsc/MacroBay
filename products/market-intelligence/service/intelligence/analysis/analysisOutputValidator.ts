import {
  MARKET_ANALYSIS_ERROR_CODES,
  isMarketAnalysisFiniteNumber,
  type AnalysisDirectionHorizon,
  type AnalysisScenarioHorizon,
  type DirectionAdvice,
  type FactClaim,
  type Hypothesis,
  type ReactionClaim,
  type EvidenceClaim,
  type Catalyst,
  type Scenario,
  type AnalysisInvalidation,
  type AgentFact,
  type AnalysisConclusion,
  type SnapshotTrigger
} from '../../../contracts/marketAnalysisContracts'
import { isMarketReactionFact, marketAnalysisValidationPolicy } from './analysisConstants'
import { containsUnsafeOutput, formatUnsafeOutputRedaction, isPlainRecord, redactUnsafeOutput, utf8Length, type AnalysisOutputRedaction } from './analysisOutputRedaction'
export { formatUnsafeOutputRedaction } from './analysisOutputRedaction'
export type { AnalysisOutputRedaction } from './analysisOutputRedaction'
import { missingTriggerFocus, type TriggerFocus } from './analysisTriggerFocus'
import { analysisNewsImpactRules, isAnalysisNewsImpact, newsImpactDefectOf } from './analysisNewsImpactValidation'

import { policyProbabilityDefect, untracedProsePercentageDefect, type AnalysisProbabilityDefect } from './analysisProbabilityCitation'
import { buildAnalysisReferenceMap, resolveAnalysisReferences } from './analysisReferenceHandles'
import {
  divergenceDefectOf,
  isAnalysisDivergenceBlock,
  type AnalysisDivergenceStance
} from './analysisDivergenceConsistency'

export type FrozenAnalysisEvidence = Readonly<{
  facts: readonly Pick<AgentFact, 'factId' | 'evidenceRefId' | 'metric' | 'domain' | 'subject' | 'comparability' | 'freshness' | 'value' | 'observedAt'>[]
  evidenceRefs: readonly Pick<EvidenceClaim, 'evidenceRefId'>[]
  /**
   * 变更摘要里**印给模型看过**的百分数（第二个集合，架构师 2026-11-11）。
   *
   * 只供「正文里的数字有没有出处」这条规则读：背离配对、触发器焦点、`hasKnownReferences` 都看不到它。
   * 不并进 `facts`——合成事实会多出不存在的 factId，并让同一个 metric 前后出现两条。
   */
  changeValues?: readonly number[]
  /** 触发指针（R37）：只有舆情触发的运行才有；新闻解读的必答校验读它。 */
  trigger?: SnapshotTrigger
}>

/** 背离立场块的形状与判定在 `analysisDivergenceConsistency`（体积门禁要求抽离）；类型从这里照旧导出。 */
export type { AnalysisDivergenceStance }

export type ValidatedAnalysisModelOutput = Readonly<{
  conclusion: AnalysisConclusion
  knownFacts: readonly FactClaim[]
  transmissionHypotheses: readonly Hypothesis[]
  marketReaction: readonly ReactionClaim[]
  supportingEvidence: readonly EvidenceClaim[]
  counterEvidence: readonly EvidenceClaim[]
  scenarios: readonly Scenario[]
  directions: readonly DirectionAdvice[]
  nextCatalysts: readonly Catalyst[]
  dataCaveats: readonly string[]
  evidenceRefs: readonly string[]
  /** 可选的背离立场；不写就是"没有意见"，不参与任何判定。 */
  divergences?: readonly AnalysisDivergenceStance[]
}>

/** A value that matched a prohibited pattern, named so the failure is diagnosable. */
/**
 * Which rule rejected an output.
 *
 * All three used to report the same `analysis-missing-evidence`, so a rejection could not be told
 * apart from a genuinely missing source: the reader was told to check intelligence sources when
 * the model had, say, attached a second evidence id to a fact claim. The rule is recorded as the
 * run's failure detail and printed as a diagnostic marker, and the prompt now states each rule
 * the model can actually break.
 */
export const analysisValidationRules = Object.freeze({
  unknownReference: 'unknown-reference',
  factEvidenceMismatch: 'fact-evidence-mismatch',
  ineligibleMarketReaction: 'ineligible-market-reaction',
  /** The three operation horizons are not all present, or one of them repeats. */
  directionHorizonsIncomplete: 'direction-horizons-incomplete',
  /** An operation direction cites evidence this snapshot does not hold. */
  directionEvidenceMismatch: 'direction-evidence-mismatch',
  /**
   * The snapshot carries key sentiment, but the conclusion cites none of it.
   *
   * The list is appended on purpose: a conclusion that ignores it cannot be said to have weighed
   * it. Requiring one citation keeps the requirement checkable instead of prompt-only.
   */
  sentimentNotWeighed: 'sentiment-not-weighed',
  /**
   * A policy probability in the conclusion must be traceable: the same value in the frozen snapshot,
   * cited with that fact's own as-of at minute precision. A percentage near "概率/定价" that no
   * policy fact carries is a fabricated number, not a rounding difference.
   */
  policyProbabilityCitation: 'policy-probability-citation',
  /**
   * 任意散文段落里的一个百分数在冻结快照里找不到出处（情景、传导假设、催化剂、方向理由都算）。
   * 判据是数，不读句子：不因措辞拒，也不因「看起来像估算」放行。
   */
  proseNumberCitation: 'prose-number-citation',
  /**
   * The conclusion never returned to the change that triggered the run: it cites something else and
   * talks about the background. Coarse code stays `analysis-missing-evidence`, which is already in
   * the repairable set, so the model gets its one rewrite; the detail names this rule.
   */
  triggerFocus: 'missing-trigger-focus',
  // 触发型分析的必答块（R37 C）：判据与理由写在 `analysisNewsImpactValidation`，这里只列码。
  newsTriggerNotCited: 'news-trigger-not-cited',
  newsImpactInsufficientData: 'news-impact-insufficient-data',
  newsImpactContradictionMismatch: 'news-impact-contradiction-mismatch',
  newsImpactInvalidation: 'news-impact-invalidation',
  newsImpactMissingState: 'news-impact-missing-state',
  newsImpactUnchecked: 'news-impact-unchecked',
  /**
   * 失效条件引用了一个快照里不存在的 id 或时刻（例如「跌破支撑」这种没有事实出处的价位）。
   * 判据是数据：factId 在快照事实里、at 在快照的时刻里；不读那句话怎么写。
   */
  invalidationReference: 'invalidation-not-in-snapshot',
  /**
   * 分析的背离结论与快照里已有的事实相反（`02` 系统设计 §校验规则）。
   *
   * 与 `direction-evidence-mismatch` **不合并**：那条管"引用了不存在的证据"，修法是把引用补成
   * 存在的那个；这条管"结论与已有证据相反"，修法是改判断。合成一个码，模型会去补一个根本不存在的引用。
   */
  divergenceContradiction: 'divergence-contradiction'
})

export type AnalysisValidationRule = typeof analysisValidationRules[keyof typeof analysisValidationRules]

/**
 * A shape rejection names the part of the contract the model missed.
 *
 * The five behaviours above are rules about meaning; a section or a missing top-level key is a
 * formatting defect. Both used to arrive as the same coarse `analysis-invalid-output-schema`
 * with no detail, so a rejected run could not be told from any other — the run row now keeps
 * `shape:<section>` or `shape:top-level:<missing/extra keys>` for the next investigation.
 */
export type AnalysisShapeDefect = `shape:${string}`


export type AnalysisOutputValidationResult =
  | Readonly<{ ok: true; value: ValidatedAnalysisModelOutput; redactions: readonly AnalysisOutputRedaction[] }>
  | Readonly<{ ok: false; errorCode: typeof MARKET_ANALYSIS_ERROR_CODES.invalidJson | typeof MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema | typeof MARKET_ANALYSIS_ERROR_CODES.missingEvidence | typeof MARKET_ANALYSIS_ERROR_CODES.unsafeOutput; rule?: AnalysisValidationRule | AnalysisShapeDefect; detail?: AnalysisProbabilityDefect | string }>

function missingEvidence(rule: AnalysisValidationRule, detail?: AnalysisProbabilityDefect | string): AnalysisOutputValidationResult {
  return { ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence, rule, ...(detail ? { detail } : {}) }
}

/**
 * 模型输出里**允许出现、并会被持久化**的顶层键（`divergences` 可选，其余必须）。
 *
 * 导出是因为读取端的白名单必须与它逐字对齐：渲染层少认一个键，整条详情就变「暂不可用」
 * （2026-11-08 的事故就是 `divergences` 不在读取端白名单里）。守卫用例直接读这一个常量，
 * 不在测试里手抄第二份。
 */
export const analysisOutputTopLevelKeys = [
  'conclusion', 'knownFacts', 'transmissionHypotheses', 'marketReaction', 'supportingEvidence', 'counterEvidence',
  'scenarios', 'directions', 'nextCatalysts', 'dataCaveats', 'evidenceRefs', 'divergences'
] as const

const outputKeys = analysisOutputTopLevelKeys

/**
 * 这些键必须出现；`divergences` **可选**——沉默不算相反，逼着模型表态等于逼它点头
 * （`04-ai-analysis-inclusion.md` 的政策句）。
 */
const requiredOutputKeys = outputKeys.filter((key) => key !== 'divergences')

/**
 * One predicate per top-level section, checked in contract order.
 *
 * The first failing section is what the run row records; without it every formatting defect was
 * the same code and a rejected run could not be investigated from its record.
 */
const outputSections: readonly (readonly [string, (value: unknown) => boolean])[] = [
  ['conclusion', isConclusion],
  ['knownFacts', isFactClaims],
  ['transmissionHypotheses', isHypotheses],
  ['marketReaction', isReactionClaims],
  ['supportingEvidence', isEvidenceClaims],
  ['counterEvidence', isEvidenceClaims],
  ['scenarios', isScenarios],
  ['directions', isDirections],
  ['nextCatalysts', isCatalysts],
  ['dataCaveats', isBoundedTextCollection],
  ['evidenceRefs', isNonEmptyStringCollection]
]

/**
 * The conclusion as data: a language-neutral direction key plus prose fields. No markers, no
 * section labels, nothing to parse — which is why adding another reader language costs nothing here.
 */
function isConclusion(value: unknown): value is AnalysisConclusion {
  if (!isPlainRecord(value)) return false
  if (!hasExactKeys(value, ['direction', 'summary', 'change', 'causalChain', 'conditions', 'macro', 'evidenceStrength', 'dataGaps'], ['newsImpact'])) return false
  return isDirectionKey(value.direction)
    && isBoundedText(value.summary)
    && isBoundedText(value.change)
    && isBoundedText(value.causalChain)
    && isBoundedTextCollection(value.conditions)
    && (value.macro === null || isBoundedText(value.macro))
    && (value.evidenceStrength === null || isBoundedText(value.evidenceStrength))
    && isBoundedTextCollection(value.dataGaps)
    // 触发型分析的必答块（R37）：只在这里判形状；「有指针就必须写」是规则层的事（C 笔）。
    && (value.newsImpact === undefined || isAnalysisNewsImpact(value.newsImpact))
}

function isDirectionKey(value: unknown): value is AnalysisConclusion['direction'] {
  return typeof value === 'string'
    && (marketAnalysisValidationPolicy.analysisDirectionKeys as readonly string[]).includes(value)
}

/**
 * Which of the eleven top-level keys the model got wrong, named so the run row can say it.
 *
 * `hasExactKeys` answers only true/false; a rejected run therefore carried no fact about what was
 * missing. The name is bounded to the contract's own keys, never to model text.
 */
function topLevelShapeDefect(value: unknown): AnalysisShapeDefect | undefined {
  if (!isPlainRecord(value)) return 'shape:not-an-object'
  const present = Object.keys(value)
  const missing = requiredOutputKeys.filter((key) => !Object.prototype.hasOwnProperty.call(value, key))
  const extra = present.filter((key) => !(outputKeys as readonly string[]).includes(key))
  // `divergences` 可缺省；其余十一个必须齐，且不许有多余键。
  if (missing.length === 0 && extra.length === 0 && present.length <= outputKeys.length) return undefined
  const details = [
    ...missing.map((key) => `missing-${key}`),
    ...extra.slice(0, 5).map((key) => `extra-${key}`)
  ]
  return `shape:top-level:${details.join(',') || 'unknown'}`
}

/**
 * `newsTriggerRules`：触发型必答块是否参与校验（R39 §2「校验按线取」）。
 *
 * 市场线传 `false`——它不看触发指针，也不该被「没回答那条新闻」拒收；新闻线传 `true`
 * （默认值，保持既有调用方行为）。`missingTriggerFocus` 不在此列：它是「回答了 change 吗」，
 * 市场线仍然要过。
 */
export function validateAnalysisModelOutput(input: string, snapshot: FrozenAnalysisEvidence, focus?: TriggerFocus,
  options: Readonly<{ newsTriggerRules?: boolean }> = {}): AnalysisOutputValidationResult {
  if (utf8Length(input) > marketAnalysisValidationPolicy.maximumOutputBytes) return invalidSchema('shape:too-large')

  let value: unknown
  try {
    value = JSON.parse(input)
  } catch {
    return { ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidJson }
  }
  const topLevelDefect = topLevelShapeDefect(value)
  if (topLevelDefect) return invalidSchema(topLevelDefect)
  // A prohibited pattern is removed in place and recorded rather than failing the
  // whole run. Rejecting everything made a usable conclusion disappear because the
  // model cited a URL, and it left no record of what triggered the rule.
  const { value: safeValue, redactions } = redactUnsafeOutput(value)
  value = safeValue

  // `hasExactKeys` already established the shape, so the record fields are safe to read.
  const record = value as Record<string, unknown>
  const broken = outputSections.find(([key, valid]) => !valid(record[key]))
  if (broken) return invalidSchema(`shape:${broken[0]}`)
  if (record.divergences !== undefined && !isAnalysisDivergenceBlock(record.divergences, marketAnalysisValidationPolicy.maximumCollectionItems)) return invalidSchema('shape:divergences')

  const factIds = new Set(snapshot.facts.map((fact) => fact.factId))
  const evidenceRefIds = new Set(snapshot.evidenceRefs.map((evidence) => evidence.evidenceRefId))
  // The model quotes short handles (`f12`, `e7`) instead of transcribing the stored encodings; the
  // real ids are put back before any reference rule runs, so what is validated and published is
  // exactly what the snapshot holds.
  const output = resolveAnalysisReferences(record as unknown as ValidatedAnalysisModelOutput, buildAnalysisReferenceMap(snapshot))
  // Every horizon must be answered for: a conclusion that speaks for one day and stays silent
  // about the month is not the answer the reader asked for, and the rule names itself so a
  // rejection is diagnosable.
  if (!hasCompleteDirectionHorizons(output.directions)) return invalidSchema(analysisValidationRules.directionHorizonsIncomplete)
  // The directions are checked first and by name: "the month's direction cites evidence this
  // snapshot does not hold" is a different defect from "some claim cites an unknown reference", and
  // the shared code alone could not tell them apart.
  if (!output.directions.flatMap(entry => entry.evidenceRefIds).every(reference => evidenceRefIds.has(reference))) {
    return missingEvidence(analysisValidationRules.directionEvidenceMismatch)
  }
  if (!hasKnownReferences(output, factIds, evidenceRefIds)) return missingEvidence(analysisValidationRules.unknownReference)
  const evidenceByFact = new Map(snapshot.facts.map(fact => [fact.factId, fact.evidenceRefId]))
  const matchesFacts = (ids: readonly string[], refs: readonly string[]): boolean => {
    const expected = ids.map(id => evidenceByFact.get(id))
    return expected.every(ref => !!ref && refs.includes(ref)) && refs.every(ref => expected.includes(ref))
  }
  if (!output.knownFacts.every(claim => matchesFacts([claim.factId], claim.evidenceRefIds)) ||
    !output.marketReaction.every(claim => matchesFacts(claim.factIds, claim.evidenceRefIds))) return missingEvidence(analysisValidationRules.factEvidenceMismatch)
  const reactionFactIds = new Set(snapshot.facts.filter(isMarketReactionFact).map(fact => fact.factId))
  if (!output.marketReaction.every(claim => claim.factIds.every(id => reactionFactIds.has(id)))) return missingEvidence(analysisValidationRules.ineligibleMarketReaction)
  // 重点舆情是本次分析必须权衡的输入：至少一条实质性论证要引用它，否则「带上了」只是 prompt 里的
  // 一句话。只认论证区（事实、支撑/反向证据、方向、催化剂、传导假设），不认顶层 evidenceRefs 清单。
  const sentimentRefs = new Set(snapshot.facts.filter(fact => fact.metric === 'news-sentiment' && fact.evidenceRefId).map(fact => fact.evidenceRefId!))
  // 论证区引用（事实、传导、支撑/反向、方向、催化剂）：不是顶层 evidenceRefs 清单——那份是登记。
  const citedEvidence = new Set([
    ...output.knownFacts.flatMap(claim => claim.evidenceRefIds),
    ...output.transmissionHypotheses.flatMap(claim => claim.evidenceRefIds),
    ...output.supportingEvidence.map(claim => claim.evidenceRefId),
    ...output.counterEvidence.map(claim => claim.evidenceRefId),
    ...output.directions.flatMap(entry => entry.evidenceRefIds),
    ...output.nextCatalysts.flatMap(claim => claim.evidenceRefIds)
  ])
  if (sentimentRefs.size > 0 && ![...sentimentRefs].some(ref => citedEvidence.has(ref))) {
    return missingEvidence(analysisValidationRules.sentimentNotWeighed)
  }
  // 背离立场（`02` 系统设计 §背离一致性）：只判**说出来的**那些对——不写就是没意见。
  // 与证据相反即拒；pairId 认不出来是引用缺陷（不许就地编一对）。
  const divergenceDefect = divergenceDefectOf(output.divergences, snapshot.facts)
  if (divergenceDefect === 'unknown-pair') return missingEvidence(analysisValidationRules.unknownReference)
  if (divergenceDefect === 'contradiction') return missingEvidence(analysisValidationRules.divergenceContradiction)
  const probabilityDefect = policyProbabilityDefect(output.conclusion, snapshot)
  if (probabilityDefect) return missingEvidence(analysisValidationRules.policyProbabilityCitation, probabilityDefect)
  // 同一条判据扩到**所有会印数字的段落**：只验 conclusion 时，情景与方向理由里的编造数没人管。
  const proseNumberDefect = untracedProsePercentageDefect(output, snapshot)
  if (proseNumberDefect) return missingEvidence(analysisValidationRules.proseNumberCitation, proseNumberDefect)
  // 失效条件只许引用快照里真的有的东西：一条事实 id，或事实/快照上的一个时刻。
  if (!scenarioInvalidationsReferToSnapshot(output.scenarios, snapshot)) {
    return missingEvidence(analysisValidationRules.invalidationReference)
  }
  // Only when the caller could resolve a trigger source; a snapshot with no change record never
  // ran this rule and must not be judged by it.
  if (focus && missingTriggerFocus(output, focus)) return missingEvidence(analysisValidationRules.triggerFocus)
  // R37 C：触发型分析的必答块；只比 id 与结构，没有触发指针时不管。规则码由模块定义，这里不重抄。
  // 市场线显式关掉这一段（R39）：它不读触发指针，不该被新闻线的必答块拒收。
  if (options.newsTriggerRules !== false) {
    const newsImpactDefect = newsImpactDefectOf({ output: { conclusion: output.conclusion }, snapshot, focus, reasoningEvidenceRefIds: citedEvidence })
    if (newsImpactDefect) return missingEvidence(newsImpactDefect.rule as AnalysisValidationRule, newsImpactDefect.detail)
  }

  return { ok: true, value: output, redactions }
}

export function formatMarketAnalysisAcceptanceMarker(details: Readonly<{
  valid: number
  rejectedUnsafe: number
  rejectedMissingEvidence: number
}>): string {
  return JSON.stringify({
    marker: 'MI_ANALYSIS_ACCEPTANCE',
    package: 'MI-A01',
    event: 'output-validator',
    status: 'pass',
    details
  })
}

/** A shape rejection, optionally naming the rule so the run's failure detail is diagnosable. */
function invalidSchema(rule?: AnalysisValidationRule | AnalysisShapeDefect): AnalysisOutputValidationResult {
  return { ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema, ...(rule ? { rule } : {}) }
}

function hasExactKeys(value: unknown, keys: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  const present = Object.keys(value)
  // 必填键一个不能少、可选键一个不能多：多出的键就是模型自造的字段，落库后没人读得懂。
  if (present.length < keys.length || present.length > keys.length + optional.length) return false
  if (!keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) return false
  return present.every((key) => keys.includes(key) || optional.includes(key))
}

function isFactClaims(value: unknown): value is FactClaim[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['factId', 'statement', 'evidenceRefIds']) &&
    isBoundedText(item.factId) && isBoundedText(item.statement) && isNonEmptyStringCollection(item.evidenceRefIds))
}

function isHypotheses(value: unknown): value is Hypothesis[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['statement', 'evidenceRefIds']) &&
    isBoundedText(item.statement) && isNonEmptyStringCollection(item.evidenceRefIds))
}

function isReactionClaims(value: unknown): value is ReactionClaim[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['statement', 'factIds', 'evidenceRefIds']) &&
    isBoundedText(item.statement) && isNonEmptyStringCollection(item.factIds) && isNonEmptyStringCollection(item.evidenceRefIds))
}

function isEvidenceClaims(value: unknown): value is EvidenceClaim[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['statement', 'evidenceRefId']) &&
    isBoundedText(item.statement) && isBoundedText(item.evidenceRefId))
}

function isScenarios(value: unknown): value is Scenario[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['asset', 'horizon', 'baseCase', 'conditions', 'invalidation', 'status']) &&
    (item.asset === 'BTC' || item.asset === 'ETH') &&
    isScenarioHorizon(item.horizon) &&
    isBoundedText(item.baseCase) &&
    isBoundedTextCollection(item.conditions) && item.conditions.length > 0 &&
    isInvalidation(item.invalidation) && item.status === marketAnalysisValidationPolicy.modelPredictionStatus)
}

/**
 * 失效条件的新结构：引用一条快照事实（factId + 方向）或快照里的一个时刻（at）。
 *
 * 句子（statement）必须有，但**不参与校验**；旧记录里的字符串在这一层不认——那是存储兼容，
 * 新生成的输出必须给结构，否则「跌破支撑」这种快照里没有的价位就又会进来。
 */
function isInvalidation(value: unknown): value is AnalysisInvalidation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.kind === 'fact') {
    return hasExactKeys(record, ['kind', 'factId', 'relation', 'statement']) &&
      isBoundedText(record.factId) && (record.relation === 'below' || record.relation === 'above') && isBoundedText(record.statement)
  }
  if (record.kind === 'instant') {
    return hasExactKeys(record, ['kind', 'at', 'statement']) && isCanonicalInstant(record.at) && isBoundedText(record.statement)
  }
  return false
}

/**
 * 失效条件只能引用**快照里真的有**的东西：一条事实 id，或事实/快照上的一个时刻。
 * 只比数据，不读句子。
 */
function scenarioInvalidationsReferToSnapshot(scenarios: readonly Scenario[], snapshot: FrozenAnalysisEvidence): boolean {
  const factIds = new Set(snapshot.facts.map(fact => fact.factId))
  const instants = new Set<string>()
  for (const fact of snapshot.facts) {
    if (typeof fact.observedAt === 'string') instants.add(fact.observedAt)
  }
  return scenarios.every(scenario => {
    const invalidation = scenario.invalidation
    if (typeof invalidation === 'string') return false
    return invalidation.kind === 'fact' ? factIds.has(invalidation.factId) : instants.has(invalidation.at)
  })
}

/** 严格 ISO 时刻（UTC、毫秒）：与快照里存的形状一致，写错一位就是没出处。 */
function isCanonicalInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
}

/**
 * One entry per horizon, in the five terms the panel already colours, with a rationale and the
 * evidence it rests on. Shape only: the horizon set is checked separately so a missing horizon gets
 * its own failure detail instead of a generic schema rejection.
 */
function isDirections(value: unknown): value is DirectionAdvice[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['horizon', 'direction', 'rationale', 'confidence', 'evidenceRefIds']) &&
    isDirectionHorizon(item.horizon) &&
    isDirectionKey(item.direction) &&
    isBoundedText(item.rationale) &&
    typeof item.confidence === 'string' && (marketAnalysisValidationPolicy.directionConfidences as readonly string[]).includes(item.confidence) &&
    isNonEmptyStringCollection(item.evidenceRefIds))
}

function hasCompleteDirectionHorizons(directions: readonly DirectionAdvice[]): boolean {
  const horizons = directions.map(entry => entry.horizon)
  return horizons.length === marketAnalysisValidationPolicy.directionHorizons.length &&
    new Set(horizons).size === horizons.length &&
    marketAnalysisValidationPolicy.directionHorizons.every(horizon => horizons.includes(horizon))
}

function isCatalysts(value: unknown): value is Catalyst[] {
  return isBoundedCollection(value) && value.every((item) => hasExactKeys(item, ['statement', 'evidenceRefIds']) &&
    isBoundedText(item.statement) && isNonEmptyStringCollection(item.evidenceRefIds))
}

/**
 * A policy probability quoted in the conclusion must be checkable against the frozen snapshot.
 *
 * The rule is intentionally narrow: only the probability metric is policed, because the other
 * policy facts (a range, a vote, a SEP path) are protected by the prompt and by their own display
 * rules. Every percentage in the conclusion that equals a frozen probability must be accompanied by
 * that fact's `observedAt` at minute precision; a percentage next to 「概率」 or 「定价」 that no
 * policy fact carries is rejected as an invented number.
 */
function hasKnownReferences(output: ValidatedAnalysisModelOutput, factIds: ReadonlySet<string>, evidenceRefIds: ReadonlySet<string>): boolean {
  const referencedFactIds = [
    ...output.knownFacts.map((claim) => claim.factId),
    ...output.marketReaction.flatMap((claim) => claim.factIds)
  ]
  const referencedEvidenceIds = [
    ...output.knownFacts.flatMap((claim) => claim.evidenceRefIds),
    ...output.transmissionHypotheses.flatMap((claim) => claim.evidenceRefIds),
    ...output.marketReaction.flatMap((claim) => claim.evidenceRefIds),
    ...output.supportingEvidence.map((claim) => claim.evidenceRefId),
    ...output.counterEvidence.map((claim) => claim.evidenceRefId),
    ...output.nextCatalysts.flatMap((claim) => claim.evidenceRefIds),
    ...output.directions.flatMap(entry => entry.evidenceRefIds),
    ...output.evidenceRefs
  ]
  return referencedFactIds.every((reference) => factIds.has(reference)) &&
    referencedEvidenceIds.every((reference) => evidenceRefIds.has(reference))
}

function isDirectionHorizon(value: unknown): value is AnalysisDirectionHorizon {
  return typeof value === 'string' && (marketAnalysisValidationPolicy.directionHorizons as readonly string[]).includes(value)
}

function isScenarioHorizon(value: unknown): value is AnalysisScenarioHorizon {
  return typeof value === 'string' && (marketAnalysisValidationPolicy.scenarioHorizons as readonly string[]).includes(value)
}

function isBoundedCollection(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length <= marketAnalysisValidationPolicy.maximumCollectionItems
}

function isStringCollection(value: unknown): value is string[] {
  return isBoundedCollection(value) && value.every(isBoundedText)
}

function isNonEmptyStringCollection(value: unknown): value is string[] {
  return isStringCollection(value) && value.length > 0
}

function isBoundedTextCollection(value: unknown): value is string[] {
  return isStringCollection(value)
}

function isBoundedText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= marketAnalysisValidationPolicy.maximumFieldCharacters
}
