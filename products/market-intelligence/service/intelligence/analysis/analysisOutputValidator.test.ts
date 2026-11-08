import { describe, expect, it } from 'vitest'

import { MARKET_ANALYSIS_CONTRACT_POLICY, MARKET_ANALYSIS_ERROR_CODES } from '../../../contracts/marketAnalysisContracts'
import { marketAnalysisUnsafeOutputPolicy } from './analysisConstants'
import { analysisValidationRules, formatMarketAnalysisAcceptanceMarker, validateAnalysisModelOutput } from './analysisOutputValidator'

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
  it('accepts a conclusion that cites a derived surprise fact', () => {
    const snapshot = frozenSnapshot()
    const surprise = {
      ...snapshot.facts[0]!, factId: 'mi-fact-macro-surprise', domain: 'macro' as const,
      subject: 'consumer-price-index', metric: 'surprise', value: 0.3, unit: 'pp'
    }
    snapshot.facts = [surprise]
    const output = {
      ...validOutput(),
      knownFacts: [{ factId: surprise.factId, statement: 'CPI 年率超预期 +0.3 个百分点。', evidenceRefIds: ['mi-ev-market-move'] }],
      marketReaction: []
    }

    const result = validateAnalysisModelOutput(JSON.stringify(output), snapshot)
    expect(result.ok).toBe(true)
    expect(result.ok ? result.value.knownFacts[0]?.factId : undefined).toBe('mi-fact-macro-surprise')
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

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema', rule: 'shape:knownFacts' })
  })

  it('names the rule that rejected the output, so one message stops meaning three defects', () => {
    // A fact claim that also cites a second, unrelated frozen evidence id. The evidence exists, so
    // this is not "missing evidence" in the reader's sense — it is this rule, and only this one.
    const base = frozenSnapshot()
    const snapshot = { ...base, evidenceRefs: [...base.evidenceRefs, { evidenceRefId: 'mi-ev-other' }] } as TestSnapshot
    const output = validOutput()
    output.knownFacts[0]!.evidenceRefIds = [base.facts[0]!.evidenceRefId!, 'mi-ev-other']

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

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema', rule: 'shape:evidenceRefs' })
  })

  it('rejects an unknown scenario horizon', () => {
    const output = validOutput()
    output.scenarios[0]!.horizon = '1h'

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema', rule: 'shape:scenarios' })
  })

  it('rejects model output that attempts to publish a non-pending prediction state', () => {
    const output = validOutput()
    output.scenarios[0]!.status = 'confirmed'

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema', rule: 'shape:scenarios' })
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

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toEqual({ ok: false, errorCode: 'analysis-invalid-output-schema', rule: 'shape:too-large' })
  })

  it('prints the safe acceptance marker required for manual verification', () => {
    const marker = formatMarketAnalysisAcceptanceMarker({ valid: 1, rejectedUnsafe: 1, rejectedMissingEvidence: 1 })
    console.log(marker)
    expect(marker).toBe('{"marker":"MI_ANALYSIS_ACCEPTANCE","package":"MI-A01","event":"output-validator","status":"pass","details":{"valid":1,"rejectedUnsafe":1,"rejectedMissingEvidence":1}}')
  })
  it('accepts a policy probability that carries the frozen as-of it came from', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact()]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：市场定价 71%，截至 10-30 15:00 UTC；SEP 中位 4.1%（09-16 那场）。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toMatchObject({ ok: true })
  })

  it('rejects a policy probability without its as-of', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact()]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：市场定价 71%，SEP 中位 4.1%。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence,
      rule: 'policy-probability-citation', detail: 'policy-probability-missing-instant'
    })
  })

  it('rejects a probability-shaped number the snapshot does not carry', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact()]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：市场定价 65%，截至 2026-10-30 15:00 UTC。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence,
      rule: 'policy-probability-citation', detail: 'policy-probability-not-frozen'
    })
  })

  it('accepts the rounded value the prompt asks for, and still rejects a fabricated one', () => {
    // `04` §3.4.1：正文用约数（约 77%），两位小数进留痕区——四舍五入到整百分点是**合规写法**。
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact(76.65)]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：市场定价 77%，截至 2026-10-30 15:00 UTC。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toMatchObject({ ok: true })

    // 编造仍然拒：70% 既不等值、也不等于快照值的四舍五入。
    const fabricated = validOutput()
    fabricated.conclusion.macro = '政策与市场定价：市场定价 70%，截至 2026-10-30 15:00 UTC。'
    expect(validateAnalysisModelOutput(JSON.stringify(fabricated), snapshot)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence,
      rule: 'policy-probability-citation', detail: 'policy-probability-not-frozen'
    })
  })

  it('rejects a conclusion that says nothing about a frozen policy probability', () => {
    // The cheapest way to pass "the cited value must equal the snapshot" is to cite no value at all.
    // Without this rule the reader gets a complete-looking analysis with the policy pricing missing.
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact()]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：目标区间 4.00%–4.25%，下次会议 2026-12-09，SEP 中位 4.1%。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence,
      rule: 'policy-probability-citation', detail: 'policy-probability-absent'
    })
  })

  it('does not require a probability when the snapshot carries none', () => {
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：目标区间 4.00%–4.25%，下次会议 2026-12-09。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot())).toMatchObject({ ok: true })
  })

  it('keeps a rounded value accepted when the frozen value is already whole', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact(66)]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：市场定价 66%，截至 2026-10-30 15:00 UTC。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toMatchObject({ ok: true })
  })

  it('does not judge the target range just because it sits after the word 定价', () => {
    // The prompt itself asks for the target range in a paragraph that starts with 「政策与市场定价：」.
    // A sixteen-character window swallowed 4.00% and rejected a correct conclusion for mentioning it.
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact()]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：目标区间 4.00%–4.25%，下次会议 2026-12-09，市场定价 71%，截至 10-30 15:00 UTC。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toMatchObject({ ok: true })
  })

  it('requires every mentioned meeting to carry its own as-of, not one shared instant', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact(66, '2026-10-30T15:00:00.000Z'), policyProbabilityFact(48, '2026-12-09T15:00:00.000Z')]
    const output = validOutput()
    // Both values are frozen, but only one meeting's instant is written.
    output.conclusion.macro = '政策与市场定价：12-09 那场概率 48%，01-27 那场概率 66%，截至 10-30 15:00 UTC。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence,
      rule: 'policy-probability-citation', detail: 'policy-probability-missing-instant'
    })
  })

  it('accepts two meetings when each probability carries its own instant', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact(66, '2026-10-30T15:00:00.000Z'), policyProbabilityFact(48, '2026-12-09T15:00:00.000Z')]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：12-09 那场概率 48%，截至 12-09 15:00 UTC；01-27 那场概率 66%，截至 10-30 15:00 UTC。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toMatchObject({ ok: true })
  })

  it('still rejects a probability phrased as an official expectation when the as-of is missing', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, policyProbabilityFact(66)]
    const output = validOutput()
    output.conclusion.macro = '政策与市场定价：官方预期概率 66%。'

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence,
      rule: 'policy-probability-citation', detail: 'policy-probability-missing-instant'
    })
  })

})

