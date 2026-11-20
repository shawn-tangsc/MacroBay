import { describe, expect, it } from 'vitest'

import {
  buildNewsSentimentMessages,
  NEWS_SENTIMENT_STRENGTH_SCALE,
  parseNewsPolarityModelOutput
} from './newsSentimentModel'

const BODY =
  'The U.S. risks losing digital asset business to faster-moving jurisdictions in Asia, the Middle East and Bermuda after the Senate failed to advance the Clarity Act.'

function output(overrides: Record<string, unknown> = {}) {
  return {
    polarity: 'bullish',
    strength: 2,
    confidence: 64,
    symbols: [],
    reasonCode: 'us-clarity-act-stalled',
    evidenceQuote: 'The U.S. risks losing digital asset business to faster-moving jurisdictions in Asia',
    ...overrides
  }
}

describe('newsSentimentModel', () => {
  it('accepts a valid output whose quote is a real substring', () => {
    const parsed = parseNewsPolarityModelOutput(output(), BODY)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.polarity).toBe('bullish')
  })

  it('accepts a quote whose whitespace differs from the source', () => {
    const parsed = parseNewsPolarityModelOutput(
      output({ evidenceQuote: 'The U.S.  risks\nlosing digital asset business' }),
      BODY
    )
    expect(parsed.ok).toBe(true)
  })

  it('rejects an invented quote', () => {
    const parsed = parseNewsPolarityModelOutput(output({ evidenceQuote: 'The SEC approved every ETF today' }), BODY)
    expect(parsed).toMatchObject({ ok: false, errorCode: 'news-model-invalid-output' })
  })

  it('keeps an over-long quote a verbatim substring instead of appending an ellipsis', () => {
    // The prompt asks for ≤200 characters; when the model ignores it, cutting the quote is fine,
    // but the stored text is shown as evidence and must still exist in the article word for word.
    const longBody = 'A'.repeat(300)
    const parsed = parseNewsPolarityModelOutput(output({ evidenceQuote: 'A'.repeat(201) }), longBody)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.evidenceQuote).toHaveLength(200)
    expect(longBody.includes(parsed.value.evidenceQuote!)).toBe(true)
  })

  it('rejects unknown symbols, invalid ranges and a missing reason', () => {
    expect(parseNewsPolarityModelOutput(output({ symbols: ['DOGE'] }), BODY).ok).toBe(false)
    expect(parseNewsPolarityModelOutput(output({ strength: 9 }), BODY).ok).toBe(false)
    expect(parseNewsPolarityModelOutput(output({ confidence: 101 }), BODY).ok).toBe(false)
    expect(parseNewsPolarityModelOutput(output({ reasonCode: '' }), BODY).ok).toBe(false)
  })

  it('keeps BTC and ETH symbols only', () => {
    const parsed = parseNewsPolarityModelOutput(output({ symbols: ['ETH', 'BTC'] }), BODY)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.symbols).toEqual(['ETH', 'BTC'])
  })

  it('keeps a normalised entity set so the same event merges across sources', () => {
    const parsed = parseNewsPolarityModelOutput(
      output({
        entities: [
          { name: 'U.S. SEC', kind: 'org' },
          { name: 'u.s. sec', kind: 'org' },
          { name: 'Clarity Act', kind: 'bill' }
        ]
      }),
      BODY
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.entities).toEqual([
      { name: 'clarity act', kind: 'bill' },
      { name: 'u.s. sec', kind: 'org' }
    ])
  })

  it('rejects an entity kind outside the closed set instead of silently merging on it', () => {
    const parsed = parseNewsPolarityModelOutput(
      output({ entities: [{ name: 'sec', kind: 'regulator' }] }),
      BODY
    )
    expect(parsed).toMatchObject({ ok: false, errorCode: 'news-model-invalid-output' })
  })

  it('stores why at most 40 characters and rejects a longer one rather than cutting it', () => {
    const ok = parseNewsPolarityModelOutput(output({ why: '规则投票失败，亚洲市场可能抢走业务。' }), BODY)
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.value.why).toBe('规则投票失败，亚洲市场可能抢走业务。')

    const tooLong = parseNewsPolarityModelOutput(output({ why: 'x'.repeat(41) }), BODY)
    expect(tooLong.ok).toBe(false)
  })

  it('treats a missing entity field as no entities, not as a broken answer', () => {
    const parsed = parseNewsPolarityModelOutput(output(), BODY)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.entities).toBeUndefined()
  })

  it('builds a prompt that carries the body as data and caps it', () => {
    const messages = buildNewsSentimentMessages({
      sourceName: 'CoinDesk',
      publishedAt: '2026-10-24T12:00:00.000Z',
      title: 'U.S. Clarity Act failure gives Asia an edge',
      body: 'x'.repeat(20_000)
    })
    expect(messages[0]?.content).toContain('JSON')
    expect(messages[0]?.content).toContain('data')
    // 归并键的素材必须向模型要，否则抽取只能靠猜；`why` 同批要、但本版不上屏。
    expect(messages[0]?.content).toContain('entities')
    expect(messages[0]?.content).toContain('why')
    const user = messages[1]?.content ?? ''
    expect(user).toContain('<article>')
    expect(user.length).toBeLessThan(7_000)
  })
})

