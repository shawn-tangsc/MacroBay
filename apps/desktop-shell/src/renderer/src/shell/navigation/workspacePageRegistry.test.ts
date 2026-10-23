import { describe, expect, it } from 'vitest'

import type { ProductMenuPageContribution } from '@platform/product-manifest'
import type { GeneratedProductMenuEntry } from '@platform/product-registry/types'
import { builtInWorkspacePages } from '@platform/workspace/registry/builtInWorkspacePages'
import { createWorkspacePageRegistry, toProductWorkspacePage } from '@platform/workspace/registry/workspacePageRegistry'

import { createBuiltInSettingsPanels } from './builtInNavEntries'
import { mergeShellNavItems } from './mergeShellNavigation'
import { createShellWorkspacePageRegistry, type ShellWorkspacePageLoader } from './workspacePageRegistry'

/**
 * P2-01 focused：Shell 本地 loader 投影与 Main 纯描述权威一致（A-T01 的 registry 部分）。
 * 三份集合必须逐项相等：可见一级菜单键 / Main 注册源 / Shell loader 投影；
 * 能力默认值只由平台策略决定，兼容缺扩展字段的既有产品菜单产物。
 */

const addonContributions: readonly ProductMenuPageContribution[] = [
  {
    id: 'overview', title: { 'zh-CN': '总览', 'en-US': 'Overview' }, icon: 'home', order: 10,
    module: './desktop/pages/overview', workspace: { allowMultipleInstances: true }
  },
  {
    id: 'legacy', title: { 'zh-CN': '旧视图', 'en-US': 'Legacy View' }, icon: 'file-text', order: 20,
    module: './desktop/pages/legacy'
  }
]

/** 与生成产物同形：第一个带已解析的 workspace 能力，第二个是缺扩展字段的旧产物。 */
const productMenuEntries: readonly GeneratedProductMenuEntry[] = [
  {
    id: 'sample-addon.overview', productId: 'sample-addon', productName: { 'zh-CN': '示例插件', 'en-US': 'Sample Addon' },
    title: addonContributions[0]!.title, icon: 'home', order: 10, routePath: '/sample-addon/overview',
    workspace: { supportsDetached: true, allowMultipleInstances: true },
    load: async () => ({ module: 'sample-addon.overview' })
  },
  {
    id: 'sample-addon.legacy', productId: 'sample-addon', productName: { 'zh-CN': '示例插件', 'en-US': 'Sample Addon' },
    title: addonContributions[1]!.title, icon: 'file-text', order: 20, routePath: '/sample-addon/legacy',
    load: async () => ({ module: 'sample-addon.legacy' })
  }
]

const builtInPageLoaders: Record<(typeof builtInWorkspacePages)[number]['pageId'], ShellWorkspacePageLoader> = {
  assistants: async () => ({ module: 'platform.assistants' }),
  agents: async () => ({ module: 'platform.agents' }),
  settings: async () => ({ module: 'platform.settings' })
}

function shellRegistry(language: 'zh-CN' | 'en-US' = 'zh-CN') {
  return createShellWorkspacePageRegistry({ language, productMenuEntries, builtInPageLoaders })
}

function platformRegistry() {
  const registry = createWorkspacePageRegistry({
    moduleIds: [
      ...builtInWorkspacePages.map((page) => page.module),
      ...addonContributions.map((contribution) => `sample-addon.${contribution.id}`)
    ],
    productIds: ['sample-addon']
  })
  builtInWorkspacePages.forEach((page) => registry.register(page))
  addonContributions.forEach((contribution) => registry.register(toProductWorkspacePage('sample-addon', contribution)))
  registry.seal()
  return registry
}

