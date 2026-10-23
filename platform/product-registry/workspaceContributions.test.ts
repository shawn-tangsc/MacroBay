import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { ProductManifest, ProductWorkspacePanelContribution } from '../product-manifest'
import { buildGeneratedProductRegistry, generateProductRegistry, type DiscoveredProduct } from './generate'
import { createPanelRegistry } from '../workspace/registry/panelRegistry'
import { WorkspaceRegistrationError } from '../workspace/contracts'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workspace-contributions-'))
  roots.push(root)
  const productDir = join(root, 'products', 'sample-addon')
  for (const entry of ['pages/overview', 'panels/inspector']) {
    mkdirSync(join(productDir, 'desktop', entry), { recursive: true })
    writeFileSync(join(productDir, 'desktop', entry, 'index.ts'), 'export default function View() {}\n')
  }
  const panel: ProductWorkspacePanelContribution = {
    id: 'inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' }, icon: 'file-text',
    module: './desktop/panels/inspector', pageIds: ['overview'],
    supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'], defaultMode: 'embedded',
    allowMultipleInstances: false, minSize: { width: 320, height: 240 },
    preferredSize: { width: 480, height: 360 }, binding: { persistence: 'session', maxKeyBytes: 256 },
    lifecycleEvents: ['open', 'close']
  }
  const manifest: ProductManifest = {
    id: 'sample-addon', name: { 'zh-CN': 'Sample addon', 'en-US': 'Sample addon' }, version: '1.0.0',
    shellContributions: {
      menuPages: [{ id: 'overview', title: panel.title, icon: 'home', order: 1, module: './desktop/pages/overview' }],
      settingsSections: [], panels: [panel]
    },
    routes: [], navigation: [], settingsSections: [], serviceRoutes: [], tools: [], skills: [],
    agents: [], workflows: [], policies: [], evaluations: [], jobHandlers: [], migrations: []
  }
  const product: DiscoveredProduct = {
    productId: manifest.id, productDir, manifestPath: join(productDir, 'product.manifest.ts'),
    exportName: 'sampleAddonProductManifest', manifest
  }
  return { root, product, manifest, panel }
}

