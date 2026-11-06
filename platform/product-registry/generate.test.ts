import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildGeneratedProductRegistry, discoverProductManifests, generateProductRegistry } from './generate'
import type { ProductManifest } from '../product-manifest'
import { ProductRegistryValidationError, validateDiscoveredProductManifest } from './validate'

describe('product registry generator', () => {
  it('discovers market-intelligence from the workspace manifests', async () => {
    const products = await discoverProductManifests(process.cwd())
    expect(products.map((product) => product.productId)).toContain('market-intelligence')
  })

  it('builds shell registry entries with derived global ids and routes', async () => {
    const products = await discoverProductManifests(process.cwd())
    const registry = buildGeneratedProductRegistry(products)

    const intelligenceEntry = registry.menuEntries.find((entry) => entry.id === 'market-intelligence.intelligence')
    expect(intelligenceEntry).toMatchObject({
      routePath: '/market-intelligence/intelligence',
      icon: 'radar'
    })

    const intelligenceSourcesEntry = registry.settingsEntries.find(
      (entry) => entry.id === 'market-intelligence.intelligence-sources'
    )
    expect(intelligenceSourcesEntry).toMatchObject({ icon: 'database', order: 10 })

    const intelligenceSettingsIds = registry.settingsEntries
      .filter((entry) => entry.id.startsWith('market-intelligence.'))
      .map((entry) => entry.id)
    expect(intelligenceSettingsIds).toEqual([
      'market-intelligence.intelligence-sources',
      // 运行日志夹在两者之间：它读的是采集结果，所以排在源设置之后、通知之前。
      'market-intelligence.intelligence-run-log',
      'market-intelligence.intelligence-notification'
    ])
    const intelligenceRunLogEntry = registry.settingsEntries.find(
      (entry) => entry.id === 'market-intelligence.intelligence-run-log'
    )
    expect(intelligenceRunLogEntry).toMatchObject({ icon: 'scroll-text', order: 11 })
    const intelligenceNotificationEntry = registry.settingsEntries.find(
      (entry) => entry.id === 'market-intelligence.intelligence-notification'
    )
    // 新面板用注册表里已有的图标，不新增图标；通知顺延到 12，给运行日志腾出 11。
    expect(intelligenceNotificationEntry).toMatchObject({ icon: 'message-square-text', order: 12 })
  })

  it('rejects manifest ids that do not match the product directory', () => {
    const manifest = {
      id: 'wrong-id',
      name: { 'zh-CN': 'Broken Product', 'en-US': 'Broken Product' },
      version: '0.0.1',
      shellContributions: { menuPages: [], settingsSections: [] },
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      migrations: []
    } as unknown as ProductManifest

    expect(() =>
      validateDiscoveredProductManifest('market-intelligence', resolve(process.cwd(), 'products/market-intelligence'), manifest, new Set(), new Set(), new Set())
    ).toThrow(ProductRegistryValidationError)
  })

  it('rejects a product display name that is not localized', () => {
    const manifest = {
      id: 'market-intelligence',
      name: 'Market Intelligence',
      version: '0.0.1',
      shellContributions: { menuPages: [], settingsSections: [] },
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      migrations: []
    } as unknown as ProductManifest

    expect(() =>
      validateDiscoveredProductManifest('market-intelligence', resolve(process.cwd(), 'products/market-intelligence'), manifest, new Set(), new Set(), new Set())
    ).toThrow(/must include both zh-CN and en-US text/)
  })

  it('rejects missing contribution module paths', () => {
    const manifest = {
      id: 'market-intelligence',
      name: { 'zh-CN': 'Sample Product', 'en-US': 'Sample Product' },
      version: '0.1.0',
      shellContributions: {
        menuPages: [
          {
            id: 'missing-page',
            title: { 'zh-CN': '缺失', 'en-US': 'Missing' },
            icon: 'home',
            order: 1,
            module: './desktop/pages/does-not-exist'
          }
        ],
        settingsSections: []
      },
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      migrations: []
    } as unknown as ProductManifest

    expect(() =>
      validateDiscoveredProductManifest('market-intelligence', resolve(process.cwd(), 'products/market-intelligence'), manifest, new Set(), new Set(), new Set())
    ).toThrow(ProductRegistryValidationError)
  })

  it('rejects duplicate or blank product service route methods', () => {
    const manifest = {
      id: 'market-intelligence',
      name: { 'zh-CN': 'Sample Product', 'en-US': 'Sample Product' },
      version: '0.1.0',
      shellContributions: { menuPages: [], settingsSections: [] },
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [{ method: 'market.getOverview' }, { method: 'market.getOverview' }, { method: '  ' }],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      migrations: []
    } satisfies ProductManifest

    expect(() =>
      validateDiscoveredProductManifest(
        'market-intelligence',
        resolve(process.cwd(), 'products/market-intelligence'),
        manifest,
        new Set(),
        new Set(),
        new Set()
      )
    ).toThrow(/service route method/)
  })

  it('accepts declarative assistant templates on product manifests', () => {
    const manifest = {
      id: 'market-intelligence',
      name: { 'zh-CN': 'Sample Product', 'en-US': 'Sample Product' },
      version: '0.1.0',
      shellContributions: { menuPages: [], settingsSections: [] },
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      assistantTemplates: [
        {
          id: 'review-helper',
          name: { 'zh-CN': '复盘助手', 'en-US': 'Review Helper' },
          prompt: { 'zh-CN': '帮助用户复盘。', 'en-US': 'Help the user review.' },
          groups: ['business'],
          version: 1
        }
      ],
      migrations: []
    } as unknown as ProductManifest

    expect(() =>
      validateDiscoveredProductManifest(
        'market-intelligence',
        resolve(process.cwd(), 'products/market-intelligence'),
        manifest,
        new Set(),
        new Set(),
        new Set()
      )
    ).not.toThrow()
  })

  it('rejects invalid assistant template declarations', () => {
    const manifest = {
      id: 'market-intelligence',
      name: { 'zh-CN': 'Sample Product', 'en-US': 'Sample Product' },
      version: '0.1.0',
      shellContributions: { menuPages: [], settingsSections: [] },
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      assistantTemplates: [
        {
          id: 'Bad Id',
          name: { 'zh-CN': '缺英文', 'en-US': '' },
          prompt: { 'zh-CN': '提示词', 'en-US': 'Prompt' },
          groups: ['unknown'],
          version: 0
        }
      ],
      migrations: []
    } as unknown as ProductManifest

    expect(() =>
      validateDiscoveredProductManifest(
        'market-intelligence',
        resolve(process.cwd(), 'products/market-intelligence'),
        manifest,
        new Set(),
        new Set(),
        new Set()
      )
    ).toThrow(ProductRegistryValidationError)
  })

  it('rejects duplicate assistant template ids within a product', () => {
    const manifest = {
      id: 'market-intelligence',
      name: { 'zh-CN': 'Sample Product', 'en-US': 'Sample Product' },
      version: '0.1.0',
      shellContributions: { menuPages: [], settingsSections: [] },
      routes: [],
      navigation: [],
      settingsSections: [],
      serviceRoutes: [],
      tools: [],
      skills: [],
      agents: [],
      workflows: [],
      policies: [],
      evaluations: [],
      jobHandlers: [],
      assistantTemplates: [
        {
          id: 'review-helper',
          name: { 'zh-CN': '助手 A', 'en-US': 'Assistant A' },
          prompt: { 'zh-CN': '提示词 A', 'en-US': 'Prompt A' },
          version: 1
        },
        {
          id: 'review-helper',
          name: { 'zh-CN': '助手 B', 'en-US': 'Assistant B' },
          prompt: { 'zh-CN': '提示词 B', 'en-US': 'Prompt B' },
          version: 1
        }
      ],
      migrations: []
    } satisfies ProductManifest

    expect(() =>
      validateDiscoveredProductManifest(
        'market-intelligence',
        resolve(process.cwd(), 'products/market-intelligence'),
        manifest,
        new Set(),
        new Set(),
        new Set()
      )
    ).toThrow(/Duplicate assistant template/)
  })

  it('generates product service dependencies with platform tool, cache, and channel registration seams', async () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'product-registry-test-'))
    try {
      await generateProductRegistry({
        workspaceRoot: process.cwd(),
        outputDir
      })

      const productServicesSource = readFileSync(join(outputDir, 'productServices.ts'), 'utf8')

      expect(productServicesSource).toContain('registerProductAgentToolHandler')
      expect(productServicesSource).toContain('ProductAgentToolHandlerRegistration')
      expect(productServicesSource).toContain('registerProductCache')
      expect(productServicesSource).toContain('ProductCacheRegistrar')
      expect(productServicesSource).toContain('registerProductDisposer')
      expect(productServicesSource).toContain('ProductServiceDisposerRegistrar')
      expect(productServicesSource).toContain("import type { SecretVault } from '@platform/secrets/secretVaultTypes'")
      expect(productServicesSource).toContain('secretVault: SecretVault')
      expect(productServicesSource).toContain('platformFetch: typeof fetch')
      expect(productServicesSource).toContain('export async function registerProductServices')
      // 每个产品单独包一层：注册失败时产品 id 挂在错误上，启动失败日志与失败页共用这一条。
      expect(productServicesSource).toContain(
        "await runProductRegistration('market-intelligence', () => registermarketIntelligenceProductManifestServices(deps))"
      )
      expect(productServicesSource).toContain(
        "import { runProductRegistration } from '@platform/product-registry/productRegistrationFailure'"
      )
      const seedSource = readFileSync(join(outputDir, 'productAgentSeeds.ts'), 'utf8')
      expect(seedSource).toContain("import type { ProductAgentSeedFactory } from '@platform/ai/agent-platform/seeds/mergeAgentSeeds'")
      expect(seedSource).toContain('../market-intelligence/agents/agents/cryptoMarketAnalyst')
      expect(seedSource).toContain('productAgentSeedFactories')
      expect(productServicesSource).not.toContain('function renderProductAgentSeedsFile')
    } finally {
      rmSync(outputDir, { recursive: true, force: true })
    }
  })
})
