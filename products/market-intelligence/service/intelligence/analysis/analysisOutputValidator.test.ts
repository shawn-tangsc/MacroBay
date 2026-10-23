import { describe, expect, it } from 'vitest'

import { MARKET_ANALYSIS_CONTRACT_POLICY, MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'
import { marketAnalysisUnsafeOutputPolicy } from './analysisConstants'
import { formatMarketAnalysisAcceptanceMarker, validateAnalysisModelOutput } from './analysisOutputValidator'

describe('analysisOutputValidator', () => {
  it.each([
    { metric: 'event-excerpt', comparability: 'comparable' as const, freshness: 'fresh' as const },
    { metric: 'price-return', comparability: 'not-comparable' as const, freshness: 'fresh' as const },
    { metric: 'price-return', comparability: 'comparable' as const, freshness: 'stale' as const }
  ])('rejects unsupported current market reactions even with matching references: %s', fact => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [{ ...snapshot.facts[0]!, ...fact }]
    expect(validateAnalysisModelOutput(JSON.stringify(validOutput()), snapshot)).toEqual({ ok: false, errorCode: 'analysis-missing-evidence', rule: 'ineligible-market-reaction' })
  })

  it('allows a historical event assessment without claiming a current market reaction', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [{ ...snapshot.facts[0]!, metric: 'event-excerpt', comparability: 'not-comparable', freshness: 'stale' }]
    const output = { ...validOutput(), marketReaction: [], scenarios: [] }
    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toMatchObject({ ok: true })
  })
  it('rejects citing a different frozen event for a metric fact', () => {
    const output = validOutput()
    const snapshot = { facts: [{ ...frozenSnapshot().facts[0]!, evidenceRefId: null }], evidenceRefs: [{ evidenceRefId: 'mi-ev-market-move' }] }
    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({ ok: false, errorCode: 'analysis-missing-evidence', rule: 'fact-evidence-mismatch' })
  })
  it('accepts a safe output whose claims only cite frozen snapshot facts and evidence', () => {
    const result = validateAnalysisModelOutput(JSON.stringify(validOutput()), frozenSnapshot())

    expect(result).toMatchObject({ ok: true, value: { scenarios: [{ asset: 'BTC', status: 'pending' }] } })
  })

  it('rejects a claim that references evidence absent from the frozen snapshot', () => {
    const output = validOutput()
    output.knownFacts[0]!.evidenceRefIds = ['mi-ev-missing']

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-missing-evidence', rule: 'unknown-reference' })
  })

  it('rejects a reaction that substitutes an evidence ID for a frozen fact ID', () => {
    const output = validOutput()
    output.marketReaction[0]!.factIds = ['mi-ev-market-move']

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-missing-evidence', rule: 'unknown-reference' })
  })

  it('rejects a fact claim without an evidence reference', () => {
    const output = validOutput()
    output.knownFacts[0]!.evidenceRefIds = []

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema' })
  })

  it('names the rule that rejected the output, so one message stops meaning three defects', () => {
    // A fact claim that also cites a second, unrelated frozen evidence id. The evidence exists, so
    // this is not "missing evidence" in the reader's sense — it is this rule, and only this one.
    const snapshot = frozenSnapshot()
    snapshot.evidenceRefs = [...snapshot.evidenceRefs, { evidenceRefId: 'mi-ev-other' }]
    const output = validOutput()
    output.knownFacts[0]!.evidenceRefIds = [frozenSnapshot().facts[0]!.evidenceRefId, 'mi-ev-other']

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({
      ok: false, errorCode: 'analysis-missing-evidence', rule: 'fact-evidence-mismatch'
    })
  })

  it('accepts the short handles the prompt hands out and returns the real ids', () => {
    // The prompt no longer contains the stored encodings at all: quoting `f1`/`e1` is what the
    // model does now, and the published summary still carries the ids the audit trail needs.
    const output = validOutput()
    output.knownFacts[0]!.factId = 'f1'
    output.knownFacts[0]!.evidenceRefIds = ['e1']
    output.marketReaction[0]!.factIds = ['F1']
    output.marketReaction[0]!.evidenceRefIds = ['e1']
    output.supportingEvidence[0]!.evidenceRefId = 'e1'
    output.counterEvidence[0]!.evidenceRefId = 'e1'
    output.nextCatalysts[0]!.evidenceRefIds = ['e1']
    output.evidenceRefs = ['e1']
    // The directions cite evidence the same way, so their handles must be rewritten too: without a
    // branch in the resolver every conclusion would fail on `direction-evidence-mismatch`.
    output.directions = output.directions.map(entry => ({ ...entry, evidenceRefIds: ['e1'] }))

    const result = validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())

    expect(result.ok).toBe(true)
    expect(result.ok ? result.value.knownFacts[0] : undefined).toEqual({
      factId: 'mi-fact-btc-return', statement: '比特币在事件后十五分钟内发生变化。', evidenceRefIds: ['mi-ev-market-move']
    })
    expect(result.ok ? result.value.evidenceRefs : []).toEqual(['mi-ev-market-move'])
    // Every horizon's evidence handle came back as the stored id.
    expect(result.ok ? result.value.directions.flatMap(entry => entry.evidenceRefIds) : [])
      .toEqual(['mi-ev-market-move', 'mi-ev-market-move', 'mi-ev-market-move'])
  })

  it('still reports a handle that resolves to nothing as an unknown reference', () => {
    const output = validOutput()
    output.knownFacts[0]!.factId = 'f999'

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({
      ok: false, errorCode: 'analysis-missing-evidence', rule: 'unknown-reference'
    })
  })

  it('rejects formal output without a top-level evidence reference', () => {
    const output = validOutput()
    output.evidenceRefs = []

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema' })
  })

  it('rejects an unknown scenario horizon', () => {
    const output = validOutput()
    output.scenarios[0]!.horizon = '1h'

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema' })
  })

  it('rejects model output that attempts to publish a non-pending prediction state', () => {
    const output = validOutput()
    output.scenarios[0]!.status = 'confirmed'

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema' })
  })

  it('removes a URL and a local path without exposing them, keeping the conclusion usable', () => {
    // The conclusion survives with the offending value removed. Refusing the whole
    // run made a usable analysis disappear the moment the model cited a URL.
    const output = validOutput()
    output.conclusion.summary = '详细内容 https://provider.example/api 与 /Users/operator/provider/raw.json。'

    const result = validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())
    expect(result.ok).toBe(true)
    const assessment = result.ok ? result.value.conclusion.summary : ''
    expect(assessment).not.toContain('https://')
    expect(assessment).not.toContain('/Users/operator')
    expect(assessment).toContain(marketAnalysisUnsafeOutputPolicy.redactionToken)
    expect(result.ok ? result.redactions.length : 0).toBeGreaterThan(0)
  })

  it('removes credential-shaped content without returning it', () => {
    const credentialOutput = validOutput()
    credentialOutput.dataCaveats = ['provider_error: bearer secret']

    const result = validateAnalysisModelOutput(JSON.stringify(credentialOutput), frozenSnapshot())
    expect(result.ok).toBe(true)
    expect(JSON.stringify(result.ok ? result.value.dataCaveats : [])).not.toMatch(/bearer|secret|provider_error/iu)
    expect(result.ok ? result.redactions : []).toEqual([expect.objectContaining({ path: expect.stringContaining('dataCaveats') })])
  })

  it('rejects outputs beyond the configured byte budget', () => {
    const output = validOutput()
    output.conclusion.summary = 'x'.repeat(MARKET_ANALYSIS_CONTRACT_POLICY.maximumModelOutputBytes)

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema' })
  })

  it('prints the safe acceptance marker required for manual verification', () => {
    const marker = formatMarketAnalysisAcceptanceMarker({ valid: 1, rejectedUnsafe: 1, rejectedMissingEvidence: 1 })
    console.log(marker)
    expect(marker).toBe('{"marker":"MI_ANALYSIS_ACCEPTANCE","package":"MI-A01","event":"output-validator","status":"pass","details":{"valid":1,"rejectedUnsafe":1,"rejectedMissingEvidence":1}}')
  })
})

