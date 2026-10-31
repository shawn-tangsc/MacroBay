import { describe, expect, it } from 'vitest'

import type { BriefingPriorConclusion, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { applyDailyBriefingEditorial, validateDailyBriefingEditorial } from './dailyBriefingValidation'

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
    funds: [],
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
  summary: 'CPI 超预期后，BTC 的买盘被资金面收缩压住，前一日对流动性改善的乐观判断已被证伪。',
  regimeChange: '窗口内资金面由扩张转向收缩，风险偏好从修复转为防守。',
  confirmed: ['CPI 走高压制降息预期得到确认'],
  refuted: ['稳定币扩张带来买盘的判断被资金净流出证伪'],
  coreTension: '价格下跌但未出现恐慌性抛售，资金面与价格同向，情绪仍有分歧。',
  whatWouldChange: '稳定币连续两日净流入且 BTC 收复跌幅，会推翻当前看空。',
  evidenceRefs: ['data:btc', 'macro:US.CPI'],
  ...overrides
})

describe('daily briefing conclusion synthesis', () => {
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
      confidence: 'high', evidenceRefs: ['data:btc', 'macro:US.CPI']
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
  })

  it('forces a conflicting window to state the divergence instead of averaging it', () => {
    const priors = [bearishPrior(), bullishBriefPrior()]
    const averaged = synthesis({
      direction: 'range',
      regimeChange: '窗口内信号交织。',
      summary: '资金面与流动性给出的方向并不一致，价格暂时没有明确选择。',
      coreTension: '两股力量大致抵消。',
      whatWouldChange: '任意一方重新占优就会改变判断。',
      confirmed: [],
      refuted: []
    })
    expect(validateDailyBriefingEditorial(editorial(averaged), document(), 'zh-CN', [], priors))
      .toMatchObject({ ok: false, failureCode: 'missing-conclusion-divergence' })
    expect(validateDailyBriefingEditorial(editorial(synthesis()), document(), 'zh-CN', [], priors).ok).toBe(true)
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
