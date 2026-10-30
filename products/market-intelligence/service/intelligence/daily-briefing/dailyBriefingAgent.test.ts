import { describe, expect, it, vi } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { createDailyBriefingAgent } from './dailyBriefingAgent'
import { buildDailyBriefingPrompt } from './dailyBriefingPrompt'
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
  lede: { source: 'template', text: '模板导语', generatedAt: '2026-10-30T00:30:00.000Z' },
  news: {
    items: [{
      itemId: 'n1', title: 'JPMorgan says AI labels no longer win lenders', sourceName: 'CoinDesk RSS',
      publishedAt: '2026-10-30T00:00:00.000Z', polarity: 'bearish', strength: 3, confidence: 80, symbols: ['BTC']
    }],
    macro: [{
      eventKey: 'US.CPI', title: 'cpi', scheduledAt: '2026-10-29T12:30:00.000Z',
      importance: 'high', actual: '3.4%', previous: '3.1%', consensus: '3.2%', surprise: { direction: 'beat', value: 0.2, unit: 'pp' }
    }],
    notes: {}
  },
  data: {
    market: [
      { id: 'btc', labelKey: 'dailyBriefing.row.btc', importance: { tier: 'must', source: 'rule', reasonCode: 'largest-move' }, state: 'available', value: { number: -1.1, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-30T00:25:00.000Z' },
      { id: 'index', labelKey: 'dailyBriefing.row.index', importance: { tier: 'support', source: 'rule', reasonCode: 'context' }, state: 'available', value: { number: 0.82, format: 'percent' }, change: null, window: '24h', observedAt: '2026-10-30T00:25:00.000Z' }
    ],
    funds: [{
      id: 'stablecoin', group: 'funds', labelKey: 'dailyBriefing.row.stablecoin', importance: { tier: 'must', source: 'rule', reasonCode: 'reading' },
      state: 'available', value: { number: 253_033_903_673.4, format: 'usd' }, change: { value: -0.33, unit: 'percent', window: '1d' },
      window: '1d', observedAt: '2026-10-30T00:12:00.000Z'
    }],
    sentiment: {
      fearGreed: { id: 'fear-greed', group: 'sentiment', labelKey: 'dailyBriefing.row.fearGreed', importance: { tier: 'must', source: 'rule', reasonCode: 'reading' }, state: 'available', value: { number: 48, format: 'score' }, change: null, changeReason: 'no-baseline', window: 'latest', observedAt: '2026-10-30T00:00:00.000Z' },
      news: { state: 'available', counts: { bearish: 1, bullish: 0, mixed: 0, neutral: 0 }, itemCount: 1 }
    }
  },
  conclusion: {
    summaryId: 's1', publishedAt: '2026-10-30T00:00:00.000Z', direction: 'bearish', directions: [],
    summary: 'Stablecoin contraction pulls bids away.', conditions: ['Stablecoins keep contracting'],
    invalidations: [{ asset: 'BTC', horizonEnd: '2026-10-31T00:00:00.000Z', text: 'Stablecoins turn positive.' }],
    counterEvidence: [], topSignal: null, dataGaps: [], caveats: []
  },
  next: { focus: { eventKey: 'US.FOMC', title: 'fomc', titleKey: 'fomc', at: '2026-11-02T18:00:00.000Z', importance: 'high', category: 'central-bank-activity', countryCode: 'US', countryName: '美国', consensus: '4.25%' }, items: [] },
  citations: [],
  provenance: { summaryId: 's1', readAt: '2026-10-30T00:30:00.000Z' }
})

const validOutput = {
  lede: '恐惧贪婪 48，稳定币继续收缩；CPI 3.4% 超预期，资金面仍是主线。',
  items: [
    { factId: 'news:n1', why: '这条消息解释了风险偏好的下行。' },
    { factId: 'macro:US.CPI', why: 'CPI 超预期压低了降息预期。' }
  ],
  importance: [{ factId: 'data:index', tier: 'must', reasonText: '纳指同向，说明不是单一币种问题。' }],
  dataNote: '资金面收缩与 CPI 超预期同向。',
  invalidationNote: '稳定币转为净流入会削弱这条判断。',
  nextFocus: {
    eventKey: 'US.FOMC',
    why: 'This is the week’s rate decision and the shared discount rate for both assets.',
    watch: [
      { condition: 'Hawkish', implication: 'Real yields rise and BTC/ETH come under pressure.' },
      { condition: 'Dovish', implication: 'Rate-cut expectations improve risk appetite.' }
    ]
  }
}

