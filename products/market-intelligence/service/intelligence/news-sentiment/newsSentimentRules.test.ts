import { describe, expect, it } from 'vitest'

import { isRoutineNewsNotice, scoreNewsWithRules } from './newsSentimentRules'

describe('newsSentimentRules', () => {
  it('reads a listing as bullish and keeps unknown symbols out', () => {
    const result = scoreNewsWithRules({
      title: 'Binance Will List RWUSD and Introduce RWUSD Zero Trading Fee Promotion',
      summary: 'Binance will list RWUSD.'
    })
    expect(result.polarity).toBe('bullish')
    expect(result.strength).toBe(3)
    expect(result.reasonCode).toBe('news.listing.v1')
    expect(result.symbols).toEqual([])
  })

  it('reads a delisting as bearish before the listing rule can match', () => {
    const result = scoreNewsWithRules({
      title: 'Binance Futures Will Delist PTBUSDT and MITOUSDT USDⓈ-M Perpetual Contracts (2026-10-23)'
    })
    expect(result.polarity).toBe('bearish')
    expect(result.strength).toBe(4)
    expect(result.reasonCode).toBe('news.delisting.v1')
  })

  it('reads an exploit as the strongest bearish signal', () => {
    const result = scoreNewsWithRules({
      title: "India's largest exchange denies hack after sleuths pointed to $16 million in suspicious outflow"
    })
    expect(result.polarity).toBe('bearish')
    expect(result.strength).toBe(5)
    expect(result.reasonCode).toBe('news.exploit.v1')
  })

  it('reads a trading halt or paused withdrawals as bearish', () => {
    const result = scoreNewsWithRules({
      title: 'OKX to suspend deposits and withdrawals for maintenance'
    })
    expect(result.polarity).toBe('bearish')
    expect(result.reasonCode).toBe('news.halt.v1')
  })

  it('reads an ETF approval as bullish and tags ETH when named', () => {
    const result = scoreNewsWithRules({
      title: 'SEC Approves Spot Ethereum ETF Options'
    })
    expect(result.polarity).toBe('bullish')
    expect(result.strength).toBe(4)
    expect(result.reasonCode).toBe('news.etf-approval.v1')
    expect(result.symbols).toEqual(['ETH'])
  })

  it('reads generic enforcement as bearish', () => {
    const result = scoreNewsWithRules({
      title: 'SEC Charges Two Individuals in $50M Crypto Fraud'
    })
    expect(result.polarity).toBe('bearish')
    expect(result.reasonCode).toBe('news.enforcement.v1')
  })

  it('stays neutral when no rule matches, while still tagging a named symbol', () => {
    const result = scoreNewsWithRules({
      title: "Ethereum's Next Upgrade Could Cut Fees, Developers Say"
    })
    expect(result.polarity).toBe('neutral')
    expect(result.strength).toBe(1)
    expect(result.confidence).toBe(30)
    expect(result.reasonCode).toBe('news.no-rule.v1')
    expect(result.symbols).toEqual(['ETH'])
  })

  it('extracts BTC from a plain bitcoin headline and from a BTC ticker', () => {
    expect(scoreNewsWithRules({ title: 'Bitcoin Core changes security rules' }).symbols).toEqual(['BTC'])
    expect(scoreNewsWithRules({ title: 'BTC holds above $81,000' }).symbols).toEqual(['BTC'])
  })

  it('caps the evidence quote at 200 characters', () => {
    const title = `Binance Will List ${'X'.repeat(400)}`
    const result = scoreNewsWithRules({ title })
    expect(result.evidenceQuote?.length).toBeLessThanOrEqual(200)
  })
})


describe('isRoutineNewsNotice', () => {
  it('drops neutral low-strength maintenance notices', () => {
    expect(isRoutineNewsNotice({ title: 'OKX to Perform Scheduled Maintenance on the RFQ System', polarity: 'neutral', strength: 1 })).toBe(true)
    expect(isRoutineNewsNotice({ title: 'API upgrade window on October 22', polarity: 'neutral', strength: 2 })).toBe(true)
  })

  it('keeps directional or severe operational events', () => {
    expect(isRoutineNewsNotice({ title: 'OKX will suspend withdrawals', polarity: 'bearish', strength: 4 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'System maintenance caused a 6-hour outage', polarity: 'bearish', strength: 4 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'Exchange lists new perpetual contract', polarity: 'bullish', strength: 3 })).toBe(false)
    expect(isRoutineNewsNotice({ title: 'Protocol upgrade scheduled', polarity: 'neutral', strength: 1 })).toBe(false)
  })
})
