import { describe, expect, it } from 'vitest'

import type { ProductManifest } from '../../../product-manifest'
import { createAssistantTemplateRegistrationsFromManifests } from './assistantTemplateManifestAdapter'

describe('assistantTemplateManifestAdapter', () => {
  it('converts product assistant templates into normalized product source registrations', () => {
    const registrations = createAssistantTemplateRegistrationsFromManifests([
      productManifest({
        assistantTemplates: [
          {
            id: 'domain-helper',
            name: { 'zh-CN': '领域助手', 'en-US': 'Domain Helper' },
            prompt: { 'zh-CN': '帮助处理领域问题。', 'en-US': 'Help with domain questions.' },
            groups: ['business'],
            version: 1
          }
        ]
      })
    ])

    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({
      templateId: 'domain-helper',
      sourceKind: 'product',
      sourceProductId: 'example-product',
      sourceProductName: { 'zh-CN': '示例产品', 'en-US': 'Example Product' },
      installPolicy: 'library-only'
    })
  })

  it('ignores manifests without assistant templates', () => {
    expect(createAssistantTemplateRegistrationsFromManifests([productManifest()])).toEqual([])
  })
})

function productManifest(overrides: Partial<ProductManifest> = {}): ProductManifest {
  return {
    id: 'example-product',
    name: { 'zh-CN': '示例产品', 'en-US': 'Example Product' },
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
    migrations: [],
    ...overrides
  }
}
