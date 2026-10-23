import { describe, expect, it } from 'vitest'

import { validateAnalysisModelOutput } from './analysisOutputValidator'
import { marketAnalysisUnsafeOutputPolicy } from './analysisConstants'

/**
 * A payload that satisfies every structural rule, so the only thing under test is
 * the handling of a prohibited pattern.
 */
const output = (summary: string) => JSON.stringify({
  conclusion: {
    direction: 'bullish',
    summary,
    change: 'ETF 流入由负转正。',
    causalChain: '机构需求回升 → 现货买盘增加 → 价格获得支撑。',
    conditions: ['流入延续一个交易日。'],
    macro: null,
    evidenceStrength: null,
    dataGaps: []
  },
  knownFacts: [{ factId: 'f1', evidenceRefIds: ['ev-1'], statement: '美国 9 月非农 +29K' }],
  transmissionHypotheses: [],
  marketReaction: [],
  supportingEvidence: [],
  counterEvidence: [],
  scenarios: [],
  directions: [
    { horizon: 'short', direction: 'bullish', rationale: '短期资金流转正。', confidence: 'medium', evidenceRefIds: ['ev-1'] },
    { horizon: 'medium', direction: 'range', rationale: '中期缺少方向性资金。', confidence: 'low', evidenceRefIds: ['ev-1'] },
    { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['ev-1'] }
  ],
  nextCatalysts: [],
  dataCaveats: [],
  evidenceRefs: ['ev-1']
})

const evidence = {
  facts: [{ factId: 'f1', metric: 'actual', comparability: 'comparable', freshness: 'fresh', evidenceRefId: 'ev-1' }],
  evidenceRefs: [{ evidenceRefId: 'ev-1' }]
} as never

describe('unsafe output handling', () => {
  it('redacts a URL instead of throwing the whole conclusion away', () => {
    const result = validateAnalysisModelOutput(
      output('ETF 流入回升，据 https://example.com/report 显示机构需求改善。'),
      evidence
    )

    expect(result.ok).toBe(true)
    const summary = result.ok ? result.value.conclusion.summary : ''
    expect(summary).toContain('机构需求改善')
    expect(summary).not.toContain('https://')
    expect(summary).toContain(marketAnalysisUnsafeOutputPolicy.redactionToken)
  })

  it('redacts a sensitive token wherever it appears in the payload', () => {
    const result = validateAnalysisModelOutput(output('provider body 未经校验。'), evidence)
    expect(result.ok).toBe(true)
    expect(result.ok ? result.value.conclusion.summary : '').not.toMatch(/provider[_-]?body/iu)
    expect(result.ok ? result.value.conclusion.summary : '').toContain(marketAnalysisUnsafeOutputPolicy.redactionToken)
  })

  it('names the field that carried the unsafe value, so the failure is diagnosable', () => {
    const result = validateAnalysisModelOutput(output('见 www.example.com。'), evidence)
    expect(result.ok).toBe(true)
    expect(result.ok ? result.redactions : []).toEqual([expect.objectContaining({ path: '.conclusion.summary' })])
  })

  it('reports no redaction for a clean payload', () => {
    const result = validateAnalysisModelOutput(output('就业走弱，宽松预期上升。'), evidence)
    expect(result.ok).toBe(true)
    expect(result.ok ? result.redactions : null).toEqual([])
  })

  it('still refuses a payload that cannot be parsed or has the wrong shape', () => {
    expect(validateAnalysisModelOutput('not json', evidence)).toEqual({ ok: false, errorCode: 'analysis-invalid-json' })
    expect(validateAnalysisModelOutput(JSON.stringify({ conclusion: 'x' }), evidence)).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema' })
  })
})
