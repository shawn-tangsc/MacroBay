import { describe, expect, it } from 'vitest'

import { AssistantTemplateRegistry } from './AssistantTemplateRegistry'
import type { AssistantTemplateRegistration } from './assistantTemplateSchemas'

describe('AssistantTemplateRegistry', () => {
  it('normalizes platform template ids', () => {
    const registry = new AssistantTemplateRegistry()

    registry.register(template({ templateId: 'default-assistant', sourceKind: 'platform' }))

    expect(registry.get('platform:default-assistant')?.templateId).toBe('platform:default-assistant')
  })

  it('normalizes product template ids with product id prefix', () => {
    const registry = new AssistantTemplateRegistry()

    registry.register(
      template({
        templateId: 'review-helper',
        sourceKind: 'product',
        sourceProductId: 'example-product'
      })
    )

    expect(registry.get('product:example-product:review-helper')?.templateId).toBe(
      'product:example-product:review-helper'
    )
  })

  it('rejects duplicate global template ids', () => {
    const registry = new AssistantTemplateRegistry()
    registry.register(template({ templateId: 'platform:default-assistant', sourceKind: 'platform' }))

    expect(() =>
      registry.register(template({ templateId: 'default-assistant', sourceKind: 'platform' }))
    ).toThrow(/Duplicate assistant template/)
  })

  it('clears registered templates', () => {
    const registry = new AssistantTemplateRegistry()
    registry.register(template({ templateId: 'default-assistant', sourceKind: 'platform' }))

    registry.clear()

    expect(registry.list()).toEqual([])
  })
})

function template(input: Pick<AssistantTemplateRegistration, 'templateId' | 'sourceKind'> & Partial<AssistantTemplateRegistration>): AssistantTemplateRegistration {
  return {
    version: 1,
    name: { 'zh-CN': '默认助手', 'en-US': 'Default Assistant' },
    prompt: { 'zh-CN': '帮助用户。', 'en-US': 'Help the user.' },
    groups: ['general'],
    ...input
  }
}