/**
 * 强度五档的**措辞守卫**（用户 2026-11-18 批准的最终版）。
 *
 * 判据不是「提示词里出现了 strength 这个词」，而是**每一档的定义逐字都在构建出的提示词里**：
 * 删掉一档、改掉一个词，这里就红。五档是推送门槛与触发判定共用的那把尺，悄悄少一档，
 * 模型就会自己发明中间档，而记录上看不出来。
 *
 * **期望值逐字写在这里、不 import 提示词常量的文本**：从常量循环断言「常量在提示词里」是拿同一份
 * 数据跟自己比，恒真——改词也不会红。文本身份由这张表保管，常量只管拼进提示词。
 */
const APPROVED_STRENGTH_SCALE = Object.freeze([
  '1 = 与加密市场无关（例行公告、企业融资、业务无关行业）',
  '2 = 加密行业内部相关，但只涉及单一资产/小众项目，无外溢',
  '3 = 影响整体风险偏好或一类资产（大盘科技与半导体财报、美股大盘、美元/利率/美债、监管政策表态、主流金融机构动作）',
  '4 = 直接影响 BTC/ETH 资金流或供需（ETF 大额申赎、稳定币供给剧变、交易所/托管风险、主流链安全事件、头部政策落地）',
  '5 = 可能改变趋势的冲击（监管禁令/重大执法、头部交易所暴雷、脱锚、国家级采用或禁止、创纪录的 ETF 流入流出）'
] as const)

describe('strength scale is written into the prompt, all five levels', () => {
  const system = (): string => buildNewsSentimentMessages({
    sourceName: 'CoinDesk',
    publishedAt: '2026-10-24T12:00:00.000Z',
    title: 'Nvidia earnings beat lifts chip stocks',
    body: 'Chip makers rallied after the results.'
  })[0]!.content

  it('carries all five approved definitions, verbatim', () => {
    const prompt = system()
    for (const line of APPROVED_STRENGTH_SCALE) {
      expect(prompt).toContain(line)
    }
  })

  it('exposes exactly five levels, numbered 1..5, from one constant', () => {
    expect(NEWS_SENTIMENT_STRENGTH_SCALE.map((entry) => entry.level)).toEqual([1, 2, 3, 4, 5])
    expect(NEWS_SENTIMENT_STRENGTH_SCALE).toHaveLength(APPROVED_STRENGTH_SCALE.length)
  })

  it('lets the model see the scale in the same call as the JSON contract, not a second prompt', () => {
    const prompt = system()
    expect(prompt).toContain('"strength":1-5')
    expect(prompt).toContain('only these five levels')
  })
})
