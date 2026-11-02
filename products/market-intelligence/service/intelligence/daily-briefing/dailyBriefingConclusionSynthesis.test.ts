import { describe, expect, it } from 'vitest'

import type { BriefingPriorConclusion, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { applyDailyBriefingEditorial, validateDailyBriefingEditorial } from './dailyBriefingValidation'
import { briefingConclusionBasis, validateConclusionSynthesis } from './dailyBriefingConclusionValidation'
import { briefingEditionRowIds } from './dailyBriefingEditionSet'
import { validateEditorialForPeriod } from './dailyBriefingPeriodFactsValidation'
import { repairPromptFor } from './dailyBriefingPrompt'

const document = (): DailyBriefingDocument => ({
  schemaVersion: 1,
  policyVersion: 'daily-briefing.v1',
  edition: {
    date: '2026-10-30', locale: 'zh-CN', generatedAt: '2026-10-30T00:30:00.000Z',
    windowStart: '2026-10-29T00:30:00.000Z', windowEnd: '2026-10-30T00:30:00.000Z', timeZone: 'Asia/Shanghai'
  },
  status: {
    readings: [
      { id: 'fear-greed', state: 'available' }, { id: 'funding', state: 'available' },
      { id: 'capital', state: 'available' }, { id: 'calendar', state: 'available' }
    ],
    readingsAvailable: 4, readingsTotal: 4
  },
  lede: { source: 'template', text: '', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: {
    items: [{
      itemId: 'n1', title: 'Risk appetite fades', sourceName: 'CoinDesk RSS',
      publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
    }],
    macro: [{
      eventKey: 'US.CPI', title: 'cpi', scheduledAt: '2026-10-29T12:30:00.000Z',
      importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%',
      surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
    }],
    notes: {}
  },
  data: {
    market: [{
      id: 'btc', labelKey: 'dailyBriefing.row.btc',
      importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' },
      state: 'available', value: { number: -1.1, format: 'percent' }, change: null,
      window: '24h', observedAt: '2026-10-30T00:25:00.000Z'
    }],
    funds: [
      {
        id: 'etf-btc', group: 'funds', labelKey: 'dailyBriefing.row.etfBtc',
        importance: { tier: 'support', source: 'rule', reasonCode: 'etf-flow' },
        state: 'available', value: { number: -643_200_000, format: 'flow-usd' }, change: null,
        window: 'trading-day', observedAt: '2026-10-30T00:20:00.000Z'
      },
      {
        id: 'funding-btc', group: 'funds', labelKey: 'dailyBriefing.row.fundingBtc',
        importance: { tier: 'support', source: 'rule', reasonCode: 'funding-extreme' },
        state: 'available', value: { number: 0.0036, format: 'percent' }, change: null,
        window: '24h', observedAt: '2026-10-30T00:20:00.000Z'
      }
    ],
    sentiment: {
      fearGreed: null,
      news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 1 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 'Stablecoin contraction pulls bids away.', conditions: [], invalidations: [],
    counterEvidence: [], topSignal: null, dataGaps: [], caveats: [], synthesis: 'fallback'
  },
  next: { items: [] },
  citations: [],
  provenance: { summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z' }
})

const editorial = (conclusionSynthesis?: unknown) => ({
  lede: 'CPI 超预期与资金面收缩同向，BTC 承压。',
  ledePattern: 'tension',
  items: [
    { factId: 'news:n1', why: '风险偏好回落。' },
    { factId: 'macro:US.CPI', why: 'CPI 超预期压低降息预期。' }
  ],
  hidden: [],
  importance: [],
  ...(conclusionSynthesis !== undefined ? { conclusionSynthesis } : {})
})

const bearishPrior = (): BriefingPriorConclusion => ({
  id: 'analysis:mi-as-1', source: 'analysis', observedAt: '2026-10-29T08:00:00.000Z',
  asOf: '2026-10-29T08:00:00.000Z', direction: 'bearish', confidence: 'high',
  summary: 'Flows pull bids away.', rationale: 'Flows turned negative.', evidenceRefs: ['ev-1']
})

const bullishBriefPrior = (): BriefingPriorConclusion => ({
  id: 'daily-brief:2026-10-29:zh-CN', source: 'daily-brief', observedAt: '2026-10-29T20:00:00.000Z',
  asOf: '2026-10-29T20:00:00.000Z', direction: 'bullish', confidence: 'medium',
  summary: 'Liquidity expansion supports bids.', rationale: 'Price lags flows.', evidenceRefs: ['ev-9']
})

const synthesis = (overrides: Record<string, unknown> = {}) => ({
  direction: 'bearish',
  confidence: 'high',
  summary: '美国 CPI 同比 3.4%，高于预期 3.2%，通过压低降息预期导致实际利率上行，BTC 因此承压下跌 1.10%。未来两到三个交易日基准情形偏空：BTC 弱于 ETH，若 ETF 流出维持在 -6.43 亿美元附近，反弹空间有限。',
  outlook: '未来两到三个交易日基准情形偏空：BTC 弱于 ETH，ETF 流出 -6.43 亿美元尚未收窄，反弹空间受限。',
  conditions: ['ETF 流出维持在 -6.43 亿美元附近，且资金费率不转负。'],
  counterEvidence: ['若 ETF 转为净流入 6.43 亿美元且 BTC 收复 1.10% 跌幅，则偏空判断失效。'],
  watch: ['ETF 净流出 -6.43 亿美元是否收窄', 'BTC 资金费率 0.00% 是否转负', '美国 CPI 3.4% 后的降息预期'],
  regimeChange: '与上一交易日相比，BTC 由持平转为下跌 1.10%，CPI 超预期后反弹没有延续。',
  confirmed: ['CPI 3.4% 高于预期 3.2%，BTC 的反弹在数据公布后停止。'],
  refuted: ['CPI 回落后 BTC 会反弹的判断被 3.4% 的实际值推翻。'],
  coreTension: 'CPI 3.4% 高于预期 3.2%，但 BTC 只下跌 1.10%，卖盘没有加速。',
  whatWouldChange: '若 BTC 收复 1.10% 跌幅且 ETF 转为净流入 6.43 亿美元，则偏空判断失效。',
  evidenceRefs: ['data:btc', 'macro:US.CPI', 'data:etf-btc'],
  ...overrides
})

describe('daily briefing conclusion synthesis', () => {
  const factDirection = (direction: 'bullish' | 'bearish' | 'undecided', rowIds = briefingEditionRowIds(document())) => ({ direction, rowIds })

  it('rejects a written direction opposite to the frozen facts instead of publishing it', () => {
    // The fixture the acceptance asks for: data layer says up, the writing says down.
    const validation = validateEditorialForPeriod(document(), editorial(synthesis()), 'zh-CN', [], [bearishPrior()], factDirection('bullish'))
    expect(validation).toMatchObject({ ok: false, failureCode: 'direction-conflict' })
  })

  it('accepts a written direction that matches the facts', () => {
    const validation = validateEditorialForPeriod(document(), editorial(synthesis()), 'zh-CN', [], [bearishPrior()], factDirection('bearish'))
    expect(validation.ok).toBe(true)
  })

  it('rejects an edition that dropped a row the run froze', () => {
    // The other fixture: the run froze three rows, the version would publish two.
    const shorter = briefingEditionRowIds(document()).slice(1)
    const validation = validateEditorialForPeriod(document(), editorial(synthesis()), 'zh-CN', [], [bearishPrior()], factDirection('bearish', shorter))
    expect(validation).toMatchObject({ ok: false, failureCode: 'row-set-mismatch' })
    if (!validation.ok) expect(validation.detail).toBeUndefined()
  })

  it('keeps the single fact-layer conclusion as a marked fallback when there are no priors', () => {
    const validation = validateDailyBriefingEditorial(editorial(synthesis()), document(), 'zh-CN', [], [])
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const applied = applyDailyBriefingEditorial(document(), validation.value, { promptVersion: 'v2', model: 'm', source: 'default' })
    expect(applied.conclusion).toMatchObject({
      summary: 'Stablecoin contraction pulls bids away.',
      direction: 'bearish',
      synthesis: 'fallback'
    })
    expect(applied.conclusion?.synthesisDetail).toBeUndefined()
  })

  it('accepts one prior and records it as the synthesis source', () => {
    const validation = validateDailyBriefingEditorial(editorial(synthesis()), document(), 'zh-CN', [], [bearishPrior()])
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const applied = applyDailyBriefingEditorial(document(), validation.value, { promptVersion: 'v2', model: 'm', source: 'default' }, [bearishPrior()])
    expect(applied.conclusion?.synthesis).toBe('agent')
    expect(applied.conclusion?.synthesizedFrom).toEqual(['analysis:mi-as-1'])
    expect(applied.conclusion?.direction).toBe('bearish')
    expect(applied.conclusion?.summary).toBe(synthesis().summary)
    expect(applied.conclusion?.synthesisDetail).toMatchObject({
      confidence: 'high', evidenceRefs: ['data:btc', 'macro:US.CPI', 'data:etf-btc']
    })
  })

  it('synthesizes multiple priors and lists every one', () => {
    const priors = [bearishPrior(), bullishBriefPrior()]
    const validation = validateDailyBriefingEditorial(editorial(synthesis()), document(), 'zh-CN', [], priors)
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const applied = applyDailyBriefingEditorial(document(), validation.value, { promptVersion: 'v2', model: 'm', source: 'default' }, priors)
    expect(applied.conclusion?.synthesizedFrom).toEqual([
      'analysis:mi-as-1', 'daily-brief:2026-10-29:zh-CN'
    ])
  })

  it('rejects a verbatim copy of any prior conclusion', () => {
    const result = validateDailyBriefingEditorial(
      editorial(synthesis({ summary: 'Flows pull bids away.' })), document(), 'zh-CN', [], [bearishPrior()]
    )
    expect(result).toMatchObject({ ok: false, failureCode: 'copied-conclusion' })
  })

  it('rejects copying the fact-layer analysis conclusion', () => {
    const result = validateDailyBriefingEditorial(
      editorial(synthesis({ summary: 'Stablecoin contraction pulls bids away.' })),
      document(), 'zh-CN', [], [bullishBriefPrior()]
    )
    expect(result).toMatchObject({ ok: false, failureCode: 'copied-conclusion' })
  })

  it('requires at least one citation from the frozen document', () => {
    const missing = validateDailyBriefingEditorial(
      editorial(synthesis({ evidenceRefs: [] })), document(), 'zh-CN', [], [bearishPrior()]
    )
    expect(missing).toMatchObject({ ok: false, failureCode: 'missing-conclusion-evidence' })
    const unknown = validateDailyBriefingEditorial(
      editorial(synthesis({ evidenceRefs: ['prior:analysis:mi-as-1'] })), document(), 'zh-CN', [], [bearishPrior()]
    )
    expect(unknown).toMatchObject({ ok: false, failureCode: 'invalid-conclusion-synthesis' })
    // The refusal has to say which id it refused, or the repair round repeats the same answer.
    expect(unknown.ok ? '' : unknown.detail ?? '').toContain('prior:analysis:mi-as-1')
  })

  it('refuses an equality claim that only the two-decimal display supports', () => {
    // The reported defect: BTC +0.5043% and ETH +0.4992% both printed +0.50%, and the reply published
    // "ETH matches BTC". The raw numbers differ, so the comparison has to name the stronger asset.
    const base = document()
    const btcRow = base.data.market[0]!
    const ethRow = {
      ...btcRow,
      id: 'eth',
      labelKey: 'dailyBriefing.row.eth',
      value: { number: -1.0992, format: 'percent' as const }
    }
    const doc: DailyBriefingDocument = { ...base, data: { ...base.data, market: [{ ...btcRow, value: { number: -1.1, format: 'percent' as const } }, ethRow] } }
    const claim = validateConclusionSynthesis(
      synthesis({ summary: 'ETH 与 BTC 相同，均为 -1.10%，因此没有相对强弱可谈，资金面主导方向。' }),
      doc, [bearishPrior()]
    )
    expect(claim).toMatchObject({ ok: false, failureCode: 'asset-equality-claim' })
    expect(claim.ok ? '' : claim.detail ?? '').toContain('-1.0992')

    // Same rule, other side: when the raw values really are identical the comparison is allowed.
    const equalDoc: DailyBriefingDocument = { ...base, data: { ...base.data, market: [{ ...btcRow, value: { number: -1.1, format: 'percent' as const } }, { ...ethRow, value: { number: -1.1, format: 'percent' as const } }] } }
    const allowed = validateConclusionSynthesis(
      synthesis({ summary: 'ETH 与 BTC 相同，均为 -1.10%，资金面主导方向，因此两者的相对强弱没有可交易差异。' }),
      equalDoc, [bearishPrior()]
    )
    expect(allowed.ok ? '' : allowed.failureCode).not.toBe('asset-equality-claim')
  })

  // MI-2-R16: a refusal that names no defect is what turned one rejection into three identical
  // attempts. Both directions are asserted: a missing field names the field, a bad value names it too.
  // The model reads the repair sentence, not our logs: whatever the refusal says has to reach it.
  it('carries the refusal reason into the sentence the model reads next', () => {
    const repair = repairPromptFor('invalid-conclusion-synthesis', 'missing: outlook')
    expect(repair).toContain('invalid-conclusion-synthesis')
    expect(repair).toContain('missing: outlook')
  })

  it('names the field a reply left out, so the repair round can add it', () => {
    const missingOutlook: Record<string, unknown> = { ...synthesis() }
    delete missingOutlook.outlook
    const result = validateDailyBriefingEditorial(
      editorial(missingOutlook), document(), 'zh-CN', [], [bearishPrior()]
    )
    expect(result).toMatchObject({ ok: false, failureCode: 'invalid-conclusion-synthesis' })
    expect(result.ok ? '' : result.detail ?? '').toContain('outlook')
  })

  it('names the field whose value is out of range', () => {
    const result = validateDailyBriefingEditorial(
      editorial(synthesis({ confidence: 'certain' as never })), document(), 'zh-CN', [], [bearishPrior()]
    )
    expect(result).toMatchObject({ ok: false, failureCode: 'invalid-conclusion-synthesis' })
    expect(result.ok ? '' : result.detail ?? '').toContain('confidence')
    expect(result.ok ? '' : result.detail ?? '').toContain('certain')
  })

  it('names the citation cap instead of refusing silently when a reply cites too many facts', () => {
    // The reported defect: two nights in a row a reply cited 9 and 10 facts against a cap of 8, was
    // rejected with a bare code, cited the same facts again, and the run failed after its repairs.
    const tooMany = ['data:btc', 'data:eth', 'data:etf-btc', 'data:etf-eth', 'data:us10y', 'data:gold', 'data:funding-btc', 'data:stablecoin', 'data:index']
    const result = validateDailyBriefingEditorial(
      editorial(synthesis({ evidenceRefs: tooMany })), document(), 'zh-CN', [], [bearishPrior()]
    )
    expect(result).toMatchObject({ ok: false, failureCode: 'invalid-conclusion-synthesis' })
    expect(result.ok ? '' : result.detail ?? '').toContain('at most 8')
    expect(result.ok ? '' : result.detail ?? '').toContain('9')
  })

  it('forces a conflicting window to state the divergence instead of averaging it', () => {
    const priors = [bearishPrior(), bullishBriefPrior()]
    const averaged = synthesis({
      direction: 'range',
      summary: 'CPI 3.4% 高于预期 3.2%，通过利率渠道压制 BTC，BTC 下跌 1.10%。未来两到三个交易日基准情形震荡：BTC 弱于 ETH。',
      outlook: '未来两到三个交易日基准情形震荡：BTC 弱于 ETH，区间内波动。',
      regimeChange: '信号交织，方向没有延续。',
      coreTension: '两股力量大致抵消。',
      whatWouldChange: '若 CPI 回到 3.2% 且 BTC 收复 1.10% 跌幅，则判断改变。',
      confirmed: [],
      refuted: []
    })
    expect(validateDailyBriefingEditorial(editorial(averaged), document(), 'zh-CN', [], priors))
      .toMatchObject({ ok: false, failureCode: 'missing-conclusion-divergence' })
    expect(validateDailyBriefingEditorial(editorial(synthesis()), document(), 'zh-CN', [], priors).ok).toBe(true)
  })

  it('publishes the forecast premises and falsifiers, never the old analysis conditions', () => {
    const stale = document()
    const withStaleBasis: DailyBriefingDocument = {
      ...stale,
      conclusion: {
        ...stale.conclusion!,
        conditions: ['旧分析：稳定币收缩'],
        counterEvidence: [{ statement: '旧反证：ETF 流入', citations: [1] }],
        invalidations: [{ asset: 'BTC', horizonEnd: '2026-10-31', text: '旧失效条件' }]
      }
    }
    const validation = validateDailyBriefingEditorial(editorial(synthesis()), withStaleBasis, 'zh-CN', [], [bearishPrior()])
    expect(validation.ok).toBe(true)
    if (!validation.ok) return
    const applied = applyDailyBriefingEditorial(withStaleBasis, validation.value, { promptVersion: 'v2', model: 'm', source: 'default' }, [bearishPrior()])
    expect(applied.conclusion?.conditions).toEqual(synthesis().conditions)
    expect(applied.conclusion?.counterEvidence.map((claim) => claim.statement)).toEqual(synthesis().counterEvidence)
    expect(applied.conclusion?.invalidations).toEqual([])
  })

  it('renders no basis blocks for a synthesis whose outlook states no base case', () => {
    // The basis belongs to a forecast. Without a stated base case there is nothing for the premises
    // and falsifiers to support, so the mapping returns empty blocks — and the validator rejects the
    // synthesis before it can reach a reader.
    const noForecast = synthesis({ outlook: '资金面还需要再观察。' })
    expect(validateConclusionSynthesis(noForecast, document(), [bearishPrior()]))
      .toMatchObject({ ok: false, failureCode: 'missing-outlook' })
    expect(briefingConclusionBasis(noForecast)).toMatchObject({
      conditions: [], counterEvidence: [], invalidations: []
    })
  })

  it('does not attach a fallback translation to the synthesized summary', () => {
    const result = validateDailyBriefingEditorial(
      { ...editorial(synthesis()), conclusionTranslation: 'Stablecoin contraction pulls bids away.' },
      document(), 'zh-CN', [], [bearishPrior()]
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const applied = applyDailyBriefingEditorial(document(), result.value, { promptVersion: 'v2', model: 'm', source: 'default' }, [bearishPrior()])
    expect(applied.conclusion?.summary).toBe(synthesis().summary)
    expect(applied.conclusion?.translation).toBeUndefined()
  })

  it('requires a synthesis whenever at least one prior conclusion exists', () => {
    expect(validateDailyBriefingEditorial(editorial(), document(), 'zh-CN', [], [bearishPrior()]))
      .toMatchObject({ ok: false, failureCode: 'missing-conclusion-synthesis' })
  })
})
