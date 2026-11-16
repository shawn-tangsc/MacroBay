import type {
  AnalysisInvalidation, AnalysisNewsImpact, AnalysisConclusion, SnapshotTrigger
} from '../../../contracts/marketAnalysisContracts'
import type { TriggerFocus } from './analysisTriggerFocus'

/**
 * 触发型分析的必答校验（R37 §3）。
 *
 * 只比 id 与结构：引用是不是快照里的、两条读数是不是市场事实、矛盾是不是说成矛盾、失效条件
 * 指不指得到、缺口是不是闭集里的那一项。**不读句子**——措辞像不像复述，由提示词负责。
 */
export const analysisNewsImpactRules = Object.freeze({
  /** 论证区没引用触发这条新闻的证据（或压根没写 newsImpact）。 */
  notCited: 'news-trigger-not-cited',
  /** 印证/否证用的读数不足、不是市场事实，或引用里没有一条市场事实。 */
  insufficientData: 'news-impact-insufficient-data',
  /** `contradiction` 与「checks 里两种 effect 是否同时出现」不一致。 */
  contradictionMismatch: 'news-impact-contradiction-mismatch',
  /** 失效条件指到快照里没有的事实或时刻。 */
  invalidation: 'news-impact-invalidation',
  /** `cannot-determine` 的缺口不是闭集，或同时给了 checks。 */
  missingState: 'news-impact-missing-state',
  /** `no-transmission` 没证明查过（checkedFactIds < 2 或不在快照里）。 */
  unchecked: 'news-impact-unchecked'
})

/** 市场事实的域：这些域里的一条读数才叫「当前数据」。 */
const MARKET_DOMAINS: ReadonlySet<string> = new Set(['capital', 'funding', 'cross-asset', 'macro'])
const MISSING_ITEMS: ReadonlySet<string> = new Set(['amount', 'symbol', 'time', 'market-data'])
const MISSING_STATES: ReadonlySet<string> = new Set(['not-yet', 'source-empty', 'unreadable'])

export type NewsImpactDefect = Readonly<{ rule: string; detail: string }>

type VerifyInput = Readonly<{
  output: Readonly<{ conclusion: AnalysisConclusion }>
  /** 只读得到校验真正需要的那几个字段；冻结证据与快照都满足它。 */
  snapshot: Readonly<{
    facts: readonly Readonly<{ factId: string; domain: string; metric: string; subject?: string; evidenceRefId?: string | null }>[]
    trigger?: SnapshotTrigger
  }>
  focus: TriggerFocus | undefined
  /** 论证区引用到的那批证据（支撑/反向/传导/方向/催化剂）。 */
  reasoningEvidenceRefIds: ReadonlySet<string>
}>

export function newsImpactDefectOf(input: VerifyInput): NewsImpactDefect | undefined {
  const trigger = input.snapshot.trigger
  // 没有触发指针 → 这条规则不管（日历、时段、手动三条路照旧）。
  if (!trigger) return undefined
  // 有指针却判成「不适用」只可能是快照缺了那条事实：当快照缺陷拒，别把没回答当成没问题。
  if (input.focus && input.focus.mode.startsWith('not-applicable')) {
    return { rule: analysisNewsImpactRules.notCited, detail: `focus-${input.focus.mode}` }
  }
  const facts = new Map(input.snapshot.facts.map(fact => [fact.factId, fact]))
  const triggerFact = facts.get(trigger.factId)
  // 触发项的证据必须出现在**论证区**：只挂在 knownFacts 清单里等于登记，不是回答。
  if (!triggerFact || !input.reasoningEvidenceRefIds.has(trigger.evidenceRefId)) {
    return { rule: analysisNewsImpactRules.notCited, detail: 'trigger-evidence-not-cited' }
  }
  const impact = input.output.conclusion.newsImpact
  if (!impact) return { rule: analysisNewsImpactRules.notCited, detail: 'news-impact-missing' }

  switch (impact.verdict) {
    case 'cannot-determine':
      return MISSING_ITEMS.has(impact.missing.item) && MISSING_STATES.has(impact.missing.state)
        ? undefined
        : { rule: analysisNewsImpactRules.missingState, detail: 'missing-not-in-closed-set' }
    case 'no-transmission': {
      const ids = impact.checkedFactIds
      const held = ids.every(id => facts.has(id))
      return ids.length >= 2 && new Set(ids).size === ids.length && held && impact.reason.trim().length > 0
        ? undefined
        : { rule: analysisNewsImpactRules.unchecked, detail: held ? 'checked-facts-too-few' : 'checked-fact-not-in-snapshot' }
    }
    case 'evaluated':
      return evaluatedDefect(impact, facts)
    default:
      return { rule: analysisNewsImpactRules.missingState, detail: 'unknown-verdict' }
  }
}

