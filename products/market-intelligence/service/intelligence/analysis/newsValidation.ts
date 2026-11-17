import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'

import type { AgentFact, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_MACRO_CALENDAR_FACT_METRICS } from '../../../contracts/marketAnalysisContracts'
import {
  NEWS_INTERPRETATION_EFFECTS, NEWS_INTERPRETATION_GAP_ITEMS, NEWS_INTERPRETATION_GAP_STATES,
  NEWS_INTERPRETATION_STANCES,
  type NewsInterpretationBody, type NewsInterpretationCheck, type NewsInterpretationInvalidation,
  type NewsInterpretationParagraphs, type NewsInterpretationRecord, type NewsInterpretationStance
} from '../../../contracts/newsInterpretationContracts'
import { MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisReferenceMap } from './analysisReferenceHandles'
import { untracedProsePercentageDefect, type AnalysisProbabilityDefect } from './analysisProbabilityCitation'

/**
 * 新闻线必答校验（R39 §4.3，13 条）。
 *
 * 全部只读 id 与结构：引用是不是快照里的、读数是不是市场事实、两条读数是否重复、矛盾是否
 * 说成矛盾、方向/盯什么/作废条件指不指得到、第二段是否逐字包含了每条被引用事实的
 * `observedAtText`、每个百分数是否有快照出处。
 *
 * **不读句子、不解析时刻。** 唯一跟正文有关的两条都是「字符串逐字来自输入」的事实比对：
 * `news-check-time-missing` 只问第二段有没有那个原串，`news-number-not-in-snapshot` 只问数字
 * 有没有出处。写一个自然语言时间解析器是被禁止的那类校验——写法一变就误拒。
 */
export const newsInterpretationRules = Object.freeze({
  whatMissing: 'news-what-missing',
  stanceInvalid: 'news-stance-invalid',
  citationMissing: 'news-citation-missing',
  checksTooFew: 'news-checks-too-few',
  checkNotMarket: 'news-check-not-market',
  checkNotInSnapshot: 'news-check-not-in-snapshot',
  checkDuplicated: 'news-check-duplicated',
  contradictionMismatch: 'news-contradiction-mismatch',
  verdictMismatch: 'news-verdict-mismatch',
  watchUnresolvable: 'news-watch-unresolvable',
  invalidationUnresolvable: 'news-invalidation-unresolvable',
  checkTimeMissing: 'news-check-time-missing',
  numberNotInSnapshot: 'news-number-not-in-snapshot'
} as const)

export type NewsInterpretationRule = (typeof newsInterpretationRules)[keyof typeof newsInterpretationRules]

export type NewsValidationContext = Readonly<{
  /** 读者设置时区：与界面同一个格式化函数（`formatShellInstant`）算出 `observedAtText`。 */
  timeZone: string
  proseLanguage?: 'zh-CN' | 'en-US'
}>

/** 校验只需要事实的这几个字段（`FrozenAnalysisEvidence` 的投影正好覆盖它们）。 */
type NewsValidationSnapshot = Readonly<{
  facts: readonly Pick<AgentFact, 'factId' | 'evidenceRefId' | 'metric' | 'domain' | 'observedAt' | 'value'>[]
  evidenceRefs: readonly Readonly<{ evidenceRefId: string }>[]
  trigger?: EvidenceSnapshot['trigger']
}>

export type NewsValidationResult =
  | Readonly<{
    ok: true
    value: NewsInterpretationBody
    paragraphs: NewsInterpretationParagraphs
    redactions: readonly []
  }>
  | Readonly<{ ok: false; errorCode: string; rule?: string; detail?: string; redactions: readonly [] }>

/** 模型面向的载荷：引用写短句柄（f## / e##），与市场提示词同一套。 */
type NewsModelOutput = Readonly<{
  what: Readonly<{ evidenceRef: string; actor: string; action: string; whyRelated: string; stance: string }>
  reading: Readonly<{
    checks: readonly Readonly<{ evidenceRef: string; effect: string; statement: string }>[]
    contradiction: boolean
    verdict: string
  }>
  outlook: Readonly<{
    direction: string
    mechanism: string
    watchFor: readonly Readonly<{ refKind: string; ref: string }>[]
    invalidation: Readonly<{ refKind: string; factRef?: string; at?: string }>
  }>
  gaps: readonly Readonly<{ item: string; state: string; note?: string }>[]
}>

