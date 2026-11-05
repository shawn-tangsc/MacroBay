import { describe, expect, it } from 'vitest'
import type { AssistantTemplateCatalogItem } from '@platform/ai/assistant-platform/library/assistantTemplateSchemas'
import { assistantLibraryGroups } from './assistantLibraryGroups'
import { buildProductGroups, defaultAssistantLibraryGroup } from './useAssistantLibrary'

describe('buildProductGroups', () => {
  it('creates product source categories for product-contributed assistant templates', () => {
    expect(
      buildProductGroups([
        catalogItem({ templateId: 'platform:default-assistant', sourceKind: 'platform' }),
        catalogItem({
          templateId: 'product:sample-product:review-helper',
          sourceKind: 'product',
          sourceProductId: 'sample-product',
          sourceProductName: 'Sample Product'
        }),
        catalogItem({
          templateId: 'product:sample-product:risk-helper',
          sourceKind: 'product',
          sourceProductId: 'sample-product',
          sourceProductName: 'Sample Product'
        })
      ], '这个产品')
    ).toEqual([
      {
        id: 'sample-product',
        name: 'Sample Product',
        count: 2
      }
    ])
  })
})

describe('assistant library product group fallback', () => {
  it('产品摘要里没有名字时用兜底说法，绝不把 productId 印上屏（契约 v2.41 第三档）', () => {
    const groups = buildProductGroups([
      catalogItem({
        templateId: 'product:market-intelligence:review-helper',
        sourceKind: 'product',
        sourceProductId: 'market-intelligence',
        sourceProductName: ''
      })
    ], '这个产品')

    expect(groups).toEqual([{ id: 'market-intelligence', name: '这个产品', count: 1 }])
    // 分组标题曾经直接印 sourceProductId：英文读者会看到 `market-intelligence`，以为是界面坏了。
    expect(groups[0]?.name).not.toContain('market-intelligence')
  })
})

describe('assistant library category rail', () => {
  it('shows only the generic platform category before product source categories', () => {
    expect(defaultAssistantLibraryGroup).toBe('general')
    expect(assistantLibraryGroups.map((group) => group.id)).toEqual(['general'])
  })
})

function catalogItem(input: Partial<AssistantTemplateCatalogItem>): AssistantTemplateCatalogItem {
  return {
    templateId: 'platform:default-assistant',
    sourceKind: 'platform',
    version: 1,
    name: 'Default Assistant',
    description: 'Default',
    icon: '💬',
    promptPreview: 'Help the user.',
    groups: ['general'],
    tags: [],
    installed: false,
    installPolicy: 'library-only',
    ...input
  }
}
