import { describe, expect, it } from 'vitest'

import type { DailyBriefingDocument } from '../../../contracts/dailyBriefing'
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
  ledePattern: 'event-shock',
  items: [
    { factId: 'news:n1', why: '这条消息解释了风险偏好的下行。' },
    { factId: 'macro:US.CPI', why: 'CPI 超预期压低了降息预期。' }
  ],
  hidden: [],
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

const documentWithMacro = (eventKeys: readonly string[], withNews = true): DailyBriefingDocument => {
  const base = document()
  const template = base.news.macro[0]!
  const macro = eventKeys.map((eventKey, index) => ({
    ...template,
    eventKey,
    title: `High impact release ${index + 1}`,
    scheduledAt: `2026-10-29T${String(12 + index).padStart(2, '0')}:30:00.000Z`
  }))
  return { ...base, news: { ...base.news, items: withNews ? base.news.items : [], macro, macroCandidates: macro } }
}

const hiddenOnlyEditorial = (eventKeys: readonly string[]) => ({
  lede: 'Stablecoin contraction keeps the read unchanged.',
  ledePattern: 'structure',
  items: [],
  hidden: eventKeys.map((eventKey) => ({ factId: `macro:${eventKey}`, reason: 'already reflected in the conclusion' })),
  importance: []
})

const webTool = (urls: readonly string[], publishedAt = '2026-10-29T00:00:00.000Z') => [{
  toolCallId: 't', toolName: 'WebSearch',
  output: { results: urls.map((url) => ({ title: url, url, publishedAt })) }
}]

const repeatedWebTool = (count: number, url: string, publishedAt = '2026-10-29T00:00:00.000Z') =>
  Array.from({ length: count }, (_, index) => ({
    toolCallId: `t${index}`, toolName: 'WebSearch',
    output: { results: [{ title: 'BLS', url, publishedAt }] }
  }))

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
    expect(validateDailyBriefingEditorial({ ...validOutput, lede: 'ETF 买入增加，资金面改善。' }, document(), 'zh-CN').ok).toBe(true)
    expect(validateDailyBriefingEditorial({ ...validOutput, lede: '过去 24 小时，20:30 的发布是主线。' }, document(), 'zh-CN').ok).toBe(true)
    expect(validateDailyBriefingEditorial({ ...validOutput, lede: '建议买入 BTC。' }, document(), 'zh-CN'))
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

  it('keeps the key high-impact release visible when the editorial hides every release', () => {
    const source = document()
    const validated = validateDailyBriefingEditorial({
      ...validOutput,
      items: [{ factId: 'news:n1', why: '这条消息解释了风险偏好的下行。' }],
      hidden: [{ factId: 'macro:US.CPI', reason: '已反映在结论中。' }],
      importance: []
    }, source, 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(source, validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
    expect(applied.news.items[0]).toMatchObject({ itemId: 'n1', visibility: 'shown' })
    expect(applied.news.macro[0]).toMatchObject({ eventKey: 'US.CPI', visibility: 'shown' })
  })
})