/**
 * 三段正文的唯一映射：`what → summary`、`reading → change`、`outlook.mechanism → causalChain`。
 *
 * 三个字段各自就是读者句子（提示词要求），这里只做去空与拼接——不替换词、不补模板，
 * 所以不存在「服务端另写一份正文」和「界面看到的和校验比的不是一回事」两种可能。
 * `gaps` 的 `note` 补进第二段：一条解读缺什么，读者要在第二段看到。
 */
export function toSummaryParagraphs(record: Pick<NewsInterpretationRecord, 'what' | 'reading' | 'outlook' | 'gaps'>): NewsInterpretationParagraphs {
  const join = (parts: readonly (string | undefined)[]): string => parts.map(part => part?.trim() ?? '').filter(Boolean).join('')
  return {
    summary: join([record.what.actor, record.what.action, record.what.whyRelated]),
    change: join([...record.reading.checks.map(check => check.statement), ...record.gaps.map(gap => gap.note)]),
    causalChain: record.outlook.mechanism.trim()
  }
}

export function validateNewsInterpretation(
  raw: string,
  snapshot: NewsValidationSnapshot,
  context: NewsValidationContext
): NewsValidationResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fail(MARKET_ANALYSIS_ERROR_CODES.invalidJson)
  }
  const shape = readModelOutput(parsed)
  if (typeof shape === 'string') return fail(MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema, `news-shape:${shape}`)
  const body = resolveBody(shape, snapshot)
  return validateBody(body, snapshot, context)
}

function validateBody(
  body: NewsInterpretationBody,
  snapshot: NewsValidationSnapshot,
  context: NewsValidationContext
): NewsValidationResult {
  const { what, reading, outlook, gaps } = body
  // 1. 第一段三件缺一不可。
  if (!what.actor.trim() || !what.action.trim() || !what.whyRelated.trim()) return failMissing(newsInterpretationRules.whatMissing)
  // 2. 偏向是闭集。
  if (!NEWS_INTERPRETATION_STANCES.includes(what.stance as NewsInterpretationStance)) return failMissing(newsInterpretationRules.stanceInvalid)
  // 3. 第一段必须带触发这条新闻的证据，且与快照触发指针一致。
  if (!snapshot.trigger || what.evidenceRefId !== snapshot.trigger.evidenceRefId) return failMissing(newsInterpretationRules.citationMissing)
  // 4. 第二段至少两条读数。
  if (reading.checks.length < 2) return failMissing(newsInterpretationRules.checksTooFew)

  const evidenceIds = new Set(snapshot.evidenceRefs.map(ref => ref.evidenceRefId))
  const factByEvidence = new Map(snapshot.facts.filter(fact => fact.evidenceRefId).map(fact => [fact.evidenceRefId!, fact]))
  const marketChecks = reading.checks.map(check => ({ check, fact: factByEvidence.get(check.evidenceRefId) }))
  // 5/6. 每条读数必须是快照里的市场事实（不是新闻舆情、不是事件摘录）。
  for (const { check, fact } of marketChecks) {
    if (!evidenceIds.has(check.evidenceRefId)) return failMissing(newsInterpretationRules.checkNotInSnapshot, check.evidenceRefId)
    if (!fact || !isMarketReading(fact)) return failMissing(newsInterpretationRules.checkNotMarket, check.evidenceRefId)
  }
  // 7. 同一条读数不许重复引用充数。
  if (new Set(reading.checks.map(check => check.evidenceRefId)).size !== reading.checks.length) {
    return failMissing(newsInterpretationRules.checkDuplicated)
  }
  // 8. `contradiction` 与「两种 effect 是否同时出现」一致。
  const effects = new Set(reading.checks.map(check => check.effect))
  const bothSides = effects.has('supports') && effects.has('contradicts')
  if (reading.contradiction !== bothSides) return failMissing(newsInterpretationRules.contradictionMismatch)
  // 9. `verdict` 与 effects 集合一致：单边读数只能给单边结论；两边都有时不许说「无关」。
  if (!verdictMatches(reading.verdict, effects)) return failMissing(newsInterpretationRules.verdictMismatch)
  // 10. 盯什么必须指得到：事实句柄，或日历事实（指标属于日历身份集）。
  if (outlook.watchFor.length === 0) return failMissing(newsInterpretationRules.watchUnresolvable, 'empty')
  const factsById = new Map(snapshot.facts.map(fact => [fact.factId, fact]))
  for (const watch of outlook.watchFor) {
    const fact = factsById.get(watch.ref)
    if (!fact) return failMissing(newsInterpretationRules.watchUnresolvable, watch.ref)
    if (watch.refKind === 'calendar' && !isCalendarFact(fact)) return failMissing(newsInterpretationRules.watchUnresolvable, watch.ref)
  }
  // 11. 失效条件只能指到快照里真的有的东西。
  if (!invalidationResolves(outlook.invalidation, snapshot)) return failMissing(newsInterpretationRules.invalidationUnresolvable)
  // 12. 第二段必须逐字包含每条被引用事实的读者格式观测时刻（按不同时刻串去重，不解析）。
  const paragraphs = toSummaryParagraphs(body)
  const requiredTimes = new Set(marketChecks.map(({ fact }) => observedAtText(fact!, context)))
  for (const time of requiredTimes) {
    if (time.length > 0 && !paragraphs.change.includes(time)) return failMissing(newsInterpretationRules.checkTimeMissing, time)
  }
  // 13. 三段里的每个百分数都要有快照出处（复用市场同一条判据）。
  const numberDefect: AnalysisProbabilityDefect | undefined = untracedProsePercentageDefect({
    conclusion: { direction: 'undecided', summary: paragraphs.summary, change: paragraphs.change, causalChain: paragraphs.causalChain,
      conditions: [], macro: null, evidenceStrength: null, dataGaps: [] },
    scenarios: [], transmissionHypotheses: [], nextCatalysts: [], directions: []
  }, snapshot)
  if (numberDefect) return failMissing(newsInterpretationRules.numberNotInSnapshot, numberDefect)
  // 缺口是闭集里的那一项；不在闭集里是形状问题，不是句子问题。
  for (const gap of gaps) {
    if (!NEWS_INTERPRETATION_GAP_ITEMS.includes(gap.item) || !NEWS_INTERPRETATION_GAP_STATES.includes(gap.state)) {
      return fail(MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema, 'news-shape:gaps')
    }
  }
  return { ok: true, value: body, paragraphs, redactions: [] }
}

