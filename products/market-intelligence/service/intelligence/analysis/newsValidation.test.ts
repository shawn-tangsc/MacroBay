import { expect, it } from 'vitest'
import { formatShellInstant } from '@platform/ui/time/shellTimeFormat'

import type { AgentFact, EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { MARKET_ANALYSIS_MACRO_CALENDAR_FACT_METRICS } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisReferenceMap } from './analysisReferenceHandles'
import { newsInterpretationRules, toSummaryParagraphs, validateNewsInterpretation } from './newsValidation'

/**
 * 新闻线 13 条校验（R39 §4.3）。每条都用**合法基线 + 只改一处**的方式跑：
 * 断言的是「哪条规则被触发」，不是句子的措辞。
 */
const asOf = '2026-11-17T12:00:00.000Z'
const context = { timeZone: 'Asia/Shanghai', proseLanguage: 'zh-CN' as const }

function fact(overrides: Partial<AgentFact> & Pick<AgentFact, 'factId' | 'evidenceRefId'>): AgentFact {
  return {
    domain: 'capital', subject: 'BTC', metric: 'etf-net-flow-usd', value: '-2.92%', unit: 'percent',
    sourceId: 'source-a', sourceLabel: '源 A', observedAt: asOf, asOf, freshness: 'fresh', confidence: 1,
    comparability: 'comparable', ...overrides
  } as AgentFact
}

