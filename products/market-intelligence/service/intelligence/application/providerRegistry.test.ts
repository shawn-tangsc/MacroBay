import { describe, expect, it } from 'vitest'

import {
  agentRegistry,
  allSources,
  getPanel,
  getProvider,
  panelRegistry,
  providerRegistry,
  type PanelId
} from './providerRegistry'
import { resolveSourceCapabilities } from './sourceCapabilities'
import { agentView, countAgentGroups, panelView, settingsView } from './sourceProjection'

const sources = allSources()

function sourceIds(view: ReturnType<typeof settingsView>): string[] {
  return view.groups.flatMap((group) => group.providers.flatMap((provider) => provider.sources.map((source) => source.sourceId)))
}

function agentSourceIds(agentId: 'crypto' | 'stocks' | 'futures'): string[] {
  return agentView(agentId)?.groups.flatMap((group) => group.sources.map((source) => source.sourceId)) ?? []
}

function panelSourceIds(panelId: PanelId): string[] {
  return panelView(panelId)?.providers.flatMap((provider) => provider.sources.map((source) => source.sourceId)) ?? []
}

describe('provider registry contract', () => {
  it('keeps every source id unique', () => {
    const ids = sources.map((source) => source.sourceId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('assigns each source to an existing provider and category', () => {
    for (const source of sources) {
      const provider = getProvider(source.providerId)
      expect(provider, source.sourceId).toBeDefined()
      expect(provider?.category).toBeTruthy()
      expect(source.agents.length).toBeGreaterThan(0)
    }
  })

  it('keeps every panel inside the agents that own its sources', () => {
    for (const source of sources) {
      for (const panelId of source.panels) {
        const panel = getPanel(panelId)
        expect(panel, `${source.sourceId} -> ${panelId}`).toBeDefined()
        expect(source.agents, `${source.sourceId} -> ${panelId}`).toContain(panel?.agentId)
      }
    }
    for (const panel of panelRegistry) {
      expect(agentRegistry.some((agent) => agent.agentId === panel.agentId)).toBe(true)
    }
  })

  it('marks pending sources as non-collectable', () => {
    for (const source of sources.filter((item) => item.visibility === 'pending')) {
      expect(source.collection, source.sourceId).toBe('none')
      expect(source.capabilities.runNow, source.sourceId).toBe('none')
      expect(resolveSourceCapabilities(source).canEnable, source.sourceId).toBe(false)
      expect(resolveSourceCapabilities(source).canRunNow, source.sourceId).toBe(false)
    }
  })

  it('keeps activation groups pointed at real sources', () => {
    for (const agent of agentRegistry) {
      for (const group of agent.groups) {
        for (const sourceId of group.sourceIds) {
          expect(sources.some((source) => source.sourceId === sourceId), `${agent.agentId}/${group.groupId}/${sourceId}`).toBe(true)
        }
      }
    }
  })

  it('derives the crypto card group count instead of hardcoding it', () => {
    expect(countAgentGroups('crypto')).toBe(7)
    expect(countAgentGroups('stocks')).toBe(0)
    expect(countAgentGroups('futures')).toBe(0)
  })
})

describe('source projections', () => {
  it('keeps the settings inventory a superset of every agent', () => {
    const settings = new Set(sourceIds(settingsView()))
    for (const agent of agentRegistry) {
      for (const sourceId of agentSourceIds(agent.agentId)) {
        expect(settings.has(sourceId), `${agent.agentId}/${sourceId}`).toBe(true)
      }
    }
  })

  it('exposes provider websites and the 0xRouter invite link', () => {
    expect(getProvider('0xrouter')?.website).toBe('https://0xrouter.app/')
    expect(getProvider('0xrouter')?.signupUrl).toContain('invite=tangscsh')
    expect(getProvider('realmarketapi')?.signupUrl).toContain('via=Macrobay')
    expect(getProvider('fred')?.signupUrl).toContain('fred.stlouisfed.org')
  })

  it('keeps every panel a subset of its agent', () => {
    for (const panel of panelRegistry) {
      const agentSources = new Set(agentSourceIds(panel.agentId))
      for (const sourceId of panelSourceIds(panel.panelId)) {
        expect(agentSources.has(sourceId), `${panel.panelId}/${sourceId}`).toBe(true)
      }
    }
  })

  it('does not duplicate providers or sources inside a view', () => {
    const views = [
      sourceIds(settingsView()),
      agentSourceIds('crypto'),
      panelSourceIds('dashboard'),
      panelSourceIds('economic-calendar')
    ]
    for (const ids of views) {
      expect(new Set(ids).size).toBe(ids.length)
    }
    for (const panelId of ['dashboard', 'economic-calendar'] as const) {
      const providers = panelView(panelId)?.providers.map((provider) => provider.providerId) ?? []
      expect(new Set(providers).size).toBe(providers.length)
    }
  })

  it('shows 0xRouter once in the dashboard panel with all four sources', () => {
    const dashboard = panelView('dashboard')
    const routers = dashboard?.providers.filter((provider) => provider.providerId === '0xrouter') ?? []
    expect(routers).toHaveLength(1)
    expect(routers[0]?.sources.map((source) => source.sourceId)).toEqual([
      '0xrouter-aggregate-provider',
      'macro-calendar-0xrouter-economic-data',
      'macro-calendar-0xrouter-financial-events',
      'macro-calendar-0xrouter-central-bank-activities'
    ])
  })

  it('marks every proxy-only source as needing a proxy and leaves reachable sources unmarked', () => {
    const routers = getProvider('0xrouter')?.sources ?? []
    expect(routers).toHaveLength(4)
    for (const source of routers) expect(source.requiresProxy, source.sourceId).toBe(true)

    // The projection carries the flag to both panes, so the tag and the banner read one field.
    const projected = panelView('dashboard')?.providers.find((provider) => provider.providerId === '0xrouter')
    expect(projected?.sources.every((source) => source.requiresProxy === true)).toBe(true)

    // Mainland-blocked crypto venues and news: the bar and the 需要代理 tag must reach them too.
    const blocked = [
      'binance-announcements',
      'binance-api-updates',
      'binance-spot-market',
      'binance-futures-positioning',
      'okx-latest-announcements',
      'okx-api-announcements',
      'defillama-stablecoins',
      'defillama-tvl',
      'coindesk-rss'
    ]
    for (const sourceId of blocked) {
      expect(allSources().find((source) => source.sourceId === sourceId)?.requiresProxy, sourceId).toBe(true)
    }
    expect(panelView('dashboard')?.providers.find((provider) => provider.providerId === 'binance')?.sources
      .every((source) => source.requiresProxy === true)).toBe(true)

    for (const reachable of ['coingecko-market', 'fred-rates-liquidity', 'alternative-fear-greed']) {
      expect(allSources().find((source) => source.sourceId === reachable)?.requiresProxy).toBeUndefined()
    }
    expect(providerRegistry.filter((provider) => provider.sources.some((source) => source.requiresProxy)).map((provider) => provider.providerId))
      .toEqual(['binance', 'okx', 'defillama', 'coindesk', '0xrouter'])
  })

  it('names the provider credential source even in a panel that does not list it', () => {
    const calendar = panelView('economic-calendar')?.providers.find((provider) => provider.providerId === '0xrouter')
    expect(calendar?.sources.map((source) => source.collection)).toEqual(['job', 'job', 'job'])
    expect(calendar?.credentialSourceId).toBe('0xrouter-aggregate-provider')
    expect(panelView('dashboard')?.providers.find((provider) => provider.providerId === '0xrouter')?.credentialSourceId)
      .toBe('0xrouter-aggregate-provider')
  })

  it('hides hidden sources unless they are enabled', () => {
    const hidden = sourceIds(settingsView())
    expect(hidden).not.toContain('fred')
    expect(sourceIds(settingsView({ enabledById: { fred: true } }))).toContain('fred')
  })

  it('counts provider and source totals from the registry', () => {
    const view = settingsView()
    expect(view.counts.total).toBe(sourceIds(view).length)
    expect(providerRegistry.length).toBeGreaterThan(0)
    expect(panelRegistry.length).toBe(2)
  })
})
