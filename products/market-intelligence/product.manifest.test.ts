import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { marketIntelligenceProductManifest } from './product.manifest'
import { INTELLIGENCE_EVENT_TOPICS } from './contracts/intelligenceEvents'

describe('market-intelligence product manifest', () => {
  it('localizes the module display name shown by the shell', () => {
    expect(marketIntelligenceProductManifest.name).toEqual({
      'zh-CN': '情报模块',
      'en-US': 'Market Intelligence'
    })
  })

  it('keeps one blank intelligence page without removing existing intelligence capabilities', () => {
    expect(marketIntelligenceProductManifest.shellContributions?.menuPages).toEqual([
      {
        id: 'intelligence',
        title: { 'zh-CN': '情报', 'en-US': 'Intelligence' },
        icon: 'radar',
        order: 10,
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
