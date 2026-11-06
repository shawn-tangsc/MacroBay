/**
 * 注意：本文件**静态** import 了构建期生成物 `@products/generated/shellRegistry`（入不了库，只存在于工作区
 * 与构建树）。所以提交前预检在它自己落出来的那棵树里**先跑一次生成器**再查类型——见
 * `scripts/pre-commit.mts`「生成物必须在这棵树里先生成一遍」。别为了绕开假红把它改成动态 import：
 * 那条路会把这个文件的断言从「编译期就检查类型」降成「运行期才知道」，等于拿检查换方便。
 */
import { describe, expect, it } from 'vitest'

import type { GeneratedProductMenuEntry, GeneratedProductSettingsEntry } from '@platform/product-registry/types'
import { productMenuEntries } from '@products/generated/shellRegistry'

import { createBuiltInSettingsPanels } from './builtInNavEntries'
import {
  groupShellSettingsPanels,
  mergeShellNavItems,
  orderShellNavItems,
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

    // 平台设置按原型分四组：组标题与产品分组同级，顺序固定。
    expect(groups.slice(0, 4).map((group) => group.title)).toEqual([
      'Models and assistants',
      'System and data',
      'Notifications and channels',
      'Other'
    ])
    expect(groups.every((group) => group.kind === 'platform' || group.kind === 'product')).toBe(true)
    expect(groups.slice(4).map((group) => group.title)).toEqual(['Other Product', 'Sample Product'])
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
    // 二级面板仍只出现在 Settings 分组里，能力并未丢失（分组后要跨组展开再比）
    // 分组后顺序变了（按组展示），但每个二级面板都还在、一个不少、没有多出来的。
    const groupedKeys = groupShellSettingsPanels('zh-CN', []).flatMap((group) => group.panels.map((panel) => panel.key))
    expect([...groupedKeys].sort()).toEqual([...settingsPanelIds].sort())
    // 原型的分组归属：通知与频道同组，偏好与关于同组。
    const byId = new Map(groupShellSettingsPanels('zh-CN', []).map((group) => [group.id, group.panels.map((panel) => panel.key)]))
    expect(byId.get('platform-notify')).toEqual(['notifications', 'channels'])
    expect(byId.get('platform-other')).toEqual(['preferences', 'about'])
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

/**
 * 用户 2026-11-06：「默认首页放到菜单第一个」。按**规则**做（谁声明首页谁排第一），不靠调 `order`：
 * 首页是可配置的，靠改排序号换一次首页就要再改一次号，还会打乱别人相对次序的意图。
 *
 * 判据要点：**必须有一条「没有 home 时顺序回到纯 order」的用例**，否则一个「总把某个产品页提到最前面」
 * 的实现也能过。所以下面那条反向用例里，声明 home 的那项**故意不是 order 最小的**。
 */
describe('默认首页排在菜单第一位（规则，不是调 order）', () => {
  function product(order: number, options: { home?: true; localId?: string } = {}) {
    const localId = options.localId ?? `page-${order}`
    return {
      id: `sample-product.${localId}`,
      productId: 'sample-product',
      productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
      title: { 'zh-CN': `页 ${order}`, 'en-US': `Page ${order}` },
      icon: 'chart-candlestick',
      order,
      routePath: `/sample-product/${localId}`,
      ...(options.home === true ? { home: true as const } : {}),
      load: async () => ({})
    }
  }

  it('声明 home 的产品页排最前（先于内置页），其余仍按 order、相对次序不变', () => {
    const items = mergeShellNavItems('en-US', [
      product(10, { home: true, localId: 'intelligence' }),
      product(20, { localId: 'second' })
    ])

    expect(items.map((item) => item.key)).toEqual([
      '/sample-product/intelligence',
      'assistants', 'agents', 'settings',
      '/sample-product/second'
    ])
  })

  it('反向：把 home 拿掉 ⇒ 顺序回到纯 order（一个「总把某个产品页提前」的实现会在这条上红）', () => {
    const items = mergeShellNavItems('en-US', [
      // 声明 home 的这项**不是** order 最小的：只靠 order 它会排在第二，靠 home 才排第一。
      product(20, { home: true, localId: 'intelligence' }),
      product(10, { localId: 'first' })
    ])

    expect(items.map((item) => item.key)).toEqual([
      '/sample-product/intelligence',
      'assistants', 'agents', 'settings',
      '/sample-product/first'
    ])

    const withoutHome = mergeShellNavItems('en-US', [
      product(20, { localId: 'intelligence' }),
      product(10, { localId: 'first' })
    ])

    // 零个 home：内置页在前，产品页仍按 order —— 与今天的形状逐字一致。
    expect(withoutHome.map((item) => item.key)).toEqual([
      'assistants', 'agents', 'settings',
      '/sample-product/first',
      '/sample-product/intelligence'
    ])
  })

  it('内置页声明 home 也一样排最前（kind 不参与判断）', () => {
    const base = mergeShellNavItems('en-US', [product(10, { localId: 'only' })])
    const withBuiltInHome = base.map((item) => (item.key === 'agents' ? { ...item, home: true as const } : item))

    expect(orderShellNavItems(withBuiltInHome).map((item) => item.key)).toEqual([
      'agents', 'assistants', 'settings', '/sample-product/only'
    ])
  })

  it('零个 home 时 orderShellNavItems 原样返回（不重排、不把第一项提前）', () => {
    const items = mergeShellNavItems('en-US', [product(10, { localId: 'a' }), product(20, { localId: 'b' })])

    expect(orderShellNavItems(items).map((item) => item.key)).toEqual(items.map((item) => item.key))
  })
})

describe('菜单排序的稳定性（契约 §4c 硬约束：同 order 保持注册顺序）', () => {
  function entry(order: number, localId: string, home?: true) {
    return {
      id: `sample-product.${localId}`,
      productId: 'sample-product',
      productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
      title: { 'zh-CN': localId, 'en-US': localId },
      icon: 'chart-candlestick',
      order,
      routePath: `/sample-product/${localId}`,
      ...(home === true ? { home: true as const } : {}),
      load: async () => ({})
    }
  }

  it('两个同 order 的项保持注册顺序，且反复调用结果完全一致（不稳定排序在这里会换位）', () => {
    const entries = [entry(10, 'alpha'), entry(10, 'beta')] as const
    const first = mergeShellNavItems('en-US', entries).map((item) => item.key)

    expect(first).toEqual(['assistants', 'agents', 'settings', '/sample-product/alpha', '/sample-product/beta'])
    // 同一个输入跑多次：结果逐字相同（偶发换位是最难查的一类缺陷，趁现在钉住）。
    for (let run = 0; run < 25; run += 1) {
      expect(mergeShellNavItems('en-US', entries).map((item) => item.key)).toEqual(first)
    }
  })

  it('提升首页时同 order 的其余项仍保持注册顺序', () => {
    const entries = [entry(10, 'alpha'), entry(10, 'beta'), entry(20, 'gamma', true)] as const
    const keys = mergeShellNavItems('en-US', entries).map((item) => item.key)

    expect(keys).toEqual([
      '/sample-product/gamma',
      'assistants', 'agents', 'settings',
      '/sample-product/alpha', '/sample-product/beta'
    ])
  })
})
