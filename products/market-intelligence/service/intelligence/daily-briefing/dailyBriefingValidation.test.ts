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

const documentWithoutMacroConsensus = (): DailyBriefingDocument => {
  const base = document()
  const template = base.news.macro[0]!
  const macro = [{
    eventKey: 'US.PPI', title: 'PPI', scheduledAt: template.scheduledAt,
    importance: 'high' as const, actual: '0.4%', previous: '0.2%',
    surprise: { direction: 'consensus-unavailable' as const }
  }]
  return { ...base, news: { ...base.news, macro, macroCandidates: macro } }
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


const withMaterialData = (): DailyBriefingDocument => {
  const base = document()
  return {
    ...base,
    data: {
      ...base.data,
      funds: base.data.funds.map((row) => row.id === 'stablecoin'
        ? {
            ...row,
            importance: { tier: 'support' as const, source: 'rule' as const, reasonCode: 'context' as const },
            materiality: { material: true as const, reasonCode: 'stablecoin-shift' as const },
            visibility: 'hidden' as const,
            visibilityReason: 'not-selected'
          }
        : row),
      leverage: {
        state: 'available' as const,
        btc: { openInterestUsd: 1_200_000_000, change24hPct: 0.4 },
        eth: { openInterestUsd: 800_000_000, change24hPct: 0.2 },
        materiality: { material: false as const, reasonCode: 'no-material-change' as const },
        visibility: 'hidden' as const,
        visibilityReason: 'no-material-change'
      },
      policyPath: {
        state: 'available' as const, meetingDate: '2026-12-09', outcome: 'hike-25',
        probability: 76, observedAt: '2026-10-30T02:10:00.000Z',
        materiality: { material: false as const, reasonCode: 'no-material-change' as const },
        visibility: 'hidden' as const,
        visibilityReason: 'no-material-change'
      }
    }
  }
}

const withMaterialLeverage = (): DailyBriefingDocument => {
  const base = withMaterialData()
  return {
    ...base,
    data: {
      ...base.data,
      leverage: {
        ...base.data.leverage!,
        materiality: { material: true as const, reasonCode: 'open-interest-shift' as const },
        visibilityReason: 'not-selected'
      }
    }
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

  // MI-2-R16: the refusal must carry the one thing the model needs to fix — which citation is wrong.
  it('reports every independent defect in one pass, not only the first', () => {
    // The 2026-11-04 loop: round one heard "unknown fact", round two heard "forbidden content", and
    // the field that actually blocked publication was never mentioned. One reply, three defects.
    const reply = validateDailyBriefingEditorial({
      ...validOutput,
      items: [{ factId: 'news:nope', why: 'x' }],
      lede: 'https://example.com 说 ETF 流入 999 亿美元'
    }, document(), 'zh-CN')

    expect(reply).toMatchObject({ ok: false, failureCode: 'unknown-fact' })
    const codes = reply.ok ? [] : (reply.failures ?? []).map((failure) => failure.code)
    expect(codes).toContain('unknown-fact')
    expect(codes).toContain('forbidden-content')
    expect(codes.length).toBeGreaterThan(1)
  })

  it('names the citation it refused and the number it could not find', () => {
    const unknownFact = validateDailyBriefingEditorial({ ...validOutput, items: [{ factId: 'news:nope', why: 'x' }] }, document(), 'zh-CN')
    expect(unknownFact).toMatchObject({ ok: false, failureCode: 'unknown-fact' })
    expect(unknownFact.ok ? '' : unknownFact.detail ?? '').toContain('news:nope')

    // A well-formed edition is not refused: the reason must not turn into a blanket rejection.
    expect(validateDailyBriefingEditorial(validOutput, document(), 'zh-CN').ok).toBe(true)
  })

  // Chief 2026-11-06：报错要**点名是哪个 id、它到底在哪**。只说 unknown-fact，模型只能猜，
  // 猜错就再烧一轮——那 12 条 unknown-fact 正是这么来的。
  it('says a refused id was hidden by selection, instead of claiming it does not exist', () => {
    const base = document()
    const withHidden: DailyBriefingDocument = {
      ...base,
      provenance: {
        ...base.provenance,
        selectionAudit: {
          shown: ['news:n1'],
          hidden: [{ factId: 'news:dropped-1', reason: '与另一条标题重复' }]
        }
      } as DailyBriefingDocument['provenance']
    }
    const reply = validateDailyBriefingEditorial(
      { ...validOutput, items: [{ factId: 'news:dropped-1', why: 'x' }] },
      withHidden, 'zh-CN'
    )
    expect(reply).toMatchObject({ ok: false, failureCode: 'unknown-fact' })
    const detail = reply.ok ? '' : reply.detail ?? ''
    // 点名这个 id，并说清它为什么不能用：它是被选择阶段隐藏的候选，不是"不存在"。
    expect(detail).toContain('news:dropped-1')
    expect(detail).toContain('hidden by selection')
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
    // The document is readonly by contract; a fixture mutates a copy instead of the shared one.
    const base = document()
    const chinese = { ...base, conclusion: { ...base.conclusion!, summary: '稳定币收缩把买盘推走。' } }
    expect(validateDailyBriefingEditorial({ ...validOutput, conclusionTranslation: '译文' }, chinese, 'zh-CN'))
      .toMatchObject({ ok: false, failureCode: 'invalid-translation' })
    expect(validateDailyBriefingEditorial({ ...validOutput, conclusionTranslation: 'Stablecoin contraction pulls bids away.' }, document(), 'zh-CN'))
      .toMatchObject({ ok: true })
  })

  it('keeps the must floor even when the model asks to downgrade it', () => {
    // Typed by the call's own parameter: the fixture spreads `validOutput`, whose `tier` widens to
    // string, and this file sits outside the main typecheck so that widening went unnoticed.
    const downgrade: Parameters<typeof applyDailyBriefingEditorial>[1] = {
      ...validOutput,
      hiddenData: [],
      importance: [{ factId: 'data:btc', tier: 'reference', reasonText: 'less important' }]
    }
    const applied = applyDailyBriefingEditorial(document(), downgrade, { promptVersion: 'v1', model: 'm1', source: 'default' })
    expect(applied.data.market.find((row) => row.id === 'btc')?.importance.tier).toBe('must')
  })


  it('requires a reason when the agent hides a material data row', () => {
    const source = withMaterialData()
    expect(validateDailyBriefingEditorial({ ...validOutput, importance: [] }, source, 'zh-CN'))
      .toMatchObject({ ok: false, failureCode: 'missing-hidden-reason', detail: 'data:stablecoin' })
    const validated = validateDailyBriefingEditorial({
      ...validOutput,
      importance: [],
      hiddenData: [{ factId: 'data:stablecoin', reason: 'The move is inside the usual noise band.' }]
    }, source, 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(source, validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
    // The editor's reason is recorded, but it no longer removes the row: a reading with a value is
    // on the page, and the threshold decides emphasis, not presence.
    expect(applied.data.funds.find((row) => row.id === 'stablecoin')?.visibility).not.toBe('hidden')
    expect(applied.provenance.selectionAudit?.hidden).toContainEqual({ factId: 'data:stablecoin', reason: 'The move is inside the usual noise band.' })
  })

  it('keeps the BTC floor visible even when the agent hides it', () => {
    const validated = validateDailyBriefingEditorial({
      ...validOutput,
      importance: [],
      hiddenData: [{ factId: 'data:btc', reason: 'The editor would rather not lead with price.' }]
    }, document(), 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(document(), validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
    expect(applied.data.market.find((row) => row.id === 'btc')?.visibility).not.toBe('hidden')
    expect(applied.provenance.selectionAudit?.shown).toContain('data:btc')
  })

  it('keeps leverage and the rate path in the data region below their threshold, as quiet rows', () => {
    const source = withMaterialData()
    const validated = validateDailyBriefingEditorial({
      ...validOutput,
      importance: [
        { factId: 'data:leverage', tier: 'support', reasonText: 'Positioning is worth a line.' },
        { factId: 'data:policy-path', tier: 'support', reasonText: 'The path frames the week.' }
      ],
      hiddenData: [{ factId: 'data:stablecoin', reason: 'The supply move is inside the noise band.' }]
    }, source, 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(source, validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
    // Below the threshold is a quiet row, not a missing one: today the whole block vanished and the
    // reader could not tell "no change" from "no data".
    expect(applied.data.leverage?.visibility).not.toBe('hidden')
    expect(applied.data.policyPath?.visibility).not.toBe('hidden')
  })

  it('shows a material leverage row the agent includes', () => {
    const source = withMaterialLeverage()
    const validated = validateDailyBriefingEditorial({
      ...validOutput,
      importance: [{ factId: 'data:leverage', tier: 'support', reasonText: 'Open interest moved 12% in a day.' }],
      hiddenData: [{ factId: 'data:stablecoin', reason: 'The supply move is inside the noise band.' }]
    }, source, 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(source, validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
    expect(applied.data.leverage?.visibility).not.toBe('hidden')
    expect(applied.provenance.selectionAudit?.shown).toContain('data:leverage')
  })

  it('leaves counter-evidence and the nearest next event untouched by the data selection', () => {
    const base = document()
    const source: DailyBriefingDocument = {
      ...base,
      conclusion: base.conclusion ? {
        ...base.conclusion,
        counterEvidence: [{ statement: 'ETF flows stayed positive.', citations: [1] }]
      } : null
    }
    const validated = validateDailyBriefingEditorial({ ...validOutput, importance: [] }, source, 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(source, validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
    expect(applied.conclusion?.counterEvidence).toHaveLength(1)
    expect(applied.next.focus?.eventKey).toBe('US.FOMC')
  })

  it('does not apply a next-focus rationale that never reaches BTC/ETH', () => {
    const validated = validateDailyBriefingEditorial({
      ...validOutput,
      nextFocus: { ...validOutput.nextFocus, why: 'It is the next event on the calendar.' }
    }, document(), 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    expect(validated.value.nextFocus).toBeUndefined()
  })

  it('shows an immaterial context row whether or not the agent names it', () => {
    // The row used to appear only when the editor included it, so a quiet index vanished with no
    // trace. Presence now follows the data; the editor's list decides emphasis.
    const source = document()
    for (const editorial of [{ ...validOutput, importance: [] }, validOutput]) {
      const validated = validateDailyBriefingEditorial(editorial, source, 'zh-CN')
      expect(validated.ok).toBe(true)
      if (!validated.ok) return
      const applied = applyDailyBriefingEditorial(source, validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
      expect(applied.data.market.find((row) => row.id === 'index')?.visibility).not.toBe('hidden')
    }
  })

  it('never shows a macro that the editorial did not explain', () => {
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
    expect(applied.news.macro[0]).toMatchObject({ eventKey: 'US.CPI', visibility: 'hidden', visibilityReason: '已反映在结论中。' })
  })

  it('rejects a shown macro without a why', () => {
    expect(validateDailyBriefingEditorial({
      ...validOutput,
      items: [{ factId: 'macro:US.CPI' }]
    }, document(), 'zh-CN')).toMatchObject({ ok: false, failureCode: 'missing-macro-why', detail: 'macro:US.CPI' })
  })

  it('requires a no-consensus why to compare actual with previous', () => {
    const source = documentWithoutMacroConsensus()
    const base = {
      ...validOutput,
      lede: '稳定币继续收缩，价格压力仍在。',
      ledePattern: 'structure',
      items: [
        { factId: 'news:n1', why: '这条消息解释了风险偏好的下行。' },
        { factId: 'macro:US.PPI', why: 'PPI actual 0.4% vs previous 0.2%, so pipeline pressure is firm.' }
      ]
    }
    const validated = validateDailyBriefingEditorial(base, source, 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(source, validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
    expect(applied.news.macro[0]).toMatchObject({ eventKey: 'US.PPI', visibility: 'shown' })
    expect(applied.news.macro[0]?.consensus).toBeUndefined()
    expect(applied.news.macro[0]?.why).toContain('0.4%')

    expect(validateDailyBriefingEditorial({
      ...base,
      items: [
        { factId: 'news:n1', why: '这条消息解释了风险偏好的下行。' },
        { factId: 'macro:US.PPI', why: 'No consensus was published, so it is not actionable.' }
      ]
    }, source, 'zh-CN')).toMatchObject({ ok: false, failureCode: 'invalid-macro-why', detail: 'macro:US.PPI' })

    expect(validateDailyBriefingEditorial({
      ...base,
      items: [
        { factId: 'news:n1', why: '这条消息解释了风险偏好的下行。' },
        { factId: 'macro:US.PPI', why: 'Pipeline pressure is still firm.' }
      ]
    }, source, 'zh-CN')).toMatchObject({ ok: false, failureCode: 'invalid-macro-why', detail: 'macro:US.PPI' })
  })

  it('keeps a no-consensus event hidden with the reason the editorial gave', () => {
    const source = documentWithoutMacroConsensus()
    const validated = validateDailyBriefingEditorial({
      ...validOutput,
      lede: '稳定币继续收缩，价格压力仍在。',
      ledePattern: 'structure',
      items: [{ factId: 'news:n1', why: '这条消息解释了风险偏好的下行。' }],
      hidden: [{ factId: 'macro:US.PPI', reason: 'Low crypto relevance today.' }],
      importance: []
    }, source, 'zh-CN')
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const applied = applyDailyBriefingEditorial(source, validated.value, { promptVersion: 'v1', model: 'm1', source: 'default' })
    expect(applied.news.macro[0]).toMatchObject({ eventKey: 'US.PPI', visibility: 'hidden', visibilityReason: 'Low crypto relevance today.' })
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