/** 读者格式的观测时刻：与界面 `useShellTimeFormat` 同一个 `formatShellInstant`（分钟精度）。 */
function observedAtText(fact: Pick<AgentFact, 'observedAt'>, context: NewsValidationContext): string {
  if (!fact.observedAt) return ''
  return formatShellInstant(fact.observedAt, {
    timeZone: context.timeZone,
    locale: context.proseLanguage ?? 'zh-CN',
    precision: 'minute'
  })
}

/** 市场读数：市场域、且不是新闻舆情或事件摘录。 */
function isMarketReading(fact: Pick<AgentFact, 'domain' | 'metric'>): boolean {
  const domains = new Set(['capital', 'funding', 'cross-asset', 'macro'])
  return domains.has(fact.domain) && fact.metric !== 'news-sentiment' && fact.metric !== 'event-excerpt'
}

function isCalendarFact(fact: Pick<AgentFact, 'metric'>): boolean {
  return Object.values(MARKET_ANALYSIS_MACRO_CALENDAR_FACT_METRICS).includes(fact.metric as never)
}

function verdictMatches(verdict: string, effects: ReadonlySet<string>): boolean {
  if (!NEWS_INTERPRETATION_EFFECTS.includes(verdict as never)) return false
  const hasSupports = effects.has('supports')
  const hasContradicts = effects.has('contradicts')
  // 两种都有：结论必须落在其中一边（记录里另有 `contradiction: true` 说清冲突），
  // 不许把一条同时有支持和反驳的解读说成「无关」。
  if (hasSupports && hasContradicts) return verdict === 'supports' || verdict === 'contradicts'
  if (hasSupports) return verdict === 'supports'
  if (hasContradicts) return verdict === 'contradicts'
  return verdict === 'unrelated'
}

function invalidationResolves(
  invalidation: NewsInterpretationInvalidation,
  snapshot: NewsValidationSnapshot
): boolean {
  if (invalidation.refKind === 'fact') return snapshot.facts.some(fact => fact.factId === invalidation.factId)
  return snapshot.facts.some(fact => fact.observedAt === invalidation.at)
}

function fail(errorCode: string, rule?: string, detail?: string): NewsValidationResult {
  return { ok: false, errorCode, ...(rule === undefined ? {} : { rule }), ...(detail === undefined ? {} : { detail }), redactions: [] }
}

function failMissing(rule: NewsInterpretationRule, detail?: string): NewsValidationResult {
  return fail(MARKET_ANALYSIS_ERROR_CODES.missingEvidence, rule, detail)
}

