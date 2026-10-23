import { describe, expect, it } from 'vitest'

import { classifyExchangeAnnouncement } from './exchangeAnnouncementClassifier'

describe('exchangeAnnouncementClassifier', () => {
  it('classifies listing announcements with symbols', () => {
    const result = classifyExchangeAnnouncement({
      sourceId: 'binance-announcements',
      title: 'Binance Will List Example Token (ABC)'
    })
    expect(result.outcome).toBe('full-intelligence')
    expect(result.eventSubtype).toBe('exchange-listing')
    expect(result.symbols).toContain('ABC')
  })

  it('classifies delisting announcements', () => {
    const result = classifyExchangeAnnouncement({
      sourceId: 'binance-announcements',
      title: 'Binance Will Delist Example Token (XYZ)'
    })
    expect(result.eventSubtype).toBe('exchange-delisting')
    expect(result.impactHint?.direction).toBe('bearish')
  })

  it('classifies trading suspension', () => {
    const result = classifyExchangeAnnouncement({
      sourceId: 'binance-announcements',
      title: 'Binance to suspend trading for ABC pair'
    })
    expect(result.eventSubtype).toBe('exchange-trading-suspension')
  })

  it('classifies API updates as context-only', () => {
    const result = classifyExchangeAnnouncement({
      sourceId: 'binance-api-updates',
      title: 'Binance API Update: New Order Endpoint'
    })
    expect(result.outcome).toBe('context-only')
    expect(result.eventSubtype).toBe('exchange-api-update')
    expect(result.sentimentEligible).toBe(false)
  })

  it('ignores marketing announcements', () => {
    const result = classifyExchangeAnnouncement({
      sourceId: 'binance-announcements',
      title: 'Binance celebration campaign giveaway quiz'
    })
    expect(result.outcome).toBe('ignore')
    expect(result.ignoredReasonCode).toBe('noise-policy-filtered')
  })
})