function evaluatedDefect(
  impact: Extract<AnalysisNewsImpact, { verdict: 'evaluated' }>,
  facts: ReadonlyMap<string, { domain: string; metric: string; evidenceRefId?: string | null }>
): NewsImpactDefect | undefined {
  const ids = impact.checks.map(check => check.factId)
  if (ids.length < 2) return { rule: analysisNewsImpactRules.insufficientData, detail: 'checks-too-few' }
  if (new Set(ids).size !== ids.length) return { rule: analysisNewsImpactRules.insufficientData, detail: 'checks-duplicated' }
  for (const id of ids) {
    const fact = facts.get(id)
    if (!fact) return { rule: analysisNewsImpactRules.insufficientData, detail: 'check-fact-not-in-snapshot' }
    // 舆情事实不能当「当前数据」：拿新闻印证新闻等于复述。
    if (fact.metric === 'news-sentiment' || !MARKET_DOMAINS.has(fact.domain)) {
      return { rule: analysisNewsImpactRules.insufficientData, detail: 'check-fact-not-market' }
    }
  }
  const effects = new Set(impact.checks.map(check => check.effect))
  const both = effects.has('supports') && effects.has('contradicts')
  if (impact.contradiction !== both) return { rule: analysisNewsImpactRules.contradictionMismatch, detail: both ? 'contradiction-not-declared' : 'contradiction-invented' }
  return invalidationDefect(impact.invalidation, facts)
}

/** 复用情景失效条件同一条判据：要么指到快照里的事实，要么是快照内的时刻。 */
function invalidationDefect(
  invalidation: AnalysisInvalidation,
  facts: ReadonlyMap<string, { domain: string; metric: string; evidenceRefId?: string | null }>
): NewsImpactDefect | undefined {
  if (invalidation.kind === 'fact') return facts.has(invalidation.factId) ? undefined : { rule: analysisNewsImpactRules.invalidation, detail: 'invalidation-fact-unknown' }
  return Number.isFinite(Date.parse(invalidation.at)) ? undefined : { rule: analysisNewsImpactRules.invalidation, detail: 'invalidation-instant-invalid' }
}

/** 结构判据（B 笔先用；C 笔再加六条语义规则）。 */
export function isAnalysisNewsImpact(value: unknown): value is AnalysisNewsImpact {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  if (record.verdict === 'evaluated') {
    if (!Array.isArray(record.checks) || record.checks.length === 0 || typeof record.contradiction !== 'boolean') return false
    const checksOk = record.checks.every(check => check && typeof check === 'object' &&
      typeof (check as Record<string, unknown>).factId === 'string' &&
      ((check as Record<string, unknown>).effect === 'supports' || (check as Record<string, unknown>).effect === 'contradicts'))
    return checksOk && isInvalidationShape(record.invalidation) && exactKeys(record, ['verdict', 'checks', 'contradiction', 'invalidation'])
  }
  if (record.verdict === 'no-transmission') {
    return Array.isArray(record.checkedFactIds) && record.checkedFactIds.every(id => typeof id === 'string') &&
      typeof record.reason === 'string' && record.reason.length > 0 &&
      exactKeys(record, ['verdict', 'checkedFactIds', 'reason'])
  }
  if (record.verdict === 'cannot-determine') {
    const missing = record.missing
    if (!missing || typeof missing !== 'object') return false
    const entry = missing as Record<string, unknown>
    return typeof entry.item === 'string' && typeof entry.state === 'string' && exactKeys(record, ['verdict', 'missing'])
  }
  return false
}

function isInvalidationShape(value: unknown): value is AnalysisInvalidation {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  const statement = typeof entry.statement === 'string' && entry.statement.length > 0
  if (entry.kind === 'fact') return statement && typeof entry.factId === 'string' && (entry.relation === 'below' || entry.relation === 'above')
  if (entry.kind === 'instant') return statement && typeof entry.at === 'string'
  return false
}

function exactKeys(record: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(record).every(key => allowed.includes(key))
}
