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
      ])
    ).toEqual([
      {
        id: 'sample-product',
        name: 'Sample Product',
        count: 2
      }
    ])
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
