import { describe, expect, it } from 'vitest'

import type { PanelView } from '../../../service/intelligence/application/sourceProjection'
import { mergeDashboardPanelView } from './dashboardPanelMerge'

function provider(providerId: string, sourceIds: string[]) {
  return {
    providerId,
    displayName: providerId,
    category: 'crypto',
    credential: 'none',
    sources: sourceIds.map((sourceId) => ({ sourceId, displayName: sourceId, enabled: false }))
  }
}

function panel(providers: ReturnType<typeof provider>[], enabled = 0): PanelView {
  return {
    panel: { panelId: 'dashboard', agentId: 'crypto', displayName: 'Crypto dashboard' },
    providers: providers as never,
    counts: { sources: providers.reduce((total, entry) => total + entry.sources.length, 0), enabled }
  }
}

describe('mergeDashboardPanelView', () => {
  it('adds sources the renderer knows but a lagging main process does not list', () => {
    const remote = panel([provider('binance', ['binance-futures-positioning'])], 1)
    const local = panel([
      provider('binance', ['binance-announcements', 'binance-futures-positioning']),
      provider('sec', ['sec-rss'])
    ])

    const merged = mergeDashboardPanelView(remote, local)
    expect(merged.providers.map((entry) => entry.providerId)).toEqual(['binance', 'sec'])
    expect(merged.providers[0]?.sources.map((entry) => entry.sourceId)).toEqual([
      'binance-futures-positioning',
      'binance-announcements'
    ])
    expect(merged.counts).toEqual({ sources: 3, enabled: 1 })
  })

  it('keeps the remote view when the local registry has nothing extra', () => {
    const remote = panel([provider('fred', ['fred-rates-liquidity'])], 1)
    expect(mergeDashboardPanelView(remote, panel([]))).toEqual(remote)
  })
})
