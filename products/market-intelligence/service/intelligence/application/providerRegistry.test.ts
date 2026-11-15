import { describe, expect, it } from 'vitest'

import {
  agentRegistry,
  allSources,
  getPanel,
  getProvider,
  getSource,
  panelRegistry,
  providerRegistry,
  type PanelId
} from './providerRegistry'
import { createDefaultSourceProfile, resolveRuntimeConfig } from './sourceRuntimeConfig'
import { getIntelligenceSourceDefinition } from './sourceCatalog'
import { resolveFactSource } from '../../../contracts/factSources'
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
  it('hands the ETF reading to the new source and stops the old one, without losing the calendar key', () => {
    const source = getSource('cryptoetf-etf-flows')
    expect(source?.collection).toBe('adapter')
    expect(source?.purposes).toEqual(['dashboard', 'briefing'])
    expect(source?.capabilities).toEqual({ runNow: 'none', testConnection: true })
    // The four-state line follows an explicit flag, so it no longer doubles as a switch lock.
    expect(getProvider('cryptoetf')?.credentialStateLine).toBe(true)
    expect(getProvider('cryptoetf')?.category).toBe('crypto')
    // The old aggregate source collects nothing but keeps the key the three calendars share.
    const retired = getSource('0xrouter-aggregate-provider')
    expect(retired?.collection).toBe('none')
    expect(retired?.purposes).toEqual([])
    expect(getProvider('0xrouter')?.credentialSourceId).toBe('0xrouter-aggregate-provider')
    const definition = getIntelligenceSourceDefinition('cryptoetf-etf-flows')!
    const config = resolveRuntimeConfig({
      definition,
      profile: { ...createDefaultSourceProfile(definition), enabled: true, credentialRef: 'cryptoetf-etf-flows-credentials' }
    })
    // Switched on with a key, the generic runtime arms it on the fixed ten-minute cadence.
    expect(config.enabled).toBe(true)
    expect(config.pollingIntervalSec).toBe(10 * 60)
  })

  /**
   * 四态那一行只由这一个标记决定（产品 §3.7）：标记落在注册表，组件里不按 providerId 特判。
   * 判据不是「只有某一个 provider」，而是**带标记的 provider 必须真是「只验证密钥、还不采集」**——
   * 标记一旦被当成装饰挂在会采集的源上，那一行就会对读者说「本版不采集数据」的假话。
   */
  it('declares the ETF fact on the source that runs, and on nothing else', () => {
    const claimants = allSources().filter((source) => source.provides?.includes('etf-net-flow') === true)
    expect(claimants.map((source) => source.sourceId)).toEqual(['cryptoetf-etf-flows'])
    // 旧锚已经摘了采集授权：声明了反而会被解析成候选。
    expect(getSource('0xrouter-aggregate-provider')?.provides ?? []).toEqual([])
    // 读者把它的 profile 关掉以后，解析结果是 none——不是猜一个、也不是 unknown。
    const views = allSources().map((source) => ({ ...source, enabled: source.sourceId === 'cryptoetf-etf-flows' ? false : true, jobRegistered: true }))
    expect(resolveFactSource({ factId: 'etf-net-flow', sources: views })).toEqual({ kind: 'none' })
    const running = allSources().map((source) => ({ ...source, enabled: true, jobRegistered: true }))
    expect(resolveFactSource({ factId: 'etf-net-flow', sources: running }))
      .toEqual({ kind: 'resolved', sourceId: 'cryptoetf-etf-flows' })
  })

  it('keeps the verification-only marker only on providers that still collect nothing', () => {
    const verified = providerRegistry.filter((provider) => provider.notice === 'verification-only')
    /* 原来守的是「只验证密钥的源不许被排期」。CryptoETF 切换后真的采集了，所以它必须摘掉这个标记——
       这条断言接替旧判据：标记只允许出现在不采集的 provider 上，采集源一律不许带。 */
    expect(verified.map((provider) => provider.providerId)).not.toContain('cryptoetf')
    for (const provider of verified) {
      for (const source of provider.sources) {
        expect(source.collection, `${provider.providerId}:${source.sourceId}`).toBe('none')
        expect(source.capabilities?.testConnection, `${provider.providerId}:${source.sourceId}`).toBe(true)
      }
    }
  })

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

  /**
   * 「待接入」= 读者手里没有这个源：不能开、不能立即采、不出现采集控件。
   *
   * **但它可以在后台被产品自有作业采集**（双写阶段就是这样：`visibility: 'pending'` + `collection: 'job'`）。
   * 这条以前一刀切要求 `collection === 'none'`，把「界面锁着、后台在采」判成了违规；真正的违规只有一种：
   * `collection: 'adapter'` —— 那是通用适配器按读者的开关在跑，界面上却看不到任何开关。
   */
  it('keeps pending sources out of the reader hands, whichever scheduler collects them', () => {
    for (const source of sources.filter((item) => item.visibility === 'pending')) {
      expect(source.collection, source.sourceId).not.toBe('adapter')
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
    // 私有数据源的说明横幅是**注册表数据**（渲染层按类别找文案），组件里不出现源名。
    expect(getProvider('0xrouter')?.notice).toBe('private-data-source')
    expect(getProvider('realmarketapi')?.notice).toBeUndefined()
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

  it('keeps 0xRouter out of the dashboard panel but configurable in the calendar panel', () => {
    /* 2026-11-15 用户改口：0xRouter 三条日历源**恢复为读者可配置的补充源**
       （「只有配置了的，才注册定时获取的任务」）。所以：
       - 看板面板里仍然没有它（它不供看板事实）；
       - 日历面板里**有**这三条，能开关、能被读到启用状态；
       - ETF 那条仍是维护用（可见、可测、不采集）。 */
    expect(panelView('dashboard')?.providers.some((provider) => provider.providerId === '0xrouter')).toBe(false)
    expect(panelView('economic-calendar')?.providers.some((provider) => provider.providerId === '0xrouter')).toBe(true)
    const router = providerRegistry.find((provider) => provider.providerId === '0xrouter')
    expect(router?.sources.map((source) => source.sourceId)).toEqual([
      'macro-calendar-0xrouter-economic-data',
      'macro-calendar-0xrouter-financial-events',
      'macro-calendar-0xrouter-central-bank-activities',
      '0xrouter-aggregate-provider'
    ])
    for (const source of router?.sources.slice(0, 3) ?? []) {
      expect(source.purposes).toEqual(['calendar'])
      expect(source.collection).toBe('job')
      expect(source.visibility).not.toBe('hidden')
    }
    expect(router?.sources[3]).toMatchObject({ maintenanceOnly: true, collection: 'none', purposes: [], capabilities: { runNow: 'none', testConnection: true } })
    expect(router?.sources[3]?.visibility).not.toBe('hidden')
  })

  it('marks every proxy-only source as needing a proxy and leaves reachable sources unmarked', () => {
    // 判据是实测（2026-11-12：直连 vs 经本地代理对照），不是名单印象：
    // 直连 000、或只回一张边缘拦截页而拿不到可用响应的，算「需要代理」。
    const blocked = [
      'binance-announcements',
      'binance-api-updates',
      'binance-spot-market',
      'binance-futures-positioning',
      'okx-latest-announcements',
      'okx-api-announcements',
      'coingecko-market',
      'coindesk-rss',
      'policy-path-market',
      'ethereum-foundation-blog',
      'coinbase-status',
      'kraken-status',
      'kraken-system-status',
      'solana-status',
      // 直连回 403 但那是边缘拦截，接口要经代理才通（读者 2026-11-12 确认）。
      '0xrouter-aggregate-provider'
    ]
    for (const sourceId of blocked) {
      expect(allSources().find((source) => source.sourceId === sourceId)?.requiresProxy, sourceId).toBe(true)
    }
    expect(panelView('dashboard')?.providers.find((provider) => provider.providerId === 'binance')?.sources
      .every((source) => source.requiresProxy === true)).toBe(true)

    // 直连就能拿回可用 HTTP 响应（含 401/403：那是缺钥匙/缺 UA）的一律不标。
    /* 直连可达、**不要**标代理的源。CryptoETF 是实测进来的（2026-11-13：绕开代理直连 200、
       2.2 秒、路由走 en0 物理网卡），不是「忘了标」——别为了跟币安/OKX 视觉统一补上它。 */
    const reachable = [
      /* Narwhal：2026-11-13 实测直连 200（上海电信、无代理），不带 key 401 → 不该挂 VPN 标签。 */
      'macro-calendar-narwhal-economic-data',
      'macro-calendar-narwhal-financial-events',
      'macro-calendar-narwhal-central-bank-activities',
      'cryptoetf-etf-flows', 'defillama-stablecoins', 'defillama-tvl',
      'fred-rates-liquidity', 'alternative-fear-greed', 'federal-reserve-rss', 'cftc-rss',
      'sec-rss', 'bls-economic-series', 'bea-economic-series', 'treasury-fiscal-data',
      'twelve-data-market', 'realmarketapi-market', 'github-releases'
    ]
    for (const sourceId of reachable) {
      expect(allSources().find((source) => source.sourceId === sourceId)?.requiresProxy, sourceId).toBeUndefined()
    }
    expect(providerRegistry.filter((provider) => provider.sources.some((source) => source.requiresProxy)).map((provider) => provider.providerId))
      .toEqual(['policy-path', 'binance', 'okx', 'coingecko', 'coindesk', 'ethereum-foundation', '0xrouter', 'coinbase', 'kraken', 'solana'])
  })

  it('names the provider credential source even in a panel that does not list it', () => {
    /* 换源后这条判据跟着搬家：Narwhal 的密钥锚在 `-economic-data`，而日历面板列的就是三条 feed；
       锚那条不在面板里也要能说出来，否则密钥框整个不见。 */
    const calendar = panelView('economic-calendar')?.providers.find((provider) => provider.providerId === 'narwhal')
    expect(calendar?.sources.map((source) => source.collection)).toEqual(['job', 'job', 'job'])
    expect(calendar?.credentialSourceId).toBe('macro-calendar-narwhal-economic-data')
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