type TestSnapshot = import('./analysisOutputValidator').FrozenAnalysisEvidence & { facts: import('../../../contracts/marketAnalysisContracts').AgentFact[] }

function frozenSnapshot(): TestSnapshot {
  // The fixture is wider than the validator's read-only view (it carries source/unit/confidence for
  // the prompt tests), so it is built as data and narrowed once here instead of casting at each use.
  return {
    facts: [{ factId: 'mi-fact-btc-return', evidenceRefId: 'mi-ev-market-move', metric: 'price-return', comparability: 'comparable', freshness: 'fresh', domain: 'cross-asset', subject: 'BTC', value: 1, unit: '%', sourceId: 'source', sourceLabel: 'source', observedAt: '2026-10-04T00:00:00.000Z', asOf: '2026-10-04T00:00:00.000Z', confidence: 1 }],
    evidenceRefs: [{ evidenceRefId: 'mi-ev-market-move' }]
  } as unknown as TestSnapshot
}

function policyProbabilityFact(value = 71, observedAt = '2026-10-30T15:00:00.000Z'): import('../../../contracts/marketAnalysisContracts').AgentFact {
  return {
    factId: `mi-fact-macro-policy-implied-probability-${value}-${observedAt}`, evidenceRefId: 'mi-ev-policy',
    metric: 'policy-implied-probability', domain: 'macro', subject: 'hike-25', value, unit: '%',
    sourceId: 'policy-path-market', sourceLabel: 'policy-path-market',
    observedAt, asOf: observedAt,
    freshness: 'fresh', confidence: 1, comparability: 'comparable',
    sourceUrl: 'https://polymarket.com/'
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

describe('trigger focus', () => {
  const focus = {
    mode: 'strict' as const,
    triggers: [{ factId: 'mi-fact-btc-return', evidenceRefId: 'mi-ev-market-move', subject: 'BTC' }]
  }

  it('accepts a conclusion that cites the trigger in a reasoning section and names it', () => {
    const output = validOutput()
    output.conclusion.change = 'BTC 在事件后十五分钟内上涨。'
    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot(), focus)).toMatchObject({ ok: true })
  })

  it('rejects a conclusion that cites something else and talks about the backdrop', () => {
    const base = frozenSnapshot()
    const snapshot = { ...base, evidenceRefs: [...base.evidenceRefs, { evidenceRefId: 'mi-ev-other' }] } as TestSnapshot
    const output = validOutput()
    output.conclusion.change = 'BTC 在事件后十五分钟内上涨。'
    // The evidence it reasons from is real, but it is not the change that triggered the run.
    output.supportingEvidence = [{ statement: '资金费率变化可见。', evidenceRefId: 'mi-ev-other' }]
    output.marketReaction = []
    output.directions = output.directions.map(entry => ({ ...entry, evidenceRefIds: ['mi-ev-other'] }))

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot, focus)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence, rule: 'missing-trigger-focus'
    })
  })

  it('does not count a registration in knownFacts as an answer', () => {
    const base = frozenSnapshot()
    const snapshot = { ...base, evidenceRefs: [...base.evidenceRefs, { evidenceRefId: 'mi-ev-other' }] } as TestSnapshot
    const output = validOutput()
    output.conclusion.change = 'BTC 在事件后十五分钟内上涨。'
    // Only the inventory cites the trigger; the reasoning sections cite something else.
    output.supportingEvidence = [{ statement: '资金费率变化可见。', evidenceRefId: 'mi-ev-other' }]
    output.marketReaction = []
    output.directions = output.directions.map(entry => ({ ...entry, evidenceRefIds: ['mi-ev-other'] }))

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot, focus))
      .toMatchObject({ ok: false, rule: 'missing-trigger-focus' })
  })

  it('rejects a conclusion that cites the trigger but never says what it was', () => {
    // validOutput cites mi-ev-market-move in a reasoning section, but neither change nor
    // causalChain names BTC: exactly "I have the news, and I am still talking about macro".
    expect(validateAnalysisModelOutput(JSON.stringify(validOutput()), frozenSnapshot(), focus))
      .toMatchObject({ ok: false, rule: 'missing-trigger-focus' })
  })

  it('does not judge a run whose snapshot has no change record', () => {
    const noChange = { mode: 'not-applicable:no-change' as const, triggers: [] }
    expect(validateAnalysisModelOutput(JSON.stringify(validOutput()), frozenSnapshot(), noChange)).toMatchObject({ ok: true })
  })

  it('accepts any one of several simultaneous triggers', () => {
    const output = validOutput()
    output.conclusion.change = 'CPI 从 3.2 升到 3.4。'
    output.supportingEvidence = [{ statement: 'CPI 实际上升。', evidenceRefId: 'mi-ev-market-move' }]
    const multi = {
      mode: 'strict' as const,
      triggers: [
        { factId: 'a', evidenceRefId: 'mi-ev-absent', subject: 'Greek tax news' },
        { factId: 'mi-fact-btc-return', evidenceRefId: 'mi-ev-market-move', subject: 'CPI' }
      ]
    }
    expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot(), multi)).toMatchObject({ ok: true })
  })
})

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

