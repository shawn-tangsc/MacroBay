import { describe, expect, it } from 'vitest'

import {
  dashboardFeedStatusPublicPolicy,
  isDashboardFeedStatusQuery,
  parseDashboardFeedStatus
} from './dashboardFeedStatusContracts'

const entry = (over: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ sourceId: 'realmarketapi-market', enabled: true, hasCredential: false, ...over })

describe('dashboard feed status boundary', () => {
  it('admits the empty request and nothing else', () => {
    expect(isDashboardFeedStatusQuery({})).toBe(true)
    for (const value of [undefined, null, [], 'query', { asOf: '2026-09-14T12:00:00.000Z' }, { sourceId: 'realmarketapi-market' }]) {
      expect(isDashboardFeedStatusQuery(value)).toBe(false)
    }
  })

  it('carries the credential as a boolean and the last success as an instant', () => {
    const parsed = parseDashboardFeedStatus({
      state: 'available',
      sources: [entry({ failureCode: 'credential-rejected', lastSuccessAtMs: 1_700_000_000_000 })]
    })
    expect(parsed).toEqual({
      state: 'available',
      sources: [{
        sourceId: 'realmarketapi-market', enabled: true, hasCredential: false,
        lastSuccessAtMs: 1_700_000_000_000, failureCode: 'credential-rejected'
      }]
    })
  })

  /**
   * The guard that matters most: whatever the store happens to hold, only a code this boundary names
   * may be printed. A provider message, a URL and a key-shaped string all fail the parse, so the
   * strip falls back to "the status is unreadable" instead of repeating the material.
   */
  it.each([
    'https://api.realmarketapi.com/v1/price?apikey=abcdef0123456789',
    'apikey=abcdef0123456789',
    'Authorization: Bearer abcdef0123456789',
    'transport unavailable at https://api.example.com',
    'CredentialRejected',
    ''
  ])('refuses the unlisted failure code %j', (value) => {
    expect(parseDashboardFeedStatus({ state: 'available', sources: [entry({ failureCode: value })] })).toBeUndefined()
  })

  it('refuses a source this boundary does not serve, a duplicate and a malformed entry', () => {
    expect(parseDashboardFeedStatus({ state: 'available', sources: [entry({ sourceId: 'binance-futures-positioning' })] })).toBeUndefined()
    expect(parseDashboardFeedStatus({ state: 'available', sources: [entry(), entry()] })).toBeUndefined()
    expect(parseDashboardFeedStatus({ state: 'available', sources: [entry({ enabled: 'yes' })] })).toBeUndefined()
    expect(parseDashboardFeedStatus({ state: 'available', sources: [entry({ lastSuccessAtMs: -1 })] })).toBeUndefined()
    expect(parseDashboardFeedStatus({ state: 'available', sources: [entry({ lastSuccessAtMs: 1.5 })] })).toBeUndefined()
    // No fourth field, no accessor, no extra source: the shape is exactly what this file admits.
    expect(parseDashboardFeedStatus({ state: 'available', sources: [entry({ apiKey: 'abcdef0123456789' })] })).toBeUndefined()
    expect(parseDashboardFeedStatus({ state: 'unavailable', sources: [] })).toBeUndefined()
    expect(parseDashboardFeedStatus({ state: 'unavailable' })).toEqual({ state: 'unavailable' })
    expect(parseDashboardFeedStatus({ state: 'ready', sources: [] })).toBeUndefined()
    expect(parseDashboardFeedStatus(null)).toBeUndefined()
  })

  it('serves the three sources the dashboard actually reads and no fourth', () => {
    expect(dashboardFeedStatusPublicPolicy.sourceIds).toEqual(['realmarketapi-market', 'twelve-data-market', 'fred-rates-liquidity'])
  })
})
