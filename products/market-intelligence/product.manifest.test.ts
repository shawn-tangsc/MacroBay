import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { DAILY_BRIEFING_IPC_METHODS } from './service/intelligence/ipc/registerDailyBriefingIpc'
import { marketIntelligenceProductManifest } from './product.manifest'
import { INTELLIGENCE_EVENT_TOPICS } from './contracts/intelligenceEvents'

describe('market-intelligence product manifest', () => {
  it('localizes the module display name shown by the shell', () => {
    expect(marketIntelligenceProductManifest.name).toEqual({
      'zh-CN': '情报模块',
      'en-US': 'Market Intelligence'
    })
  })

  it('puts the run log between the source settings and the notifications', () => {
    const sections = marketIntelligenceProductManifest.shellContributions?.settingsSections ?? []
    expect(sections.map((section) => section.id)).toEqual([
      'intelligence-sources',
      'intelligence-run-log',
      'intelligence-notification'
    ])
    // Order is what the shell sorts by; ids alone would let the menu drift apart from the intent.
    const [sources, runLog, notifications] = sections
    expect(sources!.order).toBeLessThan(runLog!.order)
    expect(runLog!.order).toBeLessThan(notifications!.order)
    // One name for the page and the menu entry: the heading comes from the copy table.
    expect(runLog!.title).toEqual({ 'zh-CN': '运行日志', 'en-US': 'Run log' })
    expect(runLog!.module).toBe('./desktop/settings/run-log')
  })

  it('keeps one blank intelligence page without removing existing intelligence capabilities', () => {
    expect(marketIntelligenceProductManifest.shellContributions?.menuPages).toEqual([
      {
        id: 'intelligence',
        title: { 'zh-CN': '情报', 'en-US': 'Intelligence' },
        icon: 'radar',
        order: 10,
        home: true,
        module: './desktop/pages/intelligence'
      }
    ])

    const preservedMethods = [
      'intelligence.getDetail',
      'intelligence.getMonitoringScope',
      'intelligence.getOperationsHealth',
      'intelligence.getSentimentAggregates',
      'intelligence.getTimeline',
      'intelligence.getWorkspaceState',
      'intelligence.getWorkspaceTimeline',
      'intelligence.ingestEvent',
      'intelligence.retryItemAssessment'
    ]
    const serviceMethods = marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => method)

    expect(serviceMethods).toEqual(expect.arrayContaining(preservedMethods))
  })

  it('keeps the intelligence source settings and collection connection contract', () => {
    expect(marketIntelligenceProductManifest.shellContributions?.settingsSections).toEqual(
      expect.arrayContaining([
        {
          id: 'intelligence-sources',
          title: { 'zh-CN': '情报源', 'en-US': 'Intelligence Sources' },
          icon: 'database',
          order: 10,
          module: './desktop/settings/intelligence-sources'
        }
      ])
    )

    const sourceMethods = [
      'intelligenceSources.listDefinitions',
      'intelligenceSources.getPageState',
      'intelligenceSources.saveProfile',
      'intelligenceSources.setEnabled',
      'intelligenceSources.testCredentials',
      'intelligenceSources.testConnection',
      'intelligenceSources.runNow',
      'intelligenceSources.getHealth',
      'intelligenceSources.getFocusSettings',
      'intelligenceSources.saveFocusSettings'
    ]
    const serviceMethods = marketIntelligenceProductManifest.serviceRoutes.map(({ method }) => method)

    expect(serviceMethods).toEqual(expect.arrayContaining(sourceMethods))
  })

  it('declares the bounded temporal context tool contract', () => {
    const tool = marketIntelligenceProductManifest.productAgentTools?.find(item => item.toolName === 'get_market_analysis_context')
    expect(tool).toMatchObject({
      handlerId: 'market-intelligence.get-market-analysis-context', readOnly: true,
      requiresTemporalBoundary: true, timeoutMs: 5_000, maxOutputBytes: 256 * 1024
    })
    expect(tool?.inputSchema).toMatchObject({ required: ['eventGroupId', 'asOf'] })
    expect(tool?.description).toContain('市场分析')
  })

  it('declares the figure-provenance tool as read-only, with no temporal boundary and the index in its instructions', () => {
    const tool = marketIntelligenceProductManifest.productAgentTools?.find(item => item.toolName === 'explain_figure')
    expect(tool).toMatchObject({
      handlerId: 'market-intelligence.explain-figure', readOnly: true, requiresTemporalBoundary: false, timeoutMs: 5_000
    })
    // 说明里必须交代两件事，否则模型会编：数字是回答时现读的；有一族不在本进程。
    expect(tool?.description).toContain('现读')
    expect(tool?.description).toContain('不在这一侧')
    expect(marketIntelligenceProductManifest.tools?.find(item => item.id === 'explain_figure')?.module)
      .toBe('./tools/provenance-explain')
  })

  it('allows only the approved read-only IPC clients in page composition and keeps portal components isolated', () => {
    const page = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/index.tsx'), 'utf8')
    const portal = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/AgentPortal.tsx'), 'utf8')
    const model = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/agentPortalModel.ts'), 'utf8')
    const portalSources = [portal, model].join('\n')
    // The page composes these injected read-only clients and nothing else; each is named here so
    // another one cannot slip in without this list changing.
    const approvedClients = ['../../shared/ipc/crossAssetObservationClient', '../../shared/ipc/dashboardFeedStatusClient', '../../shared/ipc/macroMarketSnapshotClient', '../../shared/ipc/macroRatesSnapshotClient', '../../shared/ipc/marketDivergenceClient']

    expect(page).toContain('AgentPortal')
    const imports = [...page.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1])
    expect(imports.filter(path => /ipc\//.test(path))).toEqual(approvedClients)
    const withoutApprovedClients = page.split('\n').filter(line => !approvedClients.some(client => line.includes(client))).join('\n')
    expect(withoutApprovedClients).not.toMatch(/intelligenceSourcesClient|window\.platform|service\/|\/service|ipc\/|node:|\bfetch\(|axios|WebSocket|require\s*\(/)
    expect(portalSources).not.toMatch(/intelligenceSourcesClient|window\.platform|service\/|\/service|ipc\/|\bfetch\(|axios|WebSocket/)
  })
})

/**
 * `MI-11-R22` A1 守卫 1：产品自己的发布常量必须全部出现在自己的 `eventTopics` 里。
 * 这是「加了话题忘了声明」的唯一防线——忘了声明的表现是任务建得成、永远不触发，
 * 不报错、不报警，只有这条守卫能立刻发现。
 */
describe('market-intelligence publishable event topics', () => {
  it('declares every topic the product publishes', () => {
    const declared = new Set(marketIntelligenceProductManifest.eventTopics ?? [])

    for (const topic of Object.values(INTELLIGENCE_EVENT_TOPICS)) {
      expect(declared.has(topic)).toBe(true)
    }
  })

  it('declares exactly the consumers it registers, consuming only topics it publishes', () => {
    const declared = new Set(marketIntelligenceProductManifest.eventTopics ?? [])
    const consumers = marketIntelligenceProductManifest.eventConsumers ?? []

    expect(consumers).toHaveLength(1)
    expect(consumers[0].id).toBe('market-intelligence.market-analysis-trigger')
    expect([...consumers[0].topics]).toEqual([
      INTELLIGENCE_EVENT_TOPICS.itemCreated,
      INTELLIGENCE_EVENT_TOPICS.impactCreated,
      INTELLIGENCE_EVENT_TOPICS.sentimentUpdated
    ])
    for (const topic of consumers[0].topics) {
      expect(declared.has(topic)).toBe(true)
    }
  })
})

/**
 * 启动自检的那张表：**注册了什么，就必须在清单里登记什么**。
 *
 * 2026-11-05 的事故是这条链的反面：期配置的四个方法在代码里注册了，清单里没有，于是
 * `seal()` 拒绝启动（`product-runtime-method-baseline-mismatch`）——而"启动即崩"只有用户会撞到，
 * 我们不许自己起应用，所以这条必须由用例替用户撞。
 */
describe('market-intelligence product IPC baseline', () => {
  it('lists every briefing method the runtime registers', () => {
    const declared = new Set(marketIntelligenceProductManifest.serviceRoutes.map((entry) => entry.method))
    for (const method of Object.values(DAILY_BRIEFING_IPC_METHODS)) {
      expect(declared.has(method)).toBe(true)
    }
  })

  it('declares no briefing method the runtime does not register', () => {
    const registered = new Set<string>(Object.values(DAILY_BRIEFING_IPC_METHODS))
    const declared = marketIntelligenceProductManifest.serviceRoutes
      .map((entry) => entry.method)
      .filter((method) => method.startsWith('intelligence.dailyBriefing.'))
    // 两张表要么一样多，要么一定有一边多出来——多出来的那个方向就是"清单里挂着一个没人注册的名字"。
    expect(declared.filter((method) => !registered.has(method))).toEqual([])
  })
})
