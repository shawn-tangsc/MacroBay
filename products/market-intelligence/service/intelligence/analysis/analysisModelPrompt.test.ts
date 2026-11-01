import { buildAnalysisMessages, describe, expect, it } from 'vitest'

import type { EvidenceSnapshot } from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisMessages } from './analysisModelPrompt'

const asOf = '2026-10-07T09:06:14.792Z'

function snapshot(overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot {
  return {
    id: 'mi-es-1', schemaVersion: 1, eventGroupId: 'mi-eg-1', asOf, dataCutoff: asOf, snapshotHash: 'h1',
    profileId: 'crypto-market-analysis-v1', facts: [], missingDomains: [], caveats: [], evidenceRefs: [],
    sourceHealth: [], createdAt: asOf, policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1',
    ...overrides
  } as EvidenceSnapshot
}

const systemPrompt = (input: EvidenceSnapshot = snapshot()) =>
  buildAnalysisMessages(input).find(message => message.role === 'system')!.content

describe('analysis model prompt conclusion contract', () => {
  it('requires the conclusion to carry an explicit causal chain, not only a verdict and data', () => {
    const system = systemPrompt()
    // The reported defect: conclusions listed data and hedged instead of explaining
    // why the data would move the assets.
    expect(system).toContain('因果链')
    expect(system).toContain('起因事件 → 中间变量')
    expect(system).toContain('因此本判断成立的条件')
  })

  it('forbids presenting a conditional hypothesis as the only explanation', () => {
    const system = systemPrompt()
    expect(system).toContain('不得只写「若…可能…」')
    expect(system).toContain('必须用现有证据说明当前最可能的机制与作用方向')
    expect(system).toContain('不得把条件式假设当作唯一解释')
  })

  it('bounds the uncertainty claim instead of letting a missing field replace the reasoning', () => {
    const system = systemPrompt()
    expect(system).toContain('数据缺口只用于限定判断置信度')
    expect(system).toContain('不得用缺失字段代替机制说明')
  })

  it('pins the language-neutral direction keys instead of any text marker', () => {
    const system = systemPrompt()
    expect(system).toContain('conclusion.direction 只能取这五个 key')
    for (const key of ['bullish', 'bearish', 'range', 'undecided', 'mixed']) expect(system).toContain(key)
    expect(system).toContain('conclusion.change')
    expect(system).not.toContain('方向：<术语>')
  })

  it('forbids internal identifiers in the text a reader sees', () => {
    const system = systemPrompt()
    // The reported defect: the conclusion quoted `change-1d-usd`, `cross-asset` and `consensus`.
    expect(system).toContain('禁止出现内部标识符')
    expect(system).toContain('change-1d-usd')
    expect(system).toContain('市场预期值')
    expect(system).not.toContain('consensus 缺口')
  })

  it('hands the model names and magnitudes instead of identifiers and raw integers', () => {
    const messages = buildAnalysisMessages(snapshot({
      facts: [{
        factId: 'mi-fact-capital-stablecoins-change-1d-usd-index', domain: 'capital', subject: 'stablecoins',
        metric: 'change-1d-usd', value: -406_814_368.04333496, unit: 'USD', sourceId: '0xrouter', sourceLabel: '0xrouter',
        observedAt: asOf, asOf, freshness: 'fresh', confidence: 1, comparability: 'comparable', evidenceRefId: 'ev-1'
      }],
      missingDomains: ['cross-asset'],
      caveats: ['macro-calendar-consensus-unavailable']
    }))
    const user = JSON.parse(messages.at(-1)!.content) as {
      facts: readonly Record<string, unknown>[]
      missingDomains: readonly string[]
      caveats: readonly string[]
      marketReactionFactRefs: readonly string[]
    }

    expect(user.facts[0]).toMatchObject({ domain: '资金面', subject: '稳定币', metric: '1 日变化', value: '-4.07 亿美元', comparability: '可比' })
    expect(user.missingDomains).toEqual(['跨资产'])
    expect(user.caveats).toEqual(['缺少市场预期值'])
    // The two machine references the model must echo are short handles, and the eligible-reaction
    // list is handles too: quoting the stored encodings is what rejected whole analyses.
    const descriptive = user.facts.map(fact => {
      const { factRef: _ref, evidenceRef: _evidence, ...rest } = fact
      return rest
    })
    const { marketReactionFactRefs: reactionRefs, ...narration } = user
    expect(reactionRefs).toEqual(['f1'])
    expect(JSON.stringify({ ...narration, facts: descriptive }))
      .not.toMatch(/change-1d-usd|cross-asset|stablecoins|macro-calendar-consensus-unavailable|406814368/)
    // Neither the stored encoding nor the internal item id reaches the model any more.
    expect(messages.at(-1)!.content).not.toContain('mi-fact-capital-stablecoins-change-1d-usd-index')
  })

  it('hands over the fact ids a market reaction may cite, and not the ones the validator refuses', () => {
    const base = {
      factId: 'mi-fact-eligible', domain: 'cross-asset' as const, subject: 'BTC', metric: 'price-return',
      value: 1, unit: '%', sourceId: '0xrouter', sourceLabel: '0xrouter', observedAt: asOf, asOf,
      confidence: 1, evidenceRefId: 'ev-1'
    }
    const messages = buildAnalysisMessages(snapshot({
      facts: [
        { ...base, comparability: 'comparable', freshness: 'fresh' },
        { ...base, factId: 'mi-fact-stale', comparability: 'comparable', freshness: 'stale' },
        { ...base, factId: 'mi-fact-excerpt', metric: 'event-excerpt', comparability: 'not-comparable', freshness: 'stale' }
      ]
    }))
    const user = JSON.parse(messages.at(-1)!.content) as { marketReactionFactRefs: readonly string[] }

    // A reaction built on either of the other two is refused as `ineligible-market-reaction`,
    // so the prompt names the eligible set instead of leaving it to be inferred.
    expect(user.marketReactionFactRefs).toEqual(['f1'])
    expect(systemPrompt()).toContain('marketReaction 的 factIds 只能取自输入里的 marketReactionFactRefs')
    expect(systemPrompt()).toContain('不得追加第二项')
    expect(systemPrompt()).toContain('只能填这些句柄原文')
  })
})

it('asks for the verdict before the change record, as separate fields', () => {
  const system = systemPrompt() as unknown as string
  // The old template embedded the verdict, the change and the causal chain in one paragraph, which
  // is how an entry ended up published with a direction and a change list but no verdict.
  expect(system).toContain('conclusion.summary 必须先写结论')
  expect(system).toContain('只给方向、没有结论句的输出会被直接拒绝发布')
  expect(system).toContain('"conditions"')
  expect(system).toContain('"dataGaps"')
})

describe('analysis prose language', () => {
  const systemFor = (language: 'zh-CN' | 'en-US') =>
    buildAnalysisMessages(snapshot(), [], undefined, language).find(message => message.role === 'system')!.content

  it('names the reader language while keeping one language-neutral contract', () => {
    const english = systemFor('en-US')
    expect(english).toContain('输出语言：英语（en-US）')
    // The contract is the same in every language: no per-language token vocabulary to maintain.
    for (const key of ['bullish', 'bearish', 'range', 'undecided', 'mixed']) expect(english).toContain(key)
    expect(english).not.toContain('Direction: <term>')
    expect(english).not.toContain('Causal chain')

    expect(systemFor('zh-CN')).toContain('输出语言：中文（zh-CN）')
  })

  it('adds a language without touching the contract', () => {
    // A future locale only names itself; the field structure and keys stay identical.
    const french = buildAnalysisMessages(snapshot(), [], undefined, 'fr-FR' as never)
      .find(message => message.role === 'system')!.content
    expect(french).toContain('（fr-FR）')
    expect(french).toContain('"direction"')
    expect(french).toContain('bullish')
  })

  it('formats input magnitudes in the prose language so the model cannot copy the wrong units', () => {
    const flow = {
      factId: 'mi-fact-capital-stablecoins-change-30d-usd', domain: 'capital' as const, subject: 'stablecoins',
      metric: 'change-30d-usd', value: -4_483_000_000, unit: 'USD', sourceId: '0xrouter', sourceLabel: '0xrouter',
      observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const, evidenceRefId: 'ev-1'
    }

    const english = buildAnalysisMessages(snapshot({ facts: [flow] }), [], undefined, 'en-US')
    const englishUser = JSON.parse(english.at(-1)!.content) as { facts: readonly Record<string, unknown>[] }
    expect(englishUser.facts[0]!.value).toBe('-$4.48B')
    expect(english.at(-1)!.content).not.toContain('亿美元')
    // The instruction names the unit spelling too, so an existing English rendering cannot copy 亿.
    expect(english.find(message => message.role === 'system')!.content).toContain('不得出现「亿」')

    const chinese = buildAnalysisMessages(snapshot({ facts: [flow] }), [], undefined, 'zh-CN')
    expect((JSON.parse(chinese.at(-1)!.content) as { facts: readonly Record<string, unknown>[] }).facts[0]!.value).toBe('-44.83 亿美元')
  })
  it('weighs the key sentiment only when the snapshot actually carries it', () => {
    const news = {
      factId: 'mi-fact-news-1', domain: 'sentiment' as const, subject: 'market', metric: 'news-sentiment',
      value: '看空（强度 4/5，置信 80%）｜交易所故障', unit: null, sourceId: 'coindesk-rss', sourceLabel: 'coindesk-rss',
      observedAt: asOf, asOf, freshness: 'fresh' as const, confidence: 0.8, comparability: 'not-comparable' as const, evidenceRefId: 'ev-1'
    }
    const withNews = systemPrompt(snapshot({ facts: [news] }))
    expect(withNews).toContain('新闻舆情')
    expect(withNews).toContain('不能当作行情证据')
    expect(withNews).toContain('marketReaction 仍然只能引用 marketReactionFactRefs')

    // The rule names a section that is not there in every other run; adding it unconditionally
    // would invite the model to reason about an empty block.
    expect(systemPrompt()).not.toContain('新闻舆情')
  })
})

describe('policy path prompt rules', () => {
  const policyFact = {
    factId: 'mi-fact-macro-policy-implied-probability-hike-25-2026-11-04', domain: 'macro' as const, subject: 'hike-25',
    metric: 'policy-implied-probability', value: 71, unit: 'percent', sourceId: 'policy-path-market', sourceLabel: 'policy-path-market',
    observedAt: '2026-10-30T15:00:00.000Z', asOf, freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const,
    evidenceRefId: 'ev-policy', sourceUrl: 'https://polymarket.com/'
  }

  it('states the market-pricing and SEP-meeting rules only when the facts are present', () => {
    const system = systemPrompt(snapshot({ facts: [policyFact] }))
    expect(system).toContain('政策与市场定价')
    expect(system).toContain('预测市场盘口')
    expect(system).toContain('截至时刻')
    expect(system).toContain('YYYY-MM-DD 那场')
    expect(system).toContain('24 小时变化尚未可得')

    const without = systemPrompt()
    expect(without).not.toContain('政策与市场定价')
  })

  it('hides the source URL from the model while naming the fact', () => {
    const messages = buildAnalysisMessages(snapshot({ facts: [policyFact] }))
    const user = JSON.parse(messages.at(-1)!.content) as { facts: readonly Record<string, unknown>[] }
    expect(user.facts[0]).toMatchObject({ metric: '下次会议市场定价概率', value: '71%', observedAt: '2026-10-30T15:00:00.000Z' })
    expect(JSON.stringify(user)).not.toContain('polymarket.com')
  })

  it('asks for a named gap when an enabled policy source has no reading', () => {
    const system = systemPrompt(snapshot({ caveats: ['policy-path-unavailable'] }))
    expect(system).toContain('政策路径数据不可用')
    expect(system).toContain('conclusion.dataGaps')
    expect(system).toContain('不得用「政策不确定」「政策中性」')
  })
})
