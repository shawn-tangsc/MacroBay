import { describe, expect, it } from 'vitest'

import { shouldShowMarketCalendarProxyNotice } from './marketCalendarProxyNotice'
import type { MarketCalendarSource } from '../../../../contracts/macro/marketCalendarQueryContracts'

const kinds = ['economic-indicator', 'financial-event', 'central-bank-activity'] as const
const observedAt = '2026-10-22T15:00:00.000Z'

function feeds(attemptFor: (index: number) => MarketCalendarSource['latestAttempt']): MarketCalendarSource[] {
  return kinds.map((eventType, index) => {
    const attempt = attemptFor(index)
    return { eventType, status: 'unavailable', sourceObservedAt: null, ...(attempt ? { latestAttempt: attempt } : {}) }
  })
}

const failed = (failureCode?: 'response-unavailable' | 'parse-unavailable') => ({
  state: 'failed' as const,
  attemptedAt: observedAt,
  ...(failureCode ? { failureCode } : {})
})

describe('market calendar proxy notice', () => {
  it('appears when every feed failed to answer at its latest attempt', () => {
    expect(shouldShowMarketCalendarProxyNotice(feeds(() => failed('response-unavailable')))).toBe(true)
  })

  it('stays away when the page has not attempted anything yet', () => {
    expect(shouldShowMarketCalendarProxyNotice(feeds(() => undefined))).toBe(false)
    expect(shouldShowMarketCalendarProxyNotice([])).toBe(false)
  })

  it('stays away while a single feed answers, because one endpoint is not the network path', () => {
    expect(shouldShowMarketCalendarProxyNotice(feeds((index) => index === 0 ? failed('response-unavailable') : undefined))).toBe(false)
    expect(shouldShowMarketCalendarProxyNotice(feeds((index) => index === 0
      ? { state: 'succeeded' as const, attemptedAt: observedAt }
      : failed('response-unavailable')))).toBe(false)
  })

  it('stays away for a verdict the wire did answer, such as a parse refusal', () => {
    expect(shouldShowMarketCalendarProxyNotice(feeds(() => failed('parse-unavailable')))).toBe(false)
    expect(shouldShowMarketCalendarProxyNotice(feeds(() => failed()))).toBe(false)
  })

  it('clears itself once a refresh replaces the failed attempts', () => {
    expect(shouldShowMarketCalendarProxyNotice(feeds(() => ({ state: 'succeeded' as const, attemptedAt: observedAt })))).toBe(false)
  })
})
