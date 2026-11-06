import { describe, expect, it } from 'vitest'

import { buildNewsSentimentMessages, parseNewsPolarityModelOutput } from './newsSentimentModel'

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