/** 形状：键集与类型；具体业务判据留给 13 条规则。 */
function readModelOutput(value: unknown): NewsModelOutput | string {
  if (!isRecord(value) || !hasExactKeys(value, ['what', 'reading', 'outlook', 'gaps'])) return 'top-level'
  const { what, reading, outlook, gaps } = value
  if (!isRecord(what) || !hasExactKeys(what, ['evidenceRef', 'actor', 'action', 'whyRelated', 'stance']) ||
    typeof what.evidenceRef !== 'string' || typeof what.actor !== 'string' || typeof what.action !== 'string' ||
    typeof what.whyRelated !== 'string' || typeof what.stance !== 'string') return 'what'
  if (!isRecord(reading) || !hasExactKeys(reading, ['checks', 'contradiction', 'verdict']) ||
    !Array.isArray(reading.checks) || typeof reading.contradiction !== 'boolean' || typeof reading.verdict !== 'string') return 'reading'
  for (const check of reading.checks) {
    if (!isRecord(check) || !hasExactKeys(check, ['evidenceRef', 'effect', 'statement']) ||
      typeof check.evidenceRef !== 'string' || typeof check.effect !== 'string' || typeof check.statement !== 'string') return 'reading'
  }
  if (!isRecord(outlook) || !hasExactKeys(outlook, ['direction', 'mechanism', 'watchFor', 'invalidation']) ||
    typeof outlook.direction !== 'string' || typeof outlook.mechanism !== 'string' ||
    !Array.isArray(outlook.watchFor) || !isRecord(outlook.invalidation) || typeof outlook.invalidation.refKind !== 'string') return 'outlook'
  for (const watch of outlook.watchFor) {
    if (!isRecord(watch) || !hasExactKeys(watch, ['refKind', 'ref']) || typeof watch.refKind !== 'string' || typeof watch.ref !== 'string') return 'outlook'
  }
  if (outlook.invalidation.refKind === 'fact') {
    if (typeof outlook.invalidation.factRef !== 'string') return 'outlook'
  } else if (typeof outlook.invalidation.at !== 'string') return 'outlook'
  if (!Array.isArray(gaps)) return 'gaps'
  for (const gap of gaps) {
    if (!isRecord(gap) || typeof gap.item !== 'string' || typeof gap.state !== 'string' ||
      (gap.note !== undefined && typeof gap.note !== 'string')) return 'gaps'
  }
  return value as unknown as NewsModelOutput
}

/** 把模型写的短句柄换回存储 id；换不回来的原样留着，让上面的规则报「不在快照里」。 */
function resolveBody(output: NewsModelOutput, snapshot: NewsValidationSnapshot): NewsInterpretationBody {
  const map = buildAnalysisReferenceMap({ facts: snapshot.facts, evidenceRefs: snapshot.evidenceRefs })
  const resolveEvidence = (value: string): string => map.evidenceIdByHandle.get(value.trim().toLowerCase()) ?? value
  const resolveFact = (value: string): string => map.factIdByHandle.get(value.trim().toLowerCase()) ?? value
  const invalidation = output.outlook.invalidation.refKind === 'fact'
    ? { refKind: 'fact' as const, factId: resolveFact(output.outlook.invalidation.factRef!) }
    : { refKind: 'instant' as const, at: output.outlook.invalidation.at! }
  return {
    analysisKind: 'news', schemaVersion: 1,
    what: {
      evidenceRefId: resolveEvidence(output.what.evidenceRef),
      actor: output.what.actor, action: output.what.action, whyRelated: output.what.whyRelated,
      stance: output.what.stance as NewsInterpretationStance
    },
    reading: {
      checks: output.reading.checks.map((check): NewsInterpretationCheck => ({
        evidenceRefId: resolveEvidence(check.evidenceRef),
        effect: check.effect as NewsInterpretationCheck['effect'],
        statement: check.statement
      })),
      contradiction: output.reading.contradiction,
      verdict: output.reading.verdict as NewsInterpretationCheck['effect']
    },
    outlook: {
      direction: output.outlook.direction as NewsInterpretationRecord['outlook']['direction'],
      mechanism: output.outlook.mechanism,
      watchFor: output.outlook.watchFor.map(watch => ({ refKind: watch.refKind as 'calendar' | 'fact', ref: resolveFact(watch.ref) })),
      invalidation
    },
    gaps: output.gaps.map(gap => ({
      item: gap.item as never, state: gap.state as never, ...(gap.note === undefined ? {} : { note: gap.note })
    }))
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value)
  return present.length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key))
}
