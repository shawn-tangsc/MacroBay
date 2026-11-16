import { describe, expect, it } from 'vitest'

import { validateAnalysisModelOutput, type FrozenAnalysisEvidence } from './analysisOutputValidator'
import type { TriggerFocus } from './analysisTriggerFocus'

const asOf = '2026-11-16T09:07:42.000Z'

/** 一条已经被判定方向明确的新闻 + 两条市场读数：新闻解读的最小可验证场景。 */
function frozenNewsSnapshot(): FrozenAnalysisEvidence {
  const fact = (factId: string, evidenceRefId: string, metric: string, domain: 'sentiment' | 'capital' | 'funding', subject: string) => ({
    factId, evidenceRefId, metric, domain, subject, comparability: 'comparable' as const, freshness: 'fresh' as const,
    value: 1, observedAt: asOf
  })
  return {
    facts: [
      fact('triggered-news:item-1', 'news:item-1', 'news-sentiment', 'sentiment', 'BTC'),
      fact('mi-fact-etf', 'ev-etf', 'etf-net-flow', 'capital', 'BTC'),
      fact('mi-fact-funding', 'ev-funding', 'funding-rate', 'funding', 'BTC')
    ],
    evidenceRefs: [{ evidenceRefId: 'news:item-1' }, { evidenceRefId: 'ev-etf' }, { evidenceRefId: 'ev-funding' }],
    trigger: { source: 'intelligence-item', itemId: 'item-1', factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1' }
  } as FrozenAnalysisEvidence
}

const focus: TriggerFocus = {
  mode: 'strict',
  triggers: [{ factId: 'triggered-news:item-1', evidenceRefId: 'news:item-1', subject: 'BTC' }]
}

function output(overrides: Record<string, unknown> = {}) {
  return {
    conclusion: {
      direction: 'bearish' as const,
      summary: '跨境支付试点与加密资产无关，BTC 的资金面仍偏弱。',
      change: 'BTC 现货 ETF 连续净流出。',
      causalChain: '资金净流出 → 买盘减弱 → BTC 短期承压 → 因此偏空。',
      conditions: ['ETF 继续净流出。'],
      macro: null,
      evidenceStrength: null,
      dataGaps: [],
      newsImpact: {
        verdict: 'evaluated' as const,
        checks: [
          { factId: 'mi-fact-etf', effect: 'supports' as const },
          { factId: 'mi-fact-funding', effect: 'contradicts' as const }
        ],
        contradiction: true,
        invalidation: { kind: 'fact' as const, factId: 'mi-fact-etf', relation: 'above' as const, statement: 'ETF 转为净流入。' }
      },
      ...overrides
    },
    knownFacts: [{ factId: 'mi-fact-etf', statement: 'ETF 净流出。', evidenceRefIds: ['ev-etf'] }],
    transmissionHypotheses: [{ statement: '资金流出削弱买盘。', evidenceRefIds: ['ev-etf'] }],
    marketReaction: [],
    supportingEvidence: [{ statement: '跨境支付试点与加密资产无关。', evidenceRefId: 'news:item-1' }],
    counterEvidence: [{ statement: '资金费率仍在负值。', evidenceRefId: 'ev-funding' }],
    scenarios: [{
      asset: 'BTC', horizon: '0-15m', baseCase: '维持偏空。', conditions: ['资金继续净流出。'],
      invalidation: { kind: 'fact' as const, factId: 'mi-fact-etf', relation: 'above' as const, statement: 'ETF 转为净流入。' },
      status: 'pending'
    }],
    directions: [
      { horizon: 'short', direction: 'bearish', rationale: '短期 ETF 净流出。', confidence: 'medium', evidenceRefIds: ['ev-etf'] },
      { horizon: 'medium', direction: 'range', rationale: '中期缺少方向。', confidence: 'low', evidenceRefIds: ['ev-funding'] },
      { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['ev-etf'] }
    ],
    nextCatalysts: [{ statement: '关注下一次 ETF 数据。', evidenceRefIds: ['ev-etf'] }],
    dataCaveats: [],
    evidenceRefs: ['news:item-1', 'ev-etf', 'ev-funding']
  }
}

const validate = (value: unknown, snapshot = frozenNewsSnapshot(), triggerFocus: TriggerFocus | undefined = focus) =>
  validateAnalysisModelOutput(JSON.stringify(value), snapshot, triggerFocus)

describe('触发型分析必须读那条新闻（R37 C）', () => {
  it('accepts a reading that cites the news and checks two market facts', () => {
    expect(validate(output())).toMatchObject({ ok: true })
  })

  it('rejects a reading that only has the news and no market data', () => {
    // 只有新闻没有数据 = 复述，不算分析：checks 指向舆情事实本身 → 不是市场读数。
    const value = output({
      newsImpact: {
        verdict: 'evaluated',
        checks: [{ factId: 'triggered-news:item-1', effect: 'supports' }, { factId: 'triggered-news:item-1', effect: 'contradicts' }],
        contradiction: true,
        invalidation: { kind: 'fact', factId: 'triggered-news:item-1', relation: 'above', statement: '新闻被推翻。' }
      }
    })
    expect(validate(value)).toMatchObject({ ok: false, rule: 'news-impact-insufficient-data' })
  })

  it('rejects a reading built on market data that never mentions the news', () => {
    // 只有数据没提新闻：论证区引用了市场事实，却没引用触发项的证据。
    // focus 传 undefined：证明这条拒收不依赖焦点规则。
    // 两条规则都会拒这一份：既有的「重点舆情必须被权衡」先命中（触发事实的 metric 就是 news-sentiment），
    // 我们的「必须引用触发项证据」也命中。谁先拒都是拒，但用例要的是「拒」，不是某一个码。
    const value = output()
    value.supportingEvidence[0] = { statement: 'ETF 净流出。', evidenceRefId: 'ev-etf' }
    const result = validate(value, frozenNewsSnapshot(), undefined)
    expect(result).toMatchObject({ ok: false })
    expect(['news-trigger-not-cited', 'sentiment-not-weighed'])
      .toContain((result as { rule?: string }).rule)
  })

  it('rejects a missing newsImpact block when the snapshot carries a trigger', () => {
    const value = output()
    ;(value.conclusion as { newsImpact?: unknown }).newsImpact = undefined
    expect(validate(value)).toMatchObject({ ok: false, rule: 'news-trigger-not-cited', detail: 'news-impact-missing' })
  })

  it('rejects an invented contradiction and an undeclared one', () => {
    expect(validate(output({
      newsImpact: {
        verdict: 'evaluated',
        checks: [{ factId: 'mi-fact-etf', effect: 'supports' }, { factId: 'mi-fact-funding', effect: 'supports' }],
        contradiction: true,
        invalidation: { kind: 'fact', factId: 'mi-fact-etf', relation: 'above', statement: 'ETF 转为净流入。' }
      }
    }))).toMatchObject({ ok: false, rule: 'news-impact-contradiction-mismatch' })
    expect(validate(output({
      newsImpact: {
        verdict: 'evaluated',
        checks: [{ factId: 'mi-fact-etf', effect: 'supports' }, { factId: 'mi-fact-funding', effect: 'contradicts' }],
        contradiction: false,
        invalidation: { kind: 'fact', factId: 'mi-fact-etf', relation: 'above', statement: 'ETF 转为净流入。' }
      }
    }))).toMatchObject({ ok: false, rule: 'news-impact-contradiction-mismatch' })
  })

  it('rejects an invalidation that points at a fact the snapshot does not hold', () => {
    expect(validate(output({
      newsImpact: {
        verdict: 'evaluated',
        checks: [{ factId: 'mi-fact-etf', effect: 'supports' }, { factId: 'mi-fact-funding', effect: 'contradicts' }],
        contradiction: true,
        invalidation: { kind: 'fact', factId: 'mi-fact-not-there', relation: 'above', statement: '跌破支撑。' }
      }
    }))).toMatchObject({ ok: false, rule: 'news-impact-invalidation' })
  })

  it('rejects a gap outside the closed set', () => {
    expect(validate(output({
      newsImpact: { verdict: 'cannot-determine', missing: { item: 'sentiment', state: 'unknown' } }
    }))).toMatchObject({ ok: false, rule: 'news-impact-missing-state' })
  })

  it('rejects "no transmission" that cannot prove it looked', () => {
    expect(validate(output({
      newsImpact: { verdict: 'no-transmission', checkedFactIds: ['mi-fact-etf'], reason: '两者没有传导路径。' }
    }))).toMatchObject({ ok: false, rule: 'news-impact-unchecked' })
    expect(validate(output({
      newsImpact: { verdict: 'no-transmission', checkedFactIds: ['mi-fact-etf', 'mi-fact-gas'], reason: '两者没有传导路径。' }
    }))).toMatchObject({ ok: false, rule: 'news-impact-unchecked' })
  })

  it('keeps the number rule on the reading itself', () => {
    expect(validate(output({
      newsImpact: { verdict: 'no-transmission', checkedFactIds: ['mi-fact-etf', 'mi-fact-funding'], reason: '传导约为 12.5%，可以忽略。' }
    }))).toMatchObject({ ok: false, rule: 'prose-number-citation' })
  })

  it('does not apply to runs a news item did not trigger', () => {
    const { trigger: _withoutTrigger, ...snapshot } = frozenNewsSnapshot()
    expect(validate(output(), snapshot as FrozenAnalysisEvidence, undefined)).toMatchObject({ ok: true })
  })
})
