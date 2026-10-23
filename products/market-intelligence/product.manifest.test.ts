import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { marketIntelligenceProductManifest } from './product.manifest'

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
        icon: 'message-square-text',
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
    const drawer = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/AgentActivationDrawer.tsx'), 'utf8')
    const model = readFileSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/agentPortalModel.ts'), 'utf8')
    const portalSources = [portal, drawer, model].join('\n')
    // The page composes four injected read-only clients and nothing else; each is named here so a
    // fifth one cannot slip in without this list changing.
    const approvedClients = ['../../shared/ipc/crossAssetObservationClient', '../../shared/ipc/dashboardFeedStatusClient', '../../shared/ipc/macroMarketSnapshotClient', '../../shared/ipc/macroRatesSnapshotClient']

    expect(page).toContain('AgentPortal')
    expect(page).toContain('AgentActivationDrawer')
    const imports = [...page.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(match => match[1])
    expect(imports.filter(path => /ipc\//.test(path))).toEqual(approvedClients)
    const withoutApprovedClients = page.split('\n').filter(line => !approvedClients.some(client => line.includes(client))).join('\n')
    expect(withoutApprovedClients).not.toMatch(/intelligenceSourcesClient|window\.platform|service\/|\/service|ipc\/|node:|\bfetch\(|axios|WebSocket|require\s*\(/)
    expect(portalSources).not.toMatch(/intelligenceSourcesClient|window\.platform|service\/|\/service|ipc\/|\bfetch\(|axios|WebSocket/)
  })
})