function frozenSnapshot(): import('./analysisOutputValidator').FrozenAnalysisEvidence & { facts: import('../../../contracts/marketAnalysisContracts').AgentFact[] } {
  return {
    facts: [{ factId: 'mi-fact-btc-return', evidenceRefId: 'mi-ev-market-move', metric: 'price-return', comparability: 'comparable', freshness: 'fresh', domain: 'cross-asset', subject: 'BTC', value: 1, unit: '%', sourceId: 'source', sourceLabel: 'source', observedAt: '2026-10-04T00:00:00.000Z', asOf: '2026-10-04T00:00:00.000Z', confidence: 1 }],
    evidenceRefs: [{ evidenceRefId: 'mi-ev-market-move' }]
  }
}

function validOutput() {
  return {
    conclusion: {
      direction: 'bullish' as const,
      summary: '宏观发布后，比特币出现可观察的短期反应。',
      change: '稳定币 1 日变化升至 +2.4 亿美元。',
      causalChain: '通胀低于预期 → 实际利率回落 → 风险偏好回升 → 因此短期偏多。',
      conditions: ['风险偏好回升持续一个交易日。'],
      macro: '美元走弱、美债收益率回落。',
      evidenceStrength: '支持证据来自最新成交与资金流。',
      dataGaps: []
    },
    knownFacts: [{ factId: 'mi-fact-btc-return', statement: '比特币在事件后十五分钟内发生变化。', evidenceRefIds: ['mi-ev-market-move'] }],
    transmissionHypotheses: [{ statement: '该反应可能与风险偏好变化相关。', evidenceRefIds: ['mi-ev-market-move'] }],
    marketReaction: [{ statement: 'BTC 价格出现短期变化。', factIds: ['mi-fact-btc-return'], evidenceRefIds: ['mi-ev-market-move'] }],
    supportingEvidence: [{ statement: '市场反应事实可见。', evidenceRefId: 'mi-ev-market-move' }],
    counterEvidence: [{ statement: '当前证据不足以确认因果关系。', evidenceRefId: 'mi-ev-market-move' }],
    scenarios: [{ asset: 'BTC', horizon: '0-15m', baseCase: '维持条件式观察。', conditions: ['后续价格数据保持可比。'], invalidation: '出现相反且可比的新事实。', status: 'pending' }],
    directions: [
    { horizon: 'short', direction: 'bullish', rationale: '短期资金流转正。', confidence: 'medium', evidenceRefIds: ['mi-ev-market-move'] },
    { horizon: 'medium', direction: 'range', rationale: '中期缺少方向性资金。', confidence: 'low', evidenceRefIds: ['mi-ev-market-move'] },
    { horizon: 'long', direction: 'undecided', rationale: '长期证据不足。', confidence: 'low', evidenceRefIds: ['mi-ev-market-move'] }
    ],
    nextCatalysts: [{ statement: '关注下一次官方发布。', evidenceRefIds: ['mi-ev-market-move'] }],
    dataCaveats: ['相关性不代表因果关系。'],
    evidenceRefs: ['mi-ev-market-move']
  }
}

