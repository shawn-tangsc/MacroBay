import { describe, expect, it } from 'vitest'

import { dashboardSourceSurfacePolicy, resolveSourceFreshnessStatus, toSafeHealthView } from './intelligenceSourcesContracts'

describe('dashboard source surface policy', () => {
  it('allows the fixed DeFiLlama probe separately from its schedule projection', () => {
    expect(dashboardSourceSurfacePolicy.scheduleProjectionSourceIds).toContain('defillama-stablecoins')
    expect(dashboardSourceSurfacePolicy.connectionProbeSourceIds).toEqual([
      'alternative-fear-greed', 'binance-futures-positioning', 'defillama-stablecoins'
    ])
  })
})

describe('resolveSourceFreshnessStatus', () => {
  it('marks disabled sources as paused', () => {
    expect(resolveSourceFreshnessStatus(false, undefined)).toBe('paused')
  })

  it('marks enabled sources without a successful run as pending', () => {
    expect(resolveSourceFreshnessStatus(true, undefined)).toBe('pending')
  })

  it('marks enabled sources with a successful run as healthy', () => {
    expect(
      resolveSourceFreshnessStatus(true, {
        sourceId: 'coindesk-rss',
        runtimeStatus: 'healthy',
        lastSuccessAt: '2026-07-05T10:00:00.000Z',
        consecutiveFailures: 0
      })
    ).toBe('healthy')
  })
})

describe('toSafeHealthView', () => {
  it('keeps recent run metadata when the source is paused', () => {
    expect(
      toSafeHealthView(
        'binance-announcements',
        {
          sourceId: 'binance-announcements',
          runtimeStatus: 'failed',
          lastFailureAt: '2026-07-05T10:01:00.000Z',
          consecutiveFailures: 2,
          lastRunSummary: 'HTTP 503 while fetching binance-announcements.'
        },
        false
      )
    ).toEqual({
      sourceId: 'binance-announcements',
      runtimeStatus: 'paused',
      lastFailureAt: '2026-07-05T10:01:00.000Z',
      consecutiveFailures: 2,
      lastRunSummary: 'HTTP 503 while fetching binance-announcements.',
      checkpointPreview: 'HTTP 503 while fetching binance-announcements.',
      lastSuccessAt: undefined,
      connectivityStatus: 'failed'
    })
  })
})