it('reports a reply that is not JSON as invalid JSON, not as a schema mismatch', () => {
  // A fenced or truncated reply is a different defect from a JSON object with extra fields, and
  // the reader can act on the difference. Both used to arrive as `analysis-invalid-output-schema`.
  expect(validateAnalysisModelOutput('```json\n{"conclusion":{}}\n```', frozenSnapshot()))
    .toEqual({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidJson })
})

it('names the top-level key the model omitted or invented, so a rejection is diagnosable', () => {
  const missing = validOutput() as Record<string, unknown>
  delete missing.counterEvidence
  expect(validateAnalysisModelOutput(JSON.stringify(missing), frozenSnapshot()))
    .toMatchObject({
      ok: false,
      errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema,
      rule: 'shape:top-level:missing-counterEvidence'
    })

  const extra = { ...validOutput(), notes: 'not part of the contract' }
  expect(validateAnalysisModelOutput(JSON.stringify(extra), frozenSnapshot()))
    .toMatchObject({ ok: false, rule: 'shape:top-level:extra-notes' })
})

it('names the section whose shape the model got wrong', () => {
  const output = validOutput()
  ;(output.directions[0] as { confidence: string }).confidence = 'certain'
  expect(validateAnalysisModelOutput(JSON.stringify(output), frozenSnapshot()))
    .toMatchObject({
      ok: false,
      errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema,
      rule: 'shape:directions'
    })
})