describe('workspace panel contributions', () => {
  it('projects a product-local panel into a namespaced registration without a loader in Main', () => {
    const { product } = fixture()
    const registry = buildGeneratedProductRegistry([product])
    expect(registry).toHaveProperty('panelEntries.0.registration', {
      panelId: 'sample-addon.inspector', title: { 'zh-CN': '检查器', 'en-US': 'Inspector' },
      icon: 'file-text', module: 'sample-addon.inspector', pageIds: ['sample-addon.overview'],
      supportedModes: ['embedded', 'docked-right', 'docked-bottom', 'detached'], defaultMode: 'embedded',
      allowMultipleInstances: false, minSize: { width: 320, height: 240 },
      preferredSize: { width: 480, height: 360 }, binding: { persistence: 'session', maxKeyBytes: 256 },
      lifecycleEvents: ['open', 'close']
    })
    expect(registry).toHaveProperty('panelEntries.0.modulePath', './desktop/panels/inspector')
  })

  it.each(['../escape', '/absolute', './missing', './desktop/panels/../../../../escape'])('rejects unsafe or missing panel module %s', (module) => {
    const { product, panel } = fixture()
    panel.module = module
    expect(() => buildGeneratedProductRegistry([product])).toThrow()
  })

  it('rejects panels bound to foreign or missing pages and duplicate panel IDs', () => {
    const { product, panel, manifest } = fixture()
    panel.pageIds = ['other-addon.overview']
    expect(() => buildGeneratedProductRegistry([product])).toThrow()
    panel.pageIds = ['missing']
    expect(() => buildGeneratedProductRegistry([product])).toThrow()
    panel.pageIds = ['overview']
    manifest.shellContributions = { ...manifest.shellContributions!, panels: [panel, panel] }
    expect(() => buildGeneratedProductRegistry([product])).toThrow()
  })

  it('rejects invalid panel capabilities during manifest validation', () => {
    const { product, panel } = fixture()
    panel.supportedModes = ['detached']
    expect(() => buildGeneratedProductRegistry([product])).toThrow()
  })

  it.each([null, { id: 'inspector', pageIds: null }, { id: 'inspector', pageIds: 'overview' }])('rejects malformed contributions with a typed safe error: %j', (panel) => {
    const { product, manifest } = fixture()
    manifest.shellContributions = { ...manifest.shellContributions!, panels: [panel as unknown as ProductWorkspacePanelContribution] }
    expect(() => buildGeneratedProductRegistry([product])).toThrow(WorkspaceRegistrationError)
  })

  it('rejects sparse panel contribution collections with a typed safe error', () => {
    const { product, manifest } = fixture()
    manifest.shellContributions = { ...manifest.shellContributions!, panels: new Array(1) }
    expect(() => buildGeneratedProductRegistry([product])).toThrow(WorkspaceRegistrationError)
  })

  it('rejects panel modules escaping through symlinks and empty directories', () => {
    const { root, product, panel } = fixture()
    const outside = join(root, 'outside.ts')
    writeFileSync(outside, 'export default function Outside() {}')
    symlinkSync(outside, join(product.productDir, 'desktop/panels/linked.ts'))
    panel.module = './desktop/panels/linked'
    expect(() => buildGeneratedProductRegistry([product])).toThrow()
    mkdirSync(join(product.productDir, 'desktop/panels/empty'))
    panel.module = './desktop/panels/empty'
    expect(() => buildGeneratedProductRegistry([product])).toThrow()
  })

  it('rejects extensionless resolution shadows rather than trusting a different TypeScript entry', () => {
    const { root, product, panel } = fixture()
    writeFileSync(join(root, 'outside.js'), 'export default function Outside() {}')
    const path = join(product.productDir, 'desktop/panels/shadow')
    writeFileSync(`${path}.ts`, 'export default function Safe() {}')
    symlinkSync(join(root, 'outside.js'), `${path}.js`)
    panel.module = './desktop/panels/shadow'
    expect(() => buildGeneratedProductRegistry([product])).toThrow(WorkspaceRegistrationError)
  })

  it('rejects a folder package entry that could override the validated index', () => {
    const { product } = fixture()
    writeFileSync(join(product.productDir, 'desktop/panels/inspector/package.json'), JSON.stringify({ main: './other.js' }))
    expect(() => buildGeneratedProductRegistry([product])).toThrow(WorkspaceRegistrationError)
  })

  it('generates a typed loader projection using only a temporary product and output directory', async () => {
    const { root, product, manifest } = fixture()
    writeFileSync(product.manifestPath, `export const sampleAddonProductManifest = ${JSON.stringify(manifest)}\n`)
    const outputDir = join(root, 'products/generated')
    await generateProductRegistry({ workspaceRoot: root, outputDir })
    const shell = readFileSync(join(outputDir, 'shellRegistry.ts'), 'utf8')
    expect(shell).toContain('export const productPanelEntries = [')
    expect(shell).toContain('satisfies readonly GeneratedProductPanelEntry[]')
    expect(shell).toContain('"panelId":"sample-addon.inspector"')
    expect(shell).toContain('import("../sample-addon/desktop/panels/inspector")')
    const generated = await import(pathToFileURL(join(outputDir, 'shellRegistry.ts')).href)
    const [entry] = generated.productPanelEntries
    const mainRegistry = createPanelRegistry({ pageIds: ['sample-addon.overview'], moduleIds: ['sample-addon.inspector'] })
    mainRegistry.register(entry.registration)
    mainRegistry.seal()
    expect(mainRegistry.get(entry.registration.panelId)).toEqual(entry.registration)
    expect(typeof (await entry.load()).default).toBe('function')
    expect(mainRegistry.get(entry.registration.panelId)).not.toHaveProperty('load')
  })

  it('keeps the zero-product registry usable after a product directory is removed', async () => {
    const { root, product } = fixture()
    rmSync(product.productDir, { recursive: true })
    const registry = await generateProductRegistry({ workspaceRoot: root, outputDir: join(root, 'output') })
    expect(registry).toMatchObject({ productIds: [], menuEntries: [], settingsEntries: [], panelEntries: [] })
    expect(readFileSync(join(root, 'output/shellRegistry.ts'), 'utf8')).toContain('productPanelEntries')
  })
})

