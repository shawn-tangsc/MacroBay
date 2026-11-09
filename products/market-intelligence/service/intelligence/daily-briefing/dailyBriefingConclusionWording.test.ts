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
    funds: [
      {
        id: 'etf-btc', group: 'funds', labelKey: 'dailyBriefing.row.etfBtc',
        importance: { tier: 'support', source: 'rule', reasonCode: 'context' },
        state: 'available', value: { number: -643_200_000, format: 'flow-usd' }, change: null,
        window: 'trading-day', observedAt: '2026-10-30T00:20:00.000Z'
      },
      {
        id: 'funding-btc', group: 'funds', labelKey: 'dailyBriefing.row.fundingBtc',
        importance: { tier: 'support', source: 'rule', reasonCode: 'context' },
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

const prior = (overrides: Partial<BriefingPriorConclusion> = {}): BriefingPriorConclusion => ({
  id: 'analysis:mi-as-1', source: 'analysis', observedAt: '2026-10-29T08:00:00.000Z',
  asOf: '2026-10-29T08:00:00.000Z', direction: 'bearish', confidence: 'high',
  summary: 'Flows pull bids away.', rationale: 'Flows turned negative.', evidenceRefs: ['ev-1'],
  ...overrides
})

const chinese = (overrides: Record<string, unknown> = {}) => ({
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

const englishDocument = (): DailyBriefingDocument => ({
  ...document(),
  edition: { ...document().edition, locale: 'en-US' }
})

const english = (overrides: Record<string, unknown> = {}) => ({
  direction: 'bearish',
  confidence: 'high',
  summary: 'US CPI printed 3.4% versus 3.2% expected, which pushed real yields higher through a delayed rate-cut path and led to a 1.10% BTC drop. Over the next one to three sessions the base case is bearish: if ETF outflows stay near -$643.2M, BTC should underperform ETH.',
  outlook: 'Over the next one to three sessions the base case is bearish: BTC underperforms ETH while ETF outflows run near -$643.2M.',
  conditions: ['ETF outflows stay negative near -$643.2M.'],
  counterEvidence: ['If ETF flows turn positive by $643.2M and BTC recovers the 1.10% loss, the bearish call is wrong.'],
  watch: ['ETF net flow -$643.2M', 'BTC funding rate at 0.00%', 'US CPI at 3.4%'],
  regimeChange: 'Turned bearish on the CPI beat.',
  confirmed: ['CPI at 3.4% versus 3.2% expected stopped the BTC bounce.'],
  refuted: ['The call that a CPI miss would lift BTC was overturned by the 3.4% print.'],
  coreTension: 'CPI at 3.4% versus 3.2% expected, yet BTC fell only 1.10%, so sellers have not accelerated.',
  whatWouldChange: 'If BTC recovers the 1.10% loss and ETF flows turn positive by $643.2M, the bearish read is wrong.',
  evidenceRefs: ['data:btc', 'macro:US.CPI', 'data:etf-btc'],
  ...overrides
})

const validate = (raw: unknown) => validateConclusionSynthesis(raw, document(), [prior()])
const validateEnglish = (raw: unknown) => validateConclusionSynthesis(raw, englishDocument(), [prior()])

const expectBanned = (raw: unknown, terms: readonly string[]): void => {
  const result = validate(raw)
  expect(result).toMatchObject({ ok: false, failureCode: 'forbidden-content' })
  if (result.ok) return
  for (const term of terms) expect(result.detail).toContain(term)
}

const forwardSuffix = '，通过资金渠道压制 BTC，未来两到三个交易日基准情形偏空，BTC 弱于 ETH。'

describe('daily briefing conclusion wording', () => {
  it('passes a forward-looking Chinese verdict with a mechanism chain and a base case', () => {
    expect(validate(chinese()).ok).toBe(true)
  })

  it('passes the same forward-looking verdict in English with English display units', () => {
    expect(validateEnglish(english()).ok).toBe(true)
  })

  it('rejects a pure recap that only reports what happened', () => {
    const recap = chinese({ summary: '美国 CPI 同比 3.4%，高于预期 3.2%；24 小时内 BTC 下跌 1.10%。' })
    expect(validate(recap)).toMatchObject({ ok: false, failureCode: 'missing-mechanism' })
  })

  it('rejects a verdict that skips the mechanism chain', () => {
    const noMechanism = chinese({
      summary: '美国 CPI 3.4% 高于预期，BTC 与 ETH 同时走弱。'
    })
    expect(validate(noMechanism)).toMatchObject({ ok: false, failureCode: 'missing-mechanism' })
  })

  it('rejects a one-sentence data recital even when it names the next day', () => {
    const dataOnly = chinese({ summary: '因为 CPI 3.4% 高于预期 3.2%，未来基准情形偏空。' })
    expect(validate(dataOnly)).toMatchObject({ ok: false, failureCode: 'data-only-summary' })
  })

  it('rejects a summary that states the outlook word for word', () => {
    const outlook = '未来两到三个交易日基准情形偏空：BTC 弱于 ETH，ETF 流出 -6.43 亿美元尚未收窄。'
    const duplicated = chinese({
      summary: `美国 CPI 3.4% 通过压低降息预期导致实际利率上行，BTC 因此下跌 1.10%。${outlook}`,
      outlook
    })
    expect(validate(duplicated)).toMatchObject({ ok: false, failureCode: 'duplicate-statement' })
  })

  it('rejects an overturn threshold that repeats one of the falsifiers', () => {
    const falsifier = '若 ETF 转为净流入 6.43 亿美元且 BTC 收复 1.10% 跌幅，则偏空判断失效。'
    const duplicated = chinese({ counterEvidence: [falsifier], whatWouldChange: falsifier })
    expect(validate(duplicated)).toMatchObject({ ok: false, failureCode: 'duplicate-statement' })
  })

  it('rejects a summary that repeats the direction tag', () => {
    const repeated = chinese({
      summary: '偏空：美国 CPI 同比 3.4%，高于预期 3.2%，通过压低降息预期导致 BTC 下跌 1.10%。未来两到三个交易日基准情形偏空，BTC 弱于 ETH。'
    })
    expect(validate(repeated)).toMatchObject({ ok: false, failureCode: 'repeated-direction' })
  })

  // 句式判据已删（2026-11-09 用户口径：不许用句式判 AI 输出）：价格目标、买卖建议这类
  // 说法不再由正则拦，交给提示词与契约。但**编造的数仍然要拒**——下面两条钉住事实判据。
  it.each([
    ['summary', 'ETF 流出 -9.99 亿美元。'],
    ['conditions', '稳定币总量降到 12.34 亿美元。']
  ])('still rejects a fabricated number in %s', (field, sentence) => {
    const base = chinese()
    const result = validate(field === 'summary'
      ? { ...base, summary: `${base.summary}${sentence}` }
      : { ...base, conditions: [...base.conditions, sentence] })
    expect(result).toMatchObject({ ok: false, failureCode: 'unknown-number' })
  })

  it.each([
    ['-0.834502697447248%', '-0.834502697447248%'],
    ['-643200000 美元', '-643200000 美元'],
    ['$6.3 billion', '$6.3 billion']
  ])('rejects the raw number format %s', (_label, sentence) => {
    const result = validate(chinese({ summary: `${chinese().summary} 盘中参考 ${sentence}。` }))
    expect(result).toMatchObject({ ok: false, failureCode: 'invalid-number-format' })
  })

  it('rejects a fabricated number even when it is formatted like a display value', () => {
    const result = validate(chinese({ summary: `${chinese().summary} ETF 流出 -9.99 亿美元。` }))
    expect(result).toMatchObject({ ok: false, failureCode: 'unknown-number' })
    if (!result.ok) expect(result.detail).toBe('-9.99')
  })

  it('rejects an invented probability by its number, not by the words around it', () => {
    // 措辞判据已撤：`70% 概率`/`70% probability` 这类句式不再由正则拦。判的是**事实**——
    // 文档里没有 70% 这个数，就按 `unknown-number` 拒（同一个数换成任何说法都一样被拒）。
    const chineseResult = validate(chinese({ summary: `${chinese().summary} 70% 概率继续下跌。` }))
    expect(chineseResult).toMatchObject({ ok: false, failureCode: 'unknown-number' })
    const englishResult = validateEnglish(english({ summary: `${english().summary} There is a 70% probability this continues.` }))
    expect(englishResult).toMatchObject({ ok: false, failureCode: 'unknown-number' })
  })

  it('rejects an outlook without an explicit bias', () => {
    const noStance = chinese({ outlook: 'BTC 弱于 ETH，ETF 流出 -6.43 亿美元尚未收窄。' })
    expect(validate(noStance)).toMatchObject({ ok: false, failureCode: 'missing-outlook' })
  })

  it('accepts the comparison when the asset sits inside it, as people write it', () => {
    // The 2026-11-04 failure, verbatim: the model compared the two assets correctly and was rejected
    // for putting "BTC" between 相对 and 更弱. Three writes, three identical outlooks, no edition.
    const written = chinese({
      outlook: '未来一到三个交易日基准情形偏空；BTC 与 ETH 的 24 小时涨跌幅读数缺失，无法从显示值直接比较，但 ETF 流出 -6.43 亿美元尚未收窄，ETH 缺少独立叙事，相对 BTC 更弱。'
    })
    expect(validate(written)).toMatchObject({ ok: true })
    // The same shape in other orders, and the English one.
    expect(validate(chinese({ outlook: '偏空；未来两到三个交易日里 ETH 比 BTC 更弱，ETF 流出 -6.43 亿美元尚未收窄。' }))).toMatchObject({ ok: true })
    expect(validate(chinese({ outlook: '偏空；未来两到三个交易日 ETH 跑输 BTC，ETF 流出 -6.43 亿美元尚未收窄。' }))).toMatchObject({ ok: true })
    expect(validateEnglish(english({ outlook: 'Bearish next two to three sessions: ETH is weaker than BTC.' }))).toMatchObject({ ok: true })
  })

  it('still rejects an outlook that merely names both assets', () => {
    // The other direction of the same bug: "BTC and ETH both fell" is not a comparison.
    const names = chinese({ outlook: '未来两到三个交易日偏空：BTC 与 ETH 都在跌，ETF 流出 -6.43 亿美元。' })
    expect(validate(names)).toMatchObject({ ok: false, failureCode: 'missing-outlook' })
  })

  it('rejects an outlook without BTC-versus-ETH relative strength', () => {
    const noRelative = chinese({ outlook: '未来两到三个交易日基准情形偏空：ETF 流出 -6.43 亿美元尚未收窄。' })
    expect(validate(noRelative)).toMatchObject({ ok: false, failureCode: 'missing-outlook' })
  })

  it('rejects a falsifier that is not a condition with a number', () => {
    const noCondition = chinese({ counterEvidence: ['ETF 流出 -6.43 亿美元。'] })
    expect(validate(noCondition)).toMatchObject({ ok: false, failureCode: 'missing-outlook' })
  })

  it('allows a clock time only when the sentence names the scheduled market event', () => {
    expect(validate(chinese({
      summary: '20:30 CPI 公布后 BTC 下跌 1.10%。因为降息预期被压低，未来两到三个交易日基准情形偏空，BTC 弱于 ETH。'
    })).ok).toBe(true)
    expect(validateEnglish(english({
      summary: 'CPI printed at 20:30 and BTC fell 1.10%. That led to a bearish base case over the next sessions, with BTC underperforming ETH.'
    })).ok).toBe(true)
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
    expect(validate(chinese({ summary: `${summary}${forwardSuffix}` })).ok).toBe(true)
  })

  it.each([
    'Stablecoin liquidity tightened; direction is still unclear.',
    'ETF outflows left risk appetite weaker; direction is still unclear.'
  ])('accepts the anchored English equivalent: %s', (summary) => {
    expect(validateEnglish(english({ summary: `${summary} Through the funding channel, the base case over the next sessions is bearish, with BTC underperforming ETH.` })).ok).toBe(true)
  })

  it('asks the prompt for the mechanism chain, the forward base case and the basis blocks', () => {
    const text = promptText()
    expect(text).toContain('mechanism chain')
    expect(text).toContain('next-1-3-day base case')
    expect(text).toContain('Each point appears exactly once')
    expect(text).toContain('conditions are the premises')
    expect(text).toContain('counterEvidence are the falsifiers')
    expect(text).toContain('BTC versus ETH relative strength')
  })

  it('asks the prompt to forbid price targets, advice and invented probabilities', () => {
    const text = promptText()
    expect(text).toContain('Price targets, buy/sell advice and invented probabilities are rejected')
    expect(text).toContain('目标价')
    expect(text).toContain('price target')
    expect(text).toContain('70% 概率')
  })

  it('asks the model to quote the FACTS display spelling instead of formatting raw numbers', () => {
    const text = promptText()
    expect(text).toContain('quote the FACTS `display` field exactly')
    expect(text).toContain('-6.43 亿美元 / -$643.2M')
    expect(text).toContain('never write a raw 9-digit amount')
    expect(text).toContain('Never format, scale, round or convert a raw value yourself')
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