describe('daily briefing editorial validation and application', () => {
  it('accepts prose that only repeats facts and cannot downgrade the must floor', () => {
    const validated = validateDailyBriefingEditorial(validOutput, document(), 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(document(), validated.value, {
      promptVersion: 'v1', model: 'm1', source: 'default'
    })
    expect(applied.lede).toMatchObject({ source: 'agent', text: validOutput.lede })
    expect(applied.news.items[0]?.why).toContain('风险偏好')
    expect(applied.news.macro[0]?.why).toContain('降息预期')
    expect(applied.data.market.find((row) => row.id === 'index')?.importance).toMatchObject({ tier: 'must', source: 'agent' })
    expect(applied.data.market.find((row) => row.id === 'btc')?.importance.tier).toBe('must')
    expect(applied.editorial?.dataNote).toBe(validOutput.dataNote)
    expect(applied.provenance.editorialMeta).toEqual({ promptVersion: 'v1', model: 'm1', source: 'default' })
  })

  it('rejects an unknown fact, a news id in importance, an unknown number, a URL and an oversized lede', () => {
    expect(validateDailyBriefingEditorial({ ...validOutput, items: [{ factId: 'news:nope', why: 'x' }] }, document(), 'zh-CN'))
      .toMatchObject({ ok: false, failureCode: 'unknown-fact' })
    expect(validateDailyBriefingEditorial({ ...validOutput, importance: [{ factId: 'news:n1', tier: 'must' }] }, document(), 'zh-CN'))
      .toMatchObject({ ok: false, failureCode: 'unknown-fact' })
    expect(validateDailyBriefingEditorial({ ...validOutput, lede: '999 is not in the facts' }, document(), 'zh-CN'))
      .toMatchObject({ ok: false, failureCode: 'unknown-number' })
    expect(validateDailyBriefingEditorial({ ...validOutput, lede: 'https://example.com' }, document(), 'zh-CN'))
      .toMatchObject({ ok: false, failureCode: 'forbidden-content' })
    expect(validateDailyBriefingEditorial({ ...validOutput, lede: 'x'.repeat(601) }, document(), 'zh-CN'))
      .toMatchObject({ ok: false, failureCode: 'too-long' })
  })

  it('translates only when the conclusion is in the other language', () => {
    const chinese = document()
    chinese.conclusion!.summary = '稳定币收缩把买盘推走。'
    expect(validateDailyBriefingEditorial({ ...validOutput, conclusionTranslation: '译文' }, chinese, 'zh-CN'))
      .toMatchObject({ ok: false, failureCode: 'invalid-translation' })
    expect(validateDailyBriefingEditorial({ ...validOutput, conclusionTranslation: 'Stablecoin contraction pulls bids away.' }, document(), 'zh-CN'))
      .toMatchObject({ ok: true })
  })

  it('keeps the must floor even when the model asks to downgrade it', () => {
    const applied = applyDailyBriefingEditorial(document(), {
      ...validOutput,
      importance: [{ factId: 'data:btc', tier: 'reference', reasonText: 'less important' }]
    }, { promptVersion: 'v1', model: 'm1', source: 'default' })
    expect(applied.data.market.find((row) => row.id === 'btc')?.importance.tier).toBe('must')
  })
})

describe('daily briefing agent', () => {
  it('turns a valid model answer into an agent edition', async () => {
    const invoke = vi.fn(async () => ({
      ok: true as const, output: JSON.stringify(validOutput), providerId: 'p', modelId: 'm1',
      trace: { taskId: 't', durationMs: 1 }
    }))
    const agent = createDailyBriefingAgent({ invoke: invoke as never })
    const result = await agent.generate({ document: document(), locale: 'zh-CN', providerId: 'p', modelId: 'm1', source: 'custom' })
    expect(result.state).toBe('agent')
    expect(result.document.lede.source).toBe('agent')
    expect(result.document.next.focus?.why).toContain('rate decision')
    expect(result.document.next.focus?.watch).toHaveLength(2)
    expect(result.document.provenance.editorialMeta).toEqual({ promptVersion: 'daily-briefing.editorial.v1', model: 'm1', source: 'custom' })
  })

  it('recovers a valid object wrapped in prose', async () => {
    const invoke = vi.fn(async () => ({
      ok: true as const,
      output: `Here is the briefing JSON.\n${JSON.stringify(validOutput)}\nDone.`,
      providerId: 'p', modelId: 'm1', trace: { taskId: 't', durationMs: 1 }
    }))
    const agent = createDailyBriefingAgent({ invoke: invoke as never })
    expect(await agent.generate({ document: document(), locale: 'zh-CN' })).toMatchObject({ state: 'agent' })
  })

  it('falls back to the untouched template on an error, invalid JSON or a bad fact', async () => {
    const template = document()
    const failing = createDailyBriefingAgent({ invoke: vi.fn(async () => ({ ok: false as const, errorCode: 'timeout' as const, trace: { taskId: 't', durationMs: 1 } })) as never })
    expect(await failing.generate({ document: template, locale: 'zh-CN' })).toMatchObject({ state: 'template', failureCode: 'timeout', document: template })

    const invalidJson = createDailyBriefingAgent({ invoke: vi.fn(async () => ({ ok: true as const, output: '{bad', providerId: 'p', modelId: 'm', trace: { taskId: 't', durationMs: 1 } })) as never })
    expect(await invalidJson.generate({ document: template, locale: 'zh-CN' })).toMatchObject({ state: 'template', failureCode: 'invalid-json' })

    const badFact = createDailyBriefingAgent({ invoke: vi.fn(async () => ({ ok: true as const, output: JSON.stringify({ ...validOutput, items: [{ factId: 'news:nope', why: 'x' }] }), providerId: 'p', modelId: 'm', trace: { taskId: 't', durationMs: 1 } })) as never })
    expect(await badFact.generate({ document: template, locale: 'zh-CN' })).toMatchObject({ state: 'template', failureCode: 'unknown-fact' })
  })

  it('gives the model only the frozen facts and their ids', () => {
    const messages = buildDailyBriefingPrompt({ document: document(), locale: 'zh-CN' })
    const text = messages.map((message) => message.content).join('\n')
    expect(text).toContain('news:n1')
    expect(text).toContain('macro:US.CPI')
    expect(text).toContain('data:btc')
    expect(text).toContain('mustFloor')
    expect(text).not.toContain('http')
  })
})
