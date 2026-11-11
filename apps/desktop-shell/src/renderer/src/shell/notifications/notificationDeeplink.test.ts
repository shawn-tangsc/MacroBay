import { describe, expect, it } from 'vitest'

import { toWorkspacePageMenuKey } from '@platform/workspace/registry/workspacePageRegistry'
import { productMenuEntries } from '@products/generated/shellRegistry'

import { resolveNotificationNavigation } from './notificationDeeplink'

/**
 * 导航规则的判据是「同一份 deeplink 永远落到同一屏」。
 * 这几条钉的是优先级，不是实现：改优先级时先改这里，别让读者被送到别处。
 */
describe('resolveNotificationNavigation', () => {
  const products = [{ productId: 'market-intelligence', routePath: '/market-intelligence/intelligence' }]

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

  it('gives a failed analysis no target until the product supplies one', () => {
    // 平台不在壳里写产品面板 id（撤注册之后那就是「点了落到别处」）。产品把目的地写进通知数据
    // 之前，这条通知只有记录、没有跳转——功能关闭，不是先落到一个错的面板。
    expect(resolveNotificationNavigation({ entityType: 'analysis-run', entityId: 'mi-ar-1' }, products)).toBeNull()
  })

  it('lets a registered entity beat a stale section name', () => {
    // 旧生产者仍写着 intelligence-sources（运行日志已独立成面板）：实体 id 能真的定位到那一条，
    // 分区只会把读者送到错的屏。没登记的实体（如 source）不受这条影响。
    // 分析运行不是平台登记的实体 ⇒ 退回载荷里的分区名（产品给什么就用什么），不猜面板。
    expect(
      resolveNotificationNavigation(
        {
          settingsSectionId: 'intelligence-sources',
          productId: 'market-intelligence',
          entityType: 'analysis-run',
          entityId: 'mi-ar-1'
        },
        products
      )
    ).toEqual({ navKey: 'settings', settingsPanelKey: 'intelligence-sources' })

    expect(
      resolveNotificationNavigation(
        {
          settingsSectionId: 'intelligence-sources',
          productId: 'market-intelligence',
          entityType: 'source',
          entityId: 'coindesk-rss'
        },
        products
      )
    ).toEqual({ navKey: 'settings', settingsPanelKey: 'intelligence-sources' })
  })

  it('carries a product settings-drawer destination through, and refuses an unregistered product', () => {
    // 产品给的落点：平台只按注册表找那条唯一产品页，然后原样带着 `{ productId, menuId }` 往前送。
    expect(
      resolveNotificationNavigation(
        { productId: 'market-intelligence', settingsDrawer: { productId: 'market-intelligence', menuId: 'sources' } },
        products
      )
    ).toEqual({
      navKey: '/market-intelligence/intelligence',
      settingsDrawer: { productId: 'market-intelligence', menuId: 'sources', routePath: '/market-intelligence/intelligence' }
    })

    // 产品没在这一版注册（没有唯一产品页）→ 不导航，也不回落到任何面板。
    expect(
      resolveNotificationNavigation(
        { settingsDrawer: { productId: 'retired-product', menuId: 'sources' } },
        products
      )
    ).toBeNull()
  })

  it('sends an open-briefing action to the route path the registry actually publishes', () => {
    // 产品页的 navKey 是注册表的 routePath，不是 manifest 里的 pageId。
    expect(
      resolveNotificationNavigation({ pageId: 'daily-briefing', productId: 'market-intelligence' }, products)
    ).toEqual({ navKey: '/market-intelligence/intelligence' })
  })

  it('refuses to guess when one product has several top-level pages', () => {
    const two = [...products, { productId: 'market-intelligence', routePath: '/market-intelligence/calendar' }]
    // 点哪一个都是猜，猜错比不跳更糟。
    expect(resolveNotificationNavigation({ pageId: 'daily-briefing', productId: 'market-intelligence' }, two)).toBeNull()
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

/**
 * 判据不是「解析器和自己一致」，而是「解析出来的 key 是注册表真发布的那个」。
 *
 * 上面那份 `products` 是手写 fixture：它只能证明函数没违背自己的假设。上一版正是这样绿的——
 * fixture 里写着 `'intelligence'`，注册表里没有这个 menuKey，于是 `openTab` 拒、高亮变、
 * 页面不开。所以这一组读**真的生成产物**，并把 routePath 与主进程的 menuKey 规则逐字对一遍。
 */
describe('the resolved page key exists in the registry main actually serves', () => {
  const briefing = { pageId: 'daily-briefing', productId: 'market-intelligence' } as const

  it('lands on the route path the generator publishes, not on a hand-written key', () => {
    const entries = productMenuEntries.filter((entry) => entry.productId === briefing.productId)
    expect(entries).toHaveLength(1)
    expect(resolveNotificationNavigation(briefing, productMenuEntries)).toEqual({ navKey: entries[0]!.routePath })
  })

  it('agrees with the main-process menu-key rule for every generated product page', () => {
    // 主进程按 `/productId/localPageId` 生成 menuKey（`toWorkspacePageMenuKey`），生成器给的
    // routePath 必须逐字相同；不同就意味着 `openTab` 会拿到一个没注册的 key。
    for (const entry of productMenuEntries) {
      const localPageId = entry.id.slice(entry.productId.length + 1)
      expect(toWorkspacePageMenuKey(entry.productId, localPageId)).toBe(entry.routePath)
    }
  })
})