it('requires one operation direction per horizon, and names the rule when one is missing', () => {
  const complete = validateAnalysisModelOutput(JSON.stringify(validOutput()), frozenSnapshot())
  expect(complete.ok).toBe(true)
  expect(complete.ok && complete.value.directions.map(entry => entry.horizon)).toEqual(['short', 'medium', 'long'])

  const missing = validOutput()
  missing.directions = missing.directions.filter(entry => entry.horizon !== 'long')
  expect(validateAnalysisModelOutput(JSON.stringify(missing), frozenSnapshot()))
    .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema, rule: 'direction-horizons-incomplete' })

  // A repeated horizon is the same defect: the reader asked for three answers, not two plus an echo.
  const duplicated = validOutput()
  duplicated.directions = [duplicated.directions[0]!, duplicated.directions[0]!, duplicated.directions[2]!]
  expect(validateAnalysisModelOutput(JSON.stringify(duplicated), frozenSnapshot()))
    .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema, rule: 'direction-horizons-incomplete' })
})

it('names a direction that cites evidence the snapshot does not hold', () => {
  const output = validOutput()
  output.directions = output.directions.map(entry => ({ ...entry, evidenceRefIds: ['mi-ev-absent'] }))
  // Its own rule, not the shared unknown-reference: the two are different defects.
  expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot()))
    .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence, rule: 'direction-evidence-mismatch' })
})

it('refuses a direction outside the five terms, a confidence it cannot colour, or an empty reason', () => {
  for (const mutate of [
    (output: ReturnType<typeof validOutput>) => { output.directions[0]!.direction = '看多' },
    (output: ReturnType<typeof validOutput>) => { (output.directions[0] as { confidence: string }).confidence = 'certain' },
    (output: ReturnType<typeof validOutput>) => { output.directions[0]!.rationale = '' },
    (output: ReturnType<typeof validOutput>) => { output.directions[0]!.evidenceRefIds = [] }
  ]) {
    const output = validOutput()
    mutate(output)
    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot()))
      .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema })
  }
})

it('refuses a conclusion with no summary, and a translated direction term', () => {
  const emptySummary = validOutput()
  emptySummary.conclusion.summary = ''
  expect(validateAnalysisModelOutput(JSON.stringify(emptySummary), frozenSnapshot()))
    .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema })

  // The direction is a language-neutral key; a translated word is a contract violation, not a
  // reader-language choice.
  const translated = validOutput()
  translated.conclusion.direction = '偏空' as never
  expect(validateAnalysisModelOutput(JSON.stringify(translated), frozenSnapshot()))
    .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema })
})

it('accepts a fully English conclusion because the contract carries no natural-language tokens', () => {
  const output = {
    ...validOutput(),
    conclusion: {
      ...validOutput().conclusion,
      summary: 'Yields rose after the print, pressuring risk assets.',
      change: 'ETF flows turned negative.',
      causalChain: 'hot CPI → higher real yields → lower risk appetite.',
      conditions: ['Real yields stay elevated.'],
      macro: 'Treasuries sold off.',
      evidenceStrength: 'Counter-evidence is thin.',
      dataGaps: ['No consensus value was available.']
    }
  }

  expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toMatchObject({ ok: true })
})
