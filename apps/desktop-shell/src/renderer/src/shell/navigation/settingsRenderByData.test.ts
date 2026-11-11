import { describe, expect, it } from 'vitest'

import type { GeneratedProductSettingsEntry } from '@platform/product-registry/types'

import { groupShellSettingsPanels } from './mergeShellNavigation'

/**
 * 设置页只按**产品注册的数据**渲染：分组标题取 `productName`、入口名取 `title`、图标取 `icon`、
 * 次序取 `order`。平台不写产品 id、不写产品文案、不 import 产品代码。
 *
 * 两份夹具就够证明这件事：
 * - 空注册表 → 一个产品分组都不许冒出来；
 * - 塞一条伪造条目 → 恰好一项，且每一处显示都来自那条数据。
 *
 * 反向：在内置面板列表里写死一个产品入口，空注册表也会出现它 → 第一份夹具当场红。
 */
const forged: GeneratedProductSettingsEntry = {
  id: 'sample-product.source-settings',
  productId: 'sample-product',
  productName: { 'zh-CN': '示例产品', 'en-US': 'Sample Product' },
  title: { 'zh-CN': '来源设置', 'en-US': 'Source settings' },
  icon: 'database',
  order: 42,
  load: async () => ({})
}

function productGroups(language: 'zh-CN' | 'en-US', entries: readonly GeneratedProductSettingsEntry[]) {
  return groupShellSettingsPanels(language, entries).filter((group) => group.kind === 'product')
}

describe('the settings page renders only what products registered', () => {
  it('shows no product group at all when nothing is registered', () => {
    expect(productGroups('zh-CN', [])).toEqual([])
    expect(productGroups('en-US', [])).toEqual([])
  })

  it('shows exactly one item, and every visible field comes from that one registration', () => {
    const [group, ...rest] = productGroups('zh-CN', [forged])

    expect(rest).toEqual([])
    expect(group?.title).toBe('示例产品')
    expect(group?.panels).toHaveLength(1)
    expect(group?.panels[0]).toMatchObject({
      key: 'sample-product.source-settings',
      label: '来源设置',
      productId: 'sample-product'
    })

    // 语言跟着读：同一份数据换语言，标题与入口名一起变，平台没有第二份文案。
    const [english] = productGroups('en-US', [forged])
    expect(english?.title).toBe('Sample Product')
    expect(english?.panels[0]?.label).toBe('Source settings')
  })
})
