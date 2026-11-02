import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ProductManifest } from '../product-manifest'
import { buildGeneratedProductRegistry } from './generate'
import { ProductRegistryValidationError, validateDiscoveredProductManifest } from './validate'

const productDir = resolve(process.cwd(), 'products/market-intelligence')

/**
 * 通知事件声明的生成期校验（契约 §3）。这些形状错误在运行期只表现为「读者收不到」或
 * 「两条永远合不上」——静默、难查，所以必须在生成期就红。
 */
function manifestWith(notificationEvents: unknown): ProductManifest {
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
    notificationEvents,
    migrations: []
  } as unknown as ProductManifest
}

function validate(manifest: ProductManifest): void {
  validateDiscoveredProductManifest('market-intelligence', productDir, manifest, new Set(), new Set(), new Set())
}

function event(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'market-intelligence.briefing.ready',
    titleKey: 'notification.event.market-intelligence.briefing.ready.title',
    reasonKey: 'notification.event.market-intelligence.briefing.ready.reason',
    requiresUserAction: false,
    requestedDisruptionLevels: ['desktop', 'channel'],
    dedupeKeyTemplate: 'brief-done:{date}:{period}',
    dedupeUnit: 'occurrence',
    notifyOnlyIfSubscribed: true,
    ...overrides
  }
}

describe('notification event declarations', () => {
  it('accepts a well-formed declaration and a product that declares none', () => {
    expect(() => validate(manifestWith([event()]))).not.toThrow()
    expect(() => validate(manifestWith(undefined))).not.toThrow()
    expect(() => validate(manifestWith([]))).not.toThrow()
  })

  it.each([
    ['an id outside the product prefix', { id: 'platform.job.failed-terminal' }],
    ['a missing title key', { titleKey: '  ' }],
    ['a missing reason key', { reasonKey: undefined }],
    ['a center request (center is never requestable)', { requestedDisruptionLevels: ['center'] }],
    ['an unknown requested level', { requestedDisruptionLevels: ['sms'] }],
    ['a repeated requested level', { requestedDisruptionLevels: ['desktop', 'desktop'] }],
    ['both a template and a builder', { dedupeKeyBuilder: 'sourceIssue' }],
    ['neither a template nor a builder', { dedupeKeyTemplate: undefined }],
    ['a constant template (would merge every occurrence)', { dedupeKeyTemplate: 'brief-done' }],
    ['an unregistered builder', { dedupeKeyTemplate: undefined, dedupeKeyBuilder: 'handWritten' }],
    ['an unknown dedupe unit', { dedupeUnit: 'window' }],
    ['condition without a window', { dedupeUnit: 'condition' }],
    ['occurrence with a window', { dedupeUnit: 'occurrence', conditionWindowMs: 3_600_000 }],
    ['a non-boolean notifyOnlyIfSubscribed', { notifyOnlyIfSubscribed: 'yes' }]
  ])('rejects %s', (_label, overrides) => {
    expect(() => validate(manifestWith([event(overrides)]))).toThrow(ProductRegistryValidationError)
  })

  it('accepts an empty requested level list: approval center-only is a legal ceiling', () => {
    // N8 / N9 的批准表只有 center，声明就申请空数组——空数组是「本机不打搅」，不是缺字段。
    expect(() => validate(manifestWith([event({ requestedDisruptionLevels: [] })]))).not.toThrow()
  })

  it('rejects hand-written title and reason keys, printing expected and actual', () => {
    expect(() => validate(manifestWith([event({ titleKey: 'notifications.briefing.ready.title' })])))
      .toThrow(/titleKey must be "notification\.event\.market-intelligence\.briefing\.ready\.title".*got "notifications\.briefing\.ready\.title"/)
    expect(() => validate(manifestWith([event({ reasonKey: 'notifications.briefing.ready.reason' })])))
      .toThrow(/reasonKey must be "notification\.event\.market-intelligence\.briefing\.ready\.reason"/)
  })

  it('rejects a body key or a variant key outside the generated prefix', () => {
    expect(() => validate(manifestWith([event({ bodyKey: 'notifications.briefing.ready.body' })])))
      .toThrow(/bodyKey must be "notification\.event\.market-intelligence\.briefing\.ready\.body"/)
    expect(() => validate(manifestWith([event({
      bodyKeyByVariant: { failed: 'notifications.briefing.failed.body' }
    })]))).toThrow(/bodyKeyByVariant\.failed must be "notification\.event\.market-intelligence\.briefing\.ready\.body\.failed"/)
  })

  it('accepts generated body and variant keys', () => {
    expect(() => validate(manifestWith([event({
      bodyKey: 'notification.event.market-intelligence.briefing.ready.body',
      bodyKeyByVariant: {
        failed: 'notification.event.market-intelligence.briefing.ready.body.failed',
        'data-only': 'notification.event.market-intelligence.briefing.ready.body.data-only'
      }
    })]))).not.toThrow()
  })

  it('rejects a duplicate id inside one product and a non-array declaration', () => {
    expect(() => validate(manifestWith([event(), event()]))).toThrow(/duplicate notification event/)
    expect(() => validate(manifestWith('market-intelligence.briefing.ready'))).toThrow(/must be an array/)
  })
})