describe('shell workspace page registry（P2-01 loader 投影）', () => {
  it('可见一级菜单、Main 注册源与 Shell loader 投影三份集合逐项相等', () => {
    const navKeys = mergeShellNavItems('zh-CN', productMenuEntries).map((item) => item.key)
    const mainKeys = platformRegistry().list().map((summary) => summary.menuKey)
    const shellKeys = shellRegistry().list().map((page) => page.menuKey)

    expect([...navKeys].sort()).toEqual(['/sample-addon/legacy', '/sample-addon/overview', 'agents', 'assistants', 'settings'])
    expect([...shellKeys].sort()).toEqual([...navKeys].sort())
    expect([...mainKeys].sort()).toEqual([...navKeys].sort())
    // pageId 侧同样逐项相等（避免只对上菜单键而实例身份分叉）
    expect([...shellRegistry().list().map((page) => page.pageId)].sort())
      .toEqual([...platformRegistry().list().map((summary) => summary.id)].sort())
  })

  it('能力投影与 Main 描述一致，且缺扩展字段的旧菜单产物默认可分离/单实例', () => {
    const shellPages = new Map(shellRegistry().list().map((page) => [page.menuKey, page]))
    const mainPages = new Map(platformRegistry().list().map((summary) => [summary.menuKey, summary]))

    for (const [menuKey, mainPage] of mainPages) {
      const shellPage = shellPages.get(menuKey)
      expect(shellPage, menuKey).toBeDefined()
      expect(shellPage?.supportsDetached, menuKey).toBe(mainPage.supportsDetached)
      expect(shellPage?.allowMultipleInstances, menuKey).toBe(mainPage.allowMultipleInstances)
    }
    expect(shellPages.get('assistants')).toMatchObject({ supportsDetached: true, allowMultipleInstances: false })
    expect(shellPages.get('/sample-addon/overview')).toMatchObject({ supportsDetached: true, allowMultipleInstances: true })
    expect(shellPages.get('/sample-addon/legacy')).toMatchObject({ supportsDetached: true, allowMultipleInstances: false })
  })

  it('每个一级菜单都有本地 loader 与可发现标签，内置页标签来自 platformText', async () => {
    const registry = shellRegistry('zh-CN')
    for (const page of registry.list()) {
      expect(typeof page.load).toBe('function')
      expect(page.label.trim().length).toBeGreaterThan(0)
      expect(page.menuKey.trim().length).toBeGreaterThan(0)
    }
    expect(registry.get('assistants')?.label).toBe('助手')
    expect(registry.get('settings')?.label).toBe('设置')
    expect(await registry.get('assistants')?.load()).toEqual({ module: 'platform.assistants' })
    expect(await registry.get('sample-addon.legacy')?.load()).toEqual({ module: 'sample-addon.legacy' })
    expect(registry.getByMenuKey('/sample-addon/overview')?.pageId).toBe('sample-addon.overview')
    expect(registry.get('missing')).toBeUndefined()
  })

  it('Settings 的二级面板不得升为顶层 loader 项', () => {
    const menuKeys = new Set(shellRegistry().list().map((page) => page.menuKey))
    const settingsPanelIds = createBuiltInSettingsPanels('zh-CN').map((panel) => panel.id)

    expect(settingsPanelIds).toHaveLength(7)
    expect(settingsPanelIds).not.toContain('channels')
    expect(settingsPanelIds.filter((id) => menuKeys.has(id))).toEqual([])
    expect(menuKeys.has('settings')).toBe(true)
    expect([...menuKeys].filter((key) => key === 'settings')).toHaveLength(1)
  })

  it('内置 loader 缺失或产品菜单重复时 fail closed', () => {
    expect(() => createShellWorkspacePageRegistry({
      language: 'zh-CN',
      productMenuEntries,
      builtInPageLoaders: { assistants: async () => ({}), agents: async () => ({}) }
    })).toThrow()
    expect(() => createShellWorkspacePageRegistry({
      language: 'zh-CN',
      productMenuEntries: [productMenuEntries[0]!, { ...productMenuEntries[1]!, routePath: '/sample-addon/overview' }],
      builtInPageLoaders
    })).toThrow()
  })

  it('英文标签使用同一份注册源的本地化文案', () => {
    const registry = shellRegistry('en-US')
    expect(registry.get('assistants')?.label).toBe('Assistants')
    expect(registry.get('sample-addon.legacy')?.label).toBe('Legacy View')
  })
})