const facts: AgentFact[] = [
  fact({ factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1', domain: 'sentiment', metric: 'news-sentiment', value: 'bearish · strength 3/5｜title｜quote', observedAt: '2026-11-17T11:59:00.000Z' }),
  fact({ factId: 'fact-A', evidenceRefId: 'ev-A', metric: 'etf-net-flow-usd', value: '-2.92%', observedAt: '2026-11-17T11:30:00.000Z' }),
  fact({ factId: 'fact-B', evidenceRefId: 'ev-B', domain: 'funding', metric: 'funding-rate', value: '0.01%', observedAt: '2026-11-17T11:40:00.000Z' }),
  // 与 fact-A 同一观测时刻：用来验证「按不同时刻串去重」那条。
  fact({ factId: 'fact-E', evidenceRefId: 'ev-E', domain: 'cross-asset', metric: 'index-return', value: '-1.20%', observedAt: '2026-11-17T11:30:00.000Z' }),
  fact({ factId: 'fact-C', evidenceRefId: 'ev-C', domain: 'macro', metric: MARKET_ANALYSIS_MACRO_CALENDAR_FACT_METRICS.eventName, value: 'CPI 发布', unit: null, observedAt: '2026-11-17T11:45:00.000Z' })
]
const snapshot = {
  facts,
  evidenceRefs: [
    { evidenceRefId: 'news:item-1' }, { evidenceRefId: 'ev-A' }, { evidenceRefId: 'ev-B' }, { evidenceRefId: 'ev-C' }, { evidenceRefId: 'ev-E' }
  ],
  trigger: { source: 'intelligence-item' as const, itemId: 'item-1', factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1' }
} as unknown as Pick<EvidenceSnapshot, 'facts' | 'evidenceRefs' | 'trigger'>

const handles = buildAnalysisReferenceMap(snapshot as never)
const f = (factId: string): string => handles.factHandleById.get(factId)!
const e = (evidenceRefId: string): string => handles.evidenceHandleById.get(evidenceRefId)!
const time = (factId: string): string => formatShellInstant(
  facts.find(item => item.factId === factId)!.observedAt ?? '',
  { timeZone: context.timeZone, locale: 'zh-CN', precision: 'minute' }
)

function baseOutput(): Record<string, unknown> {
  return {
    what: {
      evidenceRef: e('news:item-1'), actor: '据报道，', action: '某公司宣布裁员。',
      whyRelated: '这会压低风险偏好，对 BTC 偏空。', stance: 'bearish'
    },
    reading: {
      checks: [
        { evidenceRef: e('ev-A'), effect: 'supports', statement: `ETF 净流出 ${'-2.92%'}，截至 ${time('fact-A')}。` },
        { evidenceRef: e('ev-B'), effect: 'supports', statement: `资金费率 ${'0.01%'}，截至 ${time('fact-B')}。` }
      ],
      contradiction: false,
      verdict: 'supports'
    },
    outlook: {
      direction: 'bearish',
      mechanism: '短期偏空。新闻压低风险偏好，若资金流转正则这个判断作废。',
      watchFor: [{ refKind: 'fact', ref: f('fact-A') }],
      invalidation: { refKind: 'fact', factRef: f('fact-B') }
    },
    gaps: [] as unknown[]
  }
}

function validate(mutate: (output: Record<string, unknown>) => void = () => undefined) {
  const output = baseOutput()
  mutate(output)
  return validateNewsInterpretation(JSON.stringify(output), snapshot, context)
}

function ruleOf(mutate: (output: Record<string, unknown>) => void): string {
  const result = validate(mutate)
  if (result.ok) throw new Error('expected a rejection')
  return result.rule ?? ''
}

it('accepts a well-formed reading and maps it onto the three paragraphs', () => {
  const result = validate()
  if (!result.ok) throw new Error(`expected ok, got ${result.rule}`)
  expect(result.paragraphs.summary).toBe('据报道，某公司宣布裁员。这会压低风险偏好，对 BTC 偏空。')
  expect(result.paragraphs.change).toContain(time('fact-A'))
  expect(result.paragraphs.causalChain).toContain('短期偏空')
  // 每段的映射来源就是内部字段：第二段 = checks 的 statement，换一个字段就换一段。
  expect(toSummaryParagraphs(result.value)).toEqual(result.paragraphs)
})

it('rejects a missing first paragraph, a bad stance and a missing news citation', () => {
  expect(ruleOf(output => { (output.what as Record<string, string>).actor = '  ' })).toBe(newsInterpretationRules.whatMissing)
  expect(ruleOf(output => { (output.what as Record<string, string>).stance = 'mixed' })).toBe(newsInterpretationRules.stanceInvalid)
  expect(ruleOf(output => { (output.what as Record<string, string>).evidenceRef = e('ev-A') })).toBe(newsInterpretationRules.citationMissing)
})

it('rejects fewer than two checks, non-market readings and unknown or duplicated checks', () => {
  expect(ruleOf(output => { (output.reading as { checks: unknown[] }).checks = [(output.reading as { checks: unknown[] }).checks[0]] }))
    .toBe(newsInterpretationRules.checksTooFew)
  // 新闻舆情不是市场读数。
  expect(ruleOf(output => { ((output.reading as { checks: Array<{ evidenceRef: string }> }).checks[0]).evidenceRef = e('news:item-1') }))
    .toBe(newsInterpretationRules.checkNotMarket)
  // 快照里没有的 evidence 引用。
  expect(ruleOf(output => { ((output.reading as { checks: Array<{ evidenceRef: string }> }).checks[0]).evidenceRef = 'e999' }))
    .toBe(newsInterpretationRules.checkNotInSnapshot)
  // 同一条读数写两遍充数。
  expect(ruleOf(output => {
    const checks = (output.reading as { checks: Array<Record<string, string>> }).checks
    checks[1] = { ...checks[0]!, statement: checks[1]!.statement! }
  })).toBe(newsInterpretationRules.checkDuplicated)
})

it('rejects a contradiction flag and a verdict that disagree with the effects', () => {
  expect(ruleOf(output => { ((output.reading as { checks: Array<Record<string, string>> }).checks[1]!).effect = 'contradicts' }))
    .toBe(newsInterpretationRules.contradictionMismatch)
  expect(ruleOf(output => { ((output.reading as { checks: Array<Record<string, string>> }).checks[1]!).effect = 'contradicts'; (output.reading as { contradiction: boolean }).contradiction = true; (output.reading as { verdict: string }).verdict = 'unrelated' }))
    .toBe(newsInterpretationRules.verdictMismatch)
  expect(ruleOf(output => { (output.reading as { verdict: string }).verdict = 'contradicts' }))
    .toBe(newsInterpretationRules.verdictMismatch)
})

it('rejects a watch target or an invalidation the snapshot cannot resolve', () => {
  expect(ruleOf(output => { ((output.outlook as { watchFor: Array<Record<string, string>> }).watchFor[0]!).ref = 'f999' }))
    .toBe(newsInterpretationRules.watchUnresolvable)
  // 声明成日历事件却指到非日历事实。
  expect(ruleOf(output => { ((output.outlook as { watchFor: Array<Record<string, string>> }).watchFor[0]!).refKind = 'calendar' }))
    .toBe(newsInterpretationRules.watchUnresolvable)
  expect(ruleOf(output => { (output.outlook as { invalidation: Record<string, string> }).invalidation.factRef = 'f999' }))
    .toBe(newsInterpretationRules.invalidationUnresolvable)
  expect(ruleOf(output => { (output.outlook as { invalidation: Record<string, string> }).invalidation = { refKind: 'instant', at: '2026-11-17T13:00:00.000Z' } }))
    .toBe(newsInterpretationRules.invalidationUnresolvable)
})

it('rejects a check whose statement does not contain the fact’s observedAtText verbatim', () => {
  // 缺整串。
  expect(ruleOf(output => {
    const checks = (output.reading as { checks: Array<Record<string, string>> }).checks
    checks[1] = { ...checks[1]!, statement: '资金费率 0.01%，读数偏弱。' }
  })).toBe(newsInterpretationRules.checkTimeMissing)
  // 时刻被改过格式同样拒：不做任何时刻解析，只问原串在不在。
  expect(ruleOf(output => {
    const checks = (output.reading as { checks: Array<Record<string, string>> }).checks
    checks[0] = { ...checks[0]!, statement: `ETF 净流出 -2.92%，截至 ${time('fact-A').replace(' GMT+8', '')}。` }
  })).toBe(newsInterpretationRules.checkTimeMissing)
  // 两条事实同一时刻时，正文出现一次就够（按不同时刻串去重）。
  expect(validate(output => {
    const checks = (output.reading as { checks: Array<Record<string, string>> }).checks
    checks[1] = { evidenceRef: e('ev-E'), effect: 'supports', statement: `指数 -1.20%，截至 ${time('fact-E')}。` }
  }).ok).toBe(true)
})

it('rejects a percentage that has no snapshot source', () => {
  expect(ruleOf(output => {
    const checks = (output.reading as { checks: Array<Record<string, string>> }).checks
    checks[0] = { ...checks[0]!, statement: `ETF 净流出 ${'-9.99%'}，截至 ${time('fact-A')}。` }
  })).toBe(newsInterpretationRules.numberNotInSnapshot)
})

it('keeps a gap note on the second paragraph instead of inventing a fourth section', () => {
  const result = validate(output => {
    (output.gaps as unknown[]) = [{ item: 'amount', state: 'not-yet', note: '原文没给金额，等后续披露才能判断。' }]
  })
  if (!result.ok) throw new Error(`expected ok, got ${result.rule}`)
  expect(result.paragraphs.change).toContain('原文没给金额，等后续披露才能判断。')
})