it('requires the conclusion to cite the key sentiment when the snapshot carries it', () => {
  const snapshot = frozenSnapshot()
  const news = {
    ...snapshot.facts[0]!, factId: 'mi-fact-news-1', evidenceRefId: 'mi-ev-news', domain: 'sentiment' as const,
    subject: 'market', metric: 'news-sentiment', value: 'bearish · strength 4/5 · confidence 80%｜Exchange outage',
    unit: null, freshness: 'fresh' as const, comparability: 'not-comparable' as const
  }
  snapshot.facts = [...snapshot.facts, news]
  const withNews = { ...snapshot, evidenceRefs: [...snapshot.evidenceRefs, { evidenceRefId: 'mi-ev-news' }] } as TestSnapshot

  // A conclusion that ignores the appended key sentiment cannot be said to have weighed it.
  expect(validateAnalysisModelOutput(JSON.stringify(validOutput()), withNews))
    .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence, rule: 'sentiment-not-weighed' })

  const cited = validOutput()
  cited.knownFacts.push({ factId: 'mi-fact-news-1', statement: '舆情偏空，支持谨慎判断。', evidenceRefIds: ['mi-ev-news'] })
  expect(validateAnalysisModelOutput(JSON.stringify(cited), withNews)).toMatchObject({ ok: true })
})

/**
 * 背离一致性（`02` 系统设计 §校验规则）：卡说背离、分析说没背离，现在有码可判。
 *
 * 三条判据——A 事实说背离、输出说不背离 → 拒；B 事实说没背离、输出说背离 → 拒；
 * 沉默（不带这块）→ 通过。删掉这条校验，A/B 会变 ok，这三条用例就是红的。
 */
