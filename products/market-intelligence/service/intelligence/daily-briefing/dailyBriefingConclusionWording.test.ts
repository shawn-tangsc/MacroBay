import { describe, expect, it } from 'vitest'

import type { BriefingPriorConclusion, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { validateConclusionSynthesis } from './dailyBriefingConclusionValidation'
import { buildDailyBriefingPrompt } from './dailyBriefingPrompt'

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

const prior = (overrides: Partial<BriefingPriorConclusion> = {}): BriefingPriorConclusion => ({
  id: 'analysis:mi-as-1', source: 'analysis', observedAt: '2026-10-29T08:00:00.000Z',
  asOf: '2026-10-29T08:00:00.000Z', direction: 'bearish', confidence: 'high',
  summary: 'Flows pull bids away.', rationale: 'Flows turned negative.', evidenceRefs: ['ev-1'],
  ...overrides
})

const chinese = (overrides: Record<string, unknown> = {}) => ({
  direction: 'bearish',
  confidence: 'high',
  summary: 'BTC 偏空：美国 CPI 同比 3.4%，高于预期 3.2%，降息预期被压低；24 小时内 BTC 下跌 1.1%。盘中一度转多，但 CPI 公布后买盘回吐。',
  regimeChange: '与上一交易日相比，BTC 由持平转为下跌 1.1%，CPI 超预期后反弹没有延续。',
  confirmed: ['CPI 3.4% 高于预期 3.2%，BTC 的反弹在数据公布后停止。'],
  refuted: ['CPI 回落后 BTC 会反弹的判断被 3.4% 的实际值推翻。'],
  coreTension: 'CPI 3.4% 高于预期 3.2%，但 BTC 只下跌 1.1%，卖盘没有加速。',
  whatWouldChange: 'BTC 收复 1.1% 跌幅且 CPI 修正回 3.2%，会推翻偏空判断。',
  evidenceRefs: ['data:btc', 'macro:US.CPI'],
  ...overrides
})

const english = (overrides: Record<string, unknown> = {}) => ({
  direction: 'bearish',
  confidence: 'high',
  summary: 'BTC is bearish: US CPI printed 3.4% versus 3.2% expected, and BTC fell 1.1% over 24 hours. It briefly turned bid after the print, but sellers took the CPI surprise and the bounce faded.',
  regimeChange: 'Versus the prior session, BTC moved from flat to a 1.1% loss; the bounce after the CPI print did not hold.',
  confirmed: ['CPI at 3.4% versus 3.2% expected stopped the BTC bounce.'],
  refuted: ['The call that a CPI miss would lift BTC was overturned by the 3.4% print.'],
  coreTension: 'CPI at 3.4% versus 3.2% expected, yet BTC fell only 1.1%, so sellers have not accelerated.',
  whatWouldChange: 'BTC recovering the 1.1% loss with CPI revised to 3.2% would overturn the bearish read.',
  evidenceRefs: ['data:btc', 'macro:US.CPI'],
  ...overrides
})

const validate = (raw: unknown) => validateConclusionSynthesis(raw, document(), [prior()])

const expectBanned = (raw: unknown, terms: readonly string[]): void => {
  const result = validate(raw)
  expect(result).toMatchObject({ ok: false, failureCode: 'forbidden-content' })
  if (result.ok) return
  for (const term of terms) expect(result.detail).toContain(term)
}

describe('daily briefing conclusion wording', () => {
  it('passes a reader-facing Chinese verdict with direction, drivers and a market reversal', () => {
    expect(validate(chinese()).ok).toBe(true)
  })

  it('passes the same reader-facing verdict in English', () => {
    expect(validate(english()).ok).toBe(true)
  })

  it.each([
    ['窗口', '窗口内 BTC 偏空。'],
    ['多数判断', '多数判断偏空，BTC 下跌 1.1%。'],
    ['23:09', '23:09 前后一度转为偏空，BTC 下跌 1.1%。'],
    ['冻结数据', '冻结数据仍显示 BTC 下跌 1.1%。'],
    ['前提被削弱', '前提被削弱，BTC 下跌 1.1%。'],
    ['AI', 'AI 维持 BTC 偏空。'],
    ['模型', '模型维持 BTC 偏空。'],
    ['结论', '结论是 BTC 偏空。'],
    ['时间线', '时间线显示 BTC 偏空。']
  ])('rejects the internal Chinese phrase %s', (term, summary) => {
    expectBanned(chinese({ summary }), [term])
  })

  it.each([
    ['window', 'During the window, BTC fell 1.1%.'],
    ['Most calls', 'Most calls were bearish on BTC.'],
    ['23:09', 'At 23:09 BTC turned bearish.'],
    ['frozen data', 'The frozen data showed BTC down 1.1%.'],
    ['premise was weakened', 'The premise was weakened by the CPI print.'],
    ['AI', 'The AI was bearish on BTC.'],
    ['model', 'The model kept BTC bearish.'],
    ['conclusion', 'The conclusion stayed bearish on BTC.'],
    ['timeline', 'The timeline shows BTC bearish.']
  ])('rejects the internal English phrase %s', (term, summary) => {
    expectBanned(english({ summary }), [term])
  })

  it('rejects the current window/vote-count/clock/frozen-data summary in both languages', () => {
    expectBanned(
      chinese({ summary: '窗口内多数判断偏空，23:09 前后一度转为分化，冻结数据让前提被削弱，AI 维持结论不变。' }),
      ['窗口']
    )
    expectBanned(
      english({ summary: 'During the window, most calls were bearish. Around 23:09 the view briefly flipped to mixed, but the frozen data weakened the premise, so the model kept the conclusion bearish.' }),
      ['window']
    )
  })

  it('adds a repair instruction that names the market event, its number and the date', () => {
    const result = validate(chinese({ summary: '窗口内 BTC 偏空。' }))
    expect(result).toMatchObject({ ok: false, failureCode: 'forbidden-content' })
    if (result.ok) return
    expect(result.detail).toContain('Rewrite it as the market event or data, its number from FACTS, and the date.')
  })

  it('allows a clock time only when the sentence names the scheduled market event', () => {
    expect(validate(chinese({ summary: '20:30 CPI 公布后 BTC 下跌 1.1%，买盘回吐。' })).ok).toBe(true)
    expect(validate(english({ summary: 'CPI printed at 20:30 and BTC fell 1.1%.' })).ok).toBe(true)
  })

  it.each([
    ['分化', '走势分化，方向不明。'],
    ['承压', '整体承压，方向不明。'],
    ['风险偏好', '风险偏好回落，方向不明。'],
    ['流动性', '流动性收紧，方向不明。'],
    ['divergence', 'Divergence remains, direction unclear.'],
    ['under pressure', 'Under pressure, direction unclear.'],
    ['risk appetite', 'Risk appetite faded, direction unclear.'],
    ['liquidity', 'Liquidity tightened, direction unclear.']
  ])('rejects the bare vague label %s', (term, summary) => {
    expectBanned(chinese({ summary }), [term])
  })

  it.each([
    '稳定币流动性收紧，方向仍未明朗。',
    'ETF 流出使风险偏好回落，方向仍未明朗。',
    'BTC 与 ETH 走势分化，方向仍未明朗。',
    'ETF 流出使 BTC 承压，方向仍未明朗。'
  ])('accepts a vague label only when the concrete object is next to it: %s', (summary) => {
    expect(validate(chinese({ summary })).ok).toBe(true)
  })

  it.each([
    'Stablecoin liquidity tightened; direction is still unclear.',
    'ETF outflows left risk appetite weaker; direction is still unclear.'
  ])('accepts the anchored English equivalent: %s', (summary) => {
    expect(validate(english({ summary })).ok).toBe(true)
  })

  it('asks the prompt for a direction sentence, 2-3 numbered drivers and a market-language change', () => {
    const text = promptText()
    expect(text).toContain('Sentence 1 states the BTC/ETH direction')
    expect(text).toContain('2-3 direct drivers')
    expect(text).toContain('carries its number from FACTS')
    expect(text).toContain('what the market did and how you read it now')
  })

  it('lists every banned phrase and the market-event clock exception in the prompt', () => {
    const text = promptText()
    expect(text).toContain('BANNED in conclusionSynthesis')
    for (const phrase of ['窗口/窗口内', '多数判断', '冻结数据', '前提被削弱', '时间线']) expect(text).toContain(phrase)
    expect(text).toContain('unless they are a scheduled market event')
    for (const phrase of ['most calls', 'frozen data', 'premise weakened', 'conclusion', 'timeline']) expect(text).toContain(phrase)
  })

  it('no longer asks the model to narrate a divergence inside the window', () => {
    const text = promptText()
    expect(text).not.toContain('during the window the read diverged')
    expect(text).not.toContain('regime change during the window')
  })
})

function promptText(): string {
  return buildDailyBriefingPrompt({ document: document(), locale: 'zh-CN', priorConclusions: [prior()] })
    .map((message) => message.content)
    .join('\n')
}
