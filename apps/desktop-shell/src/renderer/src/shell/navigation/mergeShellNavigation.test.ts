import { describe, expect, it } from 'vitest'

import type { GeneratedProductMenuEntry, GeneratedProductSettingsEntry } from '@platform/product-registry/types'
import { productMenuEntries } from '@products/generated/shellRegistry'

import { createBuiltInSettingsPanels } from './builtInNavEntries'
import {
  groupShellSettingsPanels,
  mergeShellNavItems,
  splitShellSidebarNavItems,
  type ShellNavItem
} from './mergeShellNavigation'

describe('mergeShellNavigation', () => {
  it('keeps demo-only built-in pages out of the primary menu while preserving product pages', () => {
    const productMenuEntries = [
      {
        id: 'sample-product.trades',
        productId: 'sample-product',
        productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
        title: { 'zh-CN': '交易复盘', 'en-US': 'Trade Replay' },
        icon: 'chart-candlestick',
        order: 20,
        routePath: '/sample-product/trades',
        load: async () => ({})
      }
    ] as const satisfies readonly GeneratedProductMenuEntry[]

    const items = mergeShellNavItems('zh-CN', productMenuEntries)

    expect(items.map((item) => item.key)).toEqual(['assistants', 'agents', 'settings', '/sample-product/trades'])
    expect(items.map((item) => item.label)).toEqual(['助手', '智能体', '设置', '交易复盘'])
  })

  it('separates settings into the bottom sidebar menu', () => {
    const items = mergeShellNavItems('en-US', [
      {
        id: 'sample-product.trades',
        productId: 'sample-product',
        productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
        title: { 'zh-CN': '交易复盘', 'en-US': 'Trade Replay' },
        icon: 'chart-candlestick',
        order: 20,
        routePath: '/sample-product/trades',
        load: async () => ({})
      }
    ] as const satisfies readonly GeneratedProductMenuEntry[])

    const layout = splitShellSidebarNavItems(items)

    expect(layout.primaryItems.map((item) => item.key)).toEqual(['assistants', 'agents', '/sample-product/trades'])
    expect(layout.bottomItems.map((item) => item.key)).toEqual(['settings'])
  })

  it('groups product settings panels under their product name', () => {
    const productSettingsEntries = [
      {
        id: 'sample-product.risk-profile',
        productId: 'sample-product',
        productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
        title: { 'zh-CN': '风险偏好', 'en-US': 'Risk Profile' },
        icon: 'shield',
        order: 100,
        load: async () => ({})
      },
      {
        id: 'other-product.preferences',
        productId: 'other-product',
        productName: { 'zh-CN': '其他产品', 'en-US': 'Other Product' },
        title: { 'zh-CN': '偏好', 'en-US': 'Preferences' },
        icon: 'settings',
        order: 10,
        load: async () => ({})
      }
    ] as const satisfies readonly GeneratedProductSettingsEntry[]

    const groups = groupShellSettingsPanels('en-US', productSettingsEntries)

    expect(groups[0]).toMatchObject({ kind: 'platform', title: null })
    expect(groups.slice(1).map((group) => group.title)).toEqual(['Other Product', 'Sample Product'])
    expect(groups.find((group) => group.id === 'sample-product')?.panels[0]?.label).toBe('Risk Profile')

    const chineseGroups = groupShellSettingsPanels('zh-CN', productSettingsEntries)
    expect(chineseGroups.find((group) => group.id === 'sample-product')?.title).toBe('示例产品')
    expect(chineseGroups.find((group) => group.id === 'sample-product')?.panels[0]?.label).toBe('风险偏好')
  })

  it('keeps assistant library as a built-in platform settings panel', () => {
    const panels = createBuiltInSettingsPanels('zh-CN')

    expect(panels.map((panel) => panel.id)).toContain('assistant-library')
    expect(panels.find((panel) => panel.id === 'assistant-library')?.label).toBe('助手库')
  })

  it('keeps web search as a built-in platform settings panel', () => {
    const panels = createBuiltInSettingsPanels('en-US')

    expect(panels.map((panel) => panel.id)).toContain('web-search')
    expect(panels.find((panel) => panel.id === 'web-search')?.label).toBe('Web Search')
  })

  it('keeps storage and cache as a built-in platform settings panel', () => {
    const panels = createBuiltInSettingsPanels('zh-CN')

    expect(panels.map((panel) => panel.id)).toContain('storage-cache')
    expect(panels.find((panel) => panel.id === 'storage-cache')?.label).toBe('存储与缓存')
  })

  it('keeps task automation as a built-in platform settings panel', () => {
    const panels = createBuiltInSettingsPanels('en-US')

    expect(panels.find((panel) => panel.id === 'task-automation')?.label).toBe('Task Automation')
  })

  // P2-01：可见一级菜单必须同时携带 workspace 页身份与可分离能力，供统一注册（内置三项 + 全部产品菜单）使用。
  it('carries the workspace page identity and detach capability of every top-level menu item', () => {
    const items = mergeShellNavItems('zh-CN', [
      {
        id: 'sample-product.trades', productId: 'sample-product', productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
        title: { 'zh-CN': '交易复盘', 'en-US': 'Trade Replay' }, icon: 'scroll-text', order: 20,
        routePath: '/sample-product/trades', load: async () => ({})
      }
    ] as const satisfies readonly GeneratedProductMenuEntry[])

    expect(items.map((item) => item.pageId)).toEqual(['assistants', 'agents', 'settings', 'sample-product.trades'])
    expect(items.map((item) => item.menuKey)).toEqual(['assistants', 'agents', 'settings', '/sample-product/trades'])
    expect(items.every((item) => item.supportsDetached)).toBe(true)
    expect(items.every((item) => item.allowMultipleInstances === false)).toBe(true)
  })

  // P2-01：缺扩展字段的既有产品菜单产物必须默认「可分离 + 单实例」，既不隐藏也不报错。
  it('keeps platform defaults for legacy menu entries without the workspace extension', () => {
    const items = mergeShellNavItems('zh-CN', [
      {
        id: 'sample-product.trades', productId: 'sample-product', productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
        title: { 'zh-CN': '交易复盘', 'en-US': 'Trade Replay' }, icon: 'scroll-text', order: 20,
        routePath: '/sample-product/trades', load: async () => ({})
      },
      {
        id: 'sample-product.portfolio', productId: 'sample-product', productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
        title: { 'zh-CN': '持仓', 'en-US': 'Portfolio' }, icon: 'activity', order: 10,
        routePath: '/sample-product/portfolio', workspace: { supportsDetached: true, allowMultipleInstances: true },
        load: async () => ({})
      }
    ] as const satisfies readonly GeneratedProductMenuEntry[])

    const legacy = items.find((item) => item.key === '/sample-product/trades')
    const extended = items.find((item) => item.key === '/sample-product/portfolio')
    expect(legacy).toMatchObject({ supportsDetached: true, allowMultipleInstances: false })
    expect(extended).toMatchObject({ supportsDetached: true, allowMultipleInstances: true })
    expect(mergeShellNavItems('zh-CN', []).map((item) => item.menuKey)).toEqual(['assistants', 'agents', 'settings'])
  })

  it('never promotes settings sub-panels to top-level menu items', () => {
    const items = mergeShellNavItems('zh-CN', [])
    const topLevelKeys = new Set(items.map((item) => item.key))
    const settingsPanelIds = createBuiltInSettingsPanels('zh-CN').map((panel) => panel.id)

    expect(settingsPanelIds.filter((id) => topLevelKeys.has(id))).toEqual([])
    expect(items.filter((item) => item.key === 'settings')).toHaveLength(1)
    // 二级面板仍只出现在 Settings 分组里，能力并未丢失
    expect(groupShellSettingsPanels('zh-CN', [])[0]?.panels.map((panel) => panel.key)).toEqual(settingsPanelIds)
  })

  // 侧栏是纯图标导航（`.nav-item span` 不可见），一级菜单共用图标即无法辨认；
  // 用真实生成产物覆盖「内置页 + 产品页」的合并结果，新增页面撞图标会在 CI 直接失败。
  it('gives every top-level menu its own icon in the real shell navigation', () => {
    const items = mergeShellNavItems('zh-CN', productMenuEntries)
    const ownerByIcon = new Map<ShellNavItem['icon'], string>()
    const collisions: string[] = []

    for (const item of items) {
      const owner = ownerByIcon.get(item.icon)
      if (owner !== undefined) collisions.push(`${owner} 与 ${item.label}`)
      else ownerByIcon.set(item.icon, item.label)
    }

    expect(collisions).toEqual([])
  })
})