/**
 * P2-01：产品 manifest 的一级菜单只增加一个**可选** workspace 能力字段（additive）。
 * 旧 manifest（没有该字段）必须继续通过校验，并按平台命名策略补齐「可分离 + 单实例」。
 */
describe('workspace menu page capability contributions（P2-01 additive）', () => {
  it('projects platform defaults for a menu page without the optional workspace extension', async () => {
    const { root, product } = fixture()
    expect(product.manifest.shellContributions?.menuPages[0]).not.toHaveProperty('workspace')

    const registry = buildGeneratedProductRegistry([product])
    expect(registry.menuEntries[0]).toMatchObject({
      id: 'sample-addon.overview',
      routePath: '/sample-addon/overview',
      workspace: { supportsDetached: true, allowMultipleInstances: false }
    })

    writeFileSync(product.manifestPath, `export const sampleAddonProductManifest = ${JSON.stringify(product.manifest)}\n`)
    const outputDir = join(root, 'products/generated')
    await generateProductRegistry({ workspaceRoot: root, outputDir })
    const shell = readFileSync(join(outputDir, 'shellRegistry.ts'), 'utf8')
    expect(shell).toContain('"supportsDetached":true')
    expect(shell).toContain('"allowMultipleInstances":false')
  })

  it('projects an explicit workspace declaration without rewriting the manifest', () => {
    const { product } = fixture()
    const menuPage = product.manifest.shellContributions!.menuPages[0]!
    product.manifest.shellContributions = {
      ...product.manifest.shellContributions!,
      menuPages: [{ ...menuPage, workspace: { supportsDetached: true, allowMultipleInstances: true } }]
    }

    const registry = buildGeneratedProductRegistry([product])
    expect(registry.menuEntries[0]?.workspace).toEqual({ supportsDetached: true, allowMultipleInstances: true })
    // 校验/投影不写回 manifest：默认值与显式声明都只存在于投影结果里
    expect(product.manifest.shellContributions.menuPages[0]?.workspace).toEqual({ supportsDetached: true, allowMultipleInstances: true })
    expect(product.manifest.shellContributions.menuPages[0]).not.toHaveProperty('productId')
  })

  it.each([
    { workspace: 'detached' },
    { workspace: null },
    { workspace: { unknown: true } },
    { workspace: { supportsDetached: 'yes' } },
    { workspace: { allowMultipleInstances: 1 } }
  ])('rejects malformed workspace capability declarations: %j', (workspace) => {
    const { product } = fixture()
    const menuPage = product.manifest.shellContributions!.menuPages[0]!
    product.manifest.shellContributions = {
      ...product.manifest.shellContributions!,
      menuPages: [{ ...menuPage, workspace } as unknown as (typeof menuPage)]
    }
    expect(() => buildGeneratedProductRegistry([product])).toThrow()
  })

  it('keeps the manifest extension additive: a manifest without any menu/panel capability still validates', () => {
    const { product } = fixture()
    product.manifest.shellContributions = { menuPages: [], settingsSections: [], panels: [] }
    const registry = buildGeneratedProductRegistry([product])
    expect(registry.menuEntries).toEqual([])
    expect(registry.panelEntries).toEqual([])
    expect(registry.settingsEntries).toEqual([])
  })
})