describe('daily briefing web evidence', () => {
  it('only accepts a source that came from this turn and is inside the cutoff', () => {
    const tool = [{ toolCallId: 't', toolName: 'WebSearch', output: { results: [{ title: 'CPI release', url: 'https://www.bls.gov/cpi', publishedAt: '2026-10-29T00:00:00.000Z' }] } }]
    const webEvidence = [{ eventKey: 'US.CPI', field: 'consensus', value: '3.2%', sourceName: 'BLS', sourceUrl: 'https://www.bls.gov/cpi', publishedAt: '2026-10-29T00:00:00.000Z' }]
    const valid = validateDailyBriefingEditorial({ ...validOutput, webEvidence }, document(), 'zh-CN', tool)
    expect(valid.ok).toBe(true)
    if (valid.ok) expect(applyDailyBriefingEditorial(document(), valid.value, { promptVersion: 'v1', model: 'm', source: 'default' }).citations.at(-1)?.sourceLabel).toBe('BLS')
    expect(validateDailyBriefingEditorial({ ...validOutput, webEvidence }, document(), 'zh-CN', [])).toMatchObject({ ok: false })
    expect(validateDailyBriefingEditorial({ ...validOutput, webEvidence: [{ ...webEvidence[0], publishedAt: '2026-10-30T01:00:00.000Z' }] }, document(), 'zh-CN', tool)).toMatchObject({ ok: false })
    expect(validateDailyBriefingEditorial({ ...validOutput, webEvidence: [{ ...webEvidence[0], field: 'actual', value: '3.4%' }] }, document(), 'zh-CN', tool)).toMatchObject({ ok: false })
    const conflictTool = [{ toolCallId: 't', toolName: 'WebSearch', output: { results: [{ title: 'BLS', url: 'https://www.bls.gov/cpi', publishedAt: '2026-10-29T00:00:00.000Z' }, { title: 'Other', url: 'https://example.com/cpi', publishedAt: '2026-10-29T00:00:00.000Z' }] } }]
    const conflict = validateDailyBriefingEditorial({ ...validOutput, webEvidence: [webEvidence[0], { ...webEvidence[0], value: '3.1%', sourceName: 'Other', sourceUrl: 'https://example.com/cpi' }] }, document(), 'zh-CN', conflictTool)
    expect(conflict.ok).toBe(true)
    if (conflict.ok) {
      expect(conflict.value.webEvidence).toHaveLength(1)
      expect(conflict.value.webEvidence?.[0]).toMatchObject({ value: '3.2%', sourceName: 'BLS', sourceConflict: true })
    }
  })

  it('keeps the official value in citations when a non-official source conflicts', () => {
    const official = { eventKey: 'US.CPI', field: 'consensus', value: '3.2%', sourceName: 'BLS', sourceUrl: 'https://www.bls.gov/cpi', publishedAt: '2026-10-29T00:00:00.000Z' }
    const unofficial = { ...official, value: '3.1%', sourceName: 'Other', sourceUrl: 'https://example.com/cpi' }
    const tool = webTool([official.sourceUrl, unofficial.sourceUrl])
    for (const webEvidence of [[unofficial, official], [official, unofficial]]) {
      const validated = validateDailyBriefingEditorial({ ...validOutput, webEvidence }, document(), 'zh-CN', tool)
      expect(validated.ok).toBe(true)
      if (!validated.ok) continue
      expect(validated.value.webEvidence).toHaveLength(1)
      expect(validated.value.webEvidence?.[0]).toMatchObject({ value: '3.2%', sourceName: 'BLS', sourceConflict: true })
      const applied = applyDailyBriefingEditorial(document(), validated.value, { promptVersion: 'v1', model: 'm', source: 'default' })
      expect(applied.citations).toHaveLength(1)
      expect(applied.citations[0]).toMatchObject({ sourceLabel: 'BLS', statement: 'US.CPI consensus: 3.2% (source conflict)' })
    }
  })

  it('rejects a fourth event and a seventh search', () => {
    const events = ['US.CPI', 'US.NFP', 'US.PCE', 'US.GDP']
    const urls = events.map((eventKey) => `https://www.bls.gov/${eventKey.toLowerCase()}`)
    const evidence = events.map((eventKey, index) => ({
      eventKey, field: 'consensus', value: '1%', sourceName: 'BLS', sourceUrl: urls[index]!, publishedAt: '2026-10-29T00:00:00.000Z'
    }))
    expect(validateDailyBriefingEditorial({ ...hiddenOnlyEditorial(events), webEvidence: evidence }, documentWithMacro(events, false), 'zh-CN', webTool(urls)))
      .toMatchObject({ ok: false, failureCode: 'invalid-shape' })

    const one = ['US.CPI']
    const url = 'https://www.bls.gov/cpi'
    const single = { eventKey: 'US.CPI', field: 'consensus', value: '3.2%', sourceName: 'BLS', sourceUrl: url, publishedAt: '2026-10-29T00:00:00.000Z' }
    const editorial = { ...hiddenOnlyEditorial(one), webEvidence: [single] }
    expect(validateDailyBriefingEditorial(editorial, documentWithMacro(one, false), 'zh-CN', repeatedWebTool(6, url)).ok).toBe(true)
    expect(validateDailyBriefingEditorial(editorial, documentWithMacro(one, false), 'zh-CN', repeatedWebTool(7, url)))
      .toMatchObject({ ok: false, failureCode: 'invalid-shape' })
  })
})
