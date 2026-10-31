import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ProductManifest } from '../product-manifest'
import { ProductRegistryValidationError, validateDiscoveredProductManifest } from './validate'

const productDir = resolve(process.cwd(), 'products/market-intelligence')

/**
 * 任务订阅只允许选 manifest 声明过的话题（`MI-11-R22` A1），所以形状错误必须在生成期报出来。
 * 这条用例固定的是「生成期就红」，不是运行期兜底。
 */
function manifestWith(eventTopics: unknown): ProductManifest {
  return {
    id: 'market-intelligence',
    name: { 'zh-CN': '行情情报', 'en-US': 'Market Intelligence' },
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
    eventTopics,
    migrations: []
  } as unknown as ProductManifest
}

function validate(manifest: ProductManifest): void {
  validateDiscoveredProductManifest('market-intelligence', productDir, manifest, new Set(), new Set(), new Set())
}

describe('publishable event topic declarations', () => {
  it('accepts the dotted lowercase topics the product really publishes', () => {
    expect(() => validate(manifestWith([
      'market-intelligence.item.created',
      'market-intelligence.source.health.changed'
    ]))).not.toThrow()
  })

  it('accepts a manifest that publishes nothing', () => {
    expect(() => validate(manifestWith(undefined))).not.toThrow()
    expect(() => validate(manifestWith([]))).not.toThrow()
  })

  it.each([
    ['a blank entry', ['market-intelligence.item.created', '  ']],
    ['an uppercase topic', ['Market-Intelligence.item.created']],
    ['a topic with an inner space', ['market intelligence.item.created']],
    ['an untrimmed topic', [' market-intelligence.item.created']],
    ['a non-string entry', [42]]
  ])('rejects %s', (_label, topics) => {
    expect(() => validate(manifestWith(topics))).toThrow(ProductRegistryValidationError)
  })

  it('rejects a duplicate declaration inside one product', () => {
    expect(() => validate(manifestWith([
      'market-intelligence.item.created',
      'market-intelligence.item.created'
    ]))).toThrow(ProductRegistryValidationError)
  })

  it('rejects a non-array declaration', () => {
    expect(() => validate(manifestWith('market-intelligence.item.created'))).toThrow(ProductRegistryValidationError)
  })
})
