import { describe, expect, it } from 'vitest'

import { resolveNotificationNavigation } from './notificationDeeplink'

/**
 * 导航规则的判据是「同一份 deeplink 永远落到同一屏」。
 * 这几条钉的是优先级，不是实现：改优先级时先改这里，别让读者被送到别处。
 */
describe('resolveNotificationNavigation', () => {
  const products = [{ productId: 'market-intelligence', routePath: '/market-intelligence' }]

  it('sends a settings deeplink to that section, even when a product id is also present', () => {
    expect(
      resolveNotificationNavigation({ settingsSectionId: 'intelligence-sources', productId: 'market-intelligence' }, products)
    ).toEqual({ navKey: 'settings', settingsPanelKey: 'intelligence-sources' })
  })

  it('lands a failed task on its own panel and points at the row', () => {
    // 只落面板不定位，读者还得自己在一张表里找那颗任务。
    expect(resolveNotificationNavigation({ entityType: 'job-definition', entityId: 'task-42' }, products)).toEqual({
      navKey: 'settings',
      settingsPanelKey: 'task-automation',
      focusEntityId: 'task-42'
    })
  })

  it('sends an open-briefing action to the product page that actually exists', () => {
    // 日报是 intelligence 页里的子视图，没有独立的 workspace pageId。
    expect(resolveNotificationNavigation({ pageId: 'daily-briefing' }, products)).toEqual({ navKey: 'intelligence' })
  })

  it('refuses an entity type it does not know, instead of guessing a panel', () => {
    expect(resolveNotificationNavigation({ entityType: 'mystery', entityId: 'x' }, products)).toBeNull()
  })

  it('ignores page ids and product ids until something produces them', () => {
    // 这两支今天没有生产者：留着会把读者送去一个走不通的地方，验收当假指路退回。
    expect(resolveNotificationNavigation({ pageId: 'assistants' }, products)).toBeNull()
    expect(resolveNotificationNavigation({ productId: 'market-intelligence' }, products)).toBeNull()
  })

  it('returns null when the target does not exist, instead of guessing a page', () => {
    expect(resolveNotificationNavigation({}, products)).toBeNull()
    expect(resolveNotificationNavigation({ settingsSectionId: undefined }, products)).toBeNull()
  })
})
