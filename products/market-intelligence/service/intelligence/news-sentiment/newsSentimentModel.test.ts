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

  it('builds a prompt that carries the body as data and caps it', () => {
    const messages = buildNewsSentimentMessages({
      sourceName: 'CoinDesk',
      publishedAt: '2026-10-24T12:00:00.000Z',
      title: 'U.S. Clarity Act failure gives Asia an edge',
      body: 'x'.repeat(20_000)
    })
    expect(messages[0]?.content).toContain('JSON')
    expect(messages[0]?.content).toContain('data')
    const user = messages[1]?.content ?? ''
    expect(user).toContain('<article>')
    expect(user.length).toBeLessThan(7_000)
  })
})