describe('divergence consistency', () => {
  const divergenceFact = (pairId: string, value: string) => ({
    factId: `mi-fact-divergence-${pairId}`, evidenceRefId: 'mi-ev-market-move',
    metric: `divergence-${pairId}`, domain: 'cross-asset' as const, subject: pairId, value, unit: null,
    sourceId: 'source', sourceLabel: 'source',
    observedAt: '2026-10-04T00:00:00.000Z', asOf: '2026-10-04T00:00:00.000Z',
    freshness: 'fresh' as const, confidence: 1, comparability: 'comparable' as const
  })

  // 允许"坏形状"的条目进入夹具：形状用例要能送一个缺 stance 的对象。
  const withDivergences = (divergences: readonly Readonly<Record<string, unknown>>[]) =>
    ({ ...validOutput(), divergences })

  it('is registered as its own rule, not merged into the reference rule', () => {
    // 分开的理由：这条的修法是"改判断"，引用那条的修法是"补一个存在的引用"。
    expect(analysisValidationRules.divergenceContradiction).toBe('divergence-contradiction')
    expect(analysisValidationRules.divergenceContradiction).not.toBe(analysisValidationRules.directionEvidenceMismatch)
  })

  it('rejects an output that calls a diverging pair "not diverging" (fixture A)', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, divergenceFact('narrative-price', 'bearish')]
    const output = withDivergences([{ pairId: 'narrative-price', stance: 'not-diverging' }])

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence, rule: 'divergence-contradiction'
    })
  })

  it('rejects an output that calls a pair with no divergence "diverging" (fixture B)', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, divergenceFact('flows-price', 'none')]
    const output = withDivergences([{ pairId: 'flows-price', stance: 'diverging' }])

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toEqual({
      ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.missingEvidence, rule: 'divergence-contradiction'
    })
  })

  it('passes when the stance agrees with the evidence', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, divergenceFact('narrative-price', 'bearish')]
    const output = withDivergences([{ pairId: 'narrative-price', stance: 'diverging' }])

    expect(validateAnalysisModelOutput(JSON.stringify(output), snapshot)).toMatchObject({ ok: true })
  })

  it('stays silent when the output omits the block — silence is not disagreement', () => {
    // 沉默不判：不带这块、或只提别的对 → 通过（否则等于逼分析点头）。
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, divergenceFact('narrative-price', 'bearish'), divergenceFact('flows-price', 'none')]

    expect(validateAnalysisModelOutput(JSON.stringify(validOutput()), snapshot)).toMatchObject({ ok: true })
    expect(validateAnalysisModelOutput(JSON.stringify(withDivergences([])), snapshot)).toMatchObject({ ok: true })
    // 只提与证据一致的那一对，另一对没提也不判。
    expect(validateAnalysisModelOutput(JSON.stringify(withDivergences([{ pairId: 'narrative-price', stance: 'diverging' }])), snapshot))
      .toMatchObject({ ok: true })
  })

  it('refuses a pairId the snapshot does not hold, and a malformed entry', () => {
    const snapshot = frozenSnapshot()
    snapshot.facts = [...snapshot.facts, divergenceFact('narrative-price', 'bearish')]

    expect(validateAnalysisModelOutput(JSON.stringify(withDivergences([{ pairId: 'made-up-pair', stance: 'diverging' }])), snapshot))
      .toMatchObject({ ok: false, rule: 'unknown-reference' })
    expect(validateAnalysisModelOutput(JSON.stringify(withDivergences([{ pairId: 'narrative-price' }])), snapshot))
      .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema, rule: 'shape:divergences' })
    expect(validateAnalysisModelOutput(JSON.stringify(withDivergences([{ pairId: 'narrative-price', stance: 'maybe' }])), snapshot))
      .toMatchObject({ ok: false, errorCode: MARKET_ANALYSIS_ERROR_CODES.invalidOutputSchema, rule: 'shape:divergences' })
  })
})
