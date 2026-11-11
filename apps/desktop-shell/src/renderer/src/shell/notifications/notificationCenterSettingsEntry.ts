import type { GeneratedProductMenuEntry, GeneratedProductSettingsDrawerEntry } from '@platform/product-registry/types'
import { APP_NAVIGATE_EVENT } from '@platform/workspace/navigation/navigationRequest'

import { productMenuEntries, productSettingsDrawers } from '@products/generated/shellRegistry'

/**
 * 通知中心那颗「去设置」的**唯一判据**：产品在自己的 manifest 里声明了设置抽屉、并且有人能真打开它。
 *
 * 规则：
 * - 没有任何产品声明 `notifications` 这一屏 → `null`（**不渲染**，不是渲染一个点了没反应的按钮）；
 * - 多个产品同时声明 → `null`（猜哪个都是猜，猜错比不跳更糟）；
 * - 声明了但产品没有唯一的一级菜单页可落 → `null`（按钮点了也到不了那个产品页）。
 *
 * 平台只知道注册表里的数据（`productId / menus / routePath`），不写产品 id、不写产品文案。
 */
export type NotificationCenterSettingsEntry = Readonly<{
  productId: string
  menuId: string
  routePath: string
}>

export function resolveNotificationCenterSettingsEntry(
  drawers: readonly GeneratedProductSettingsDrawerEntry[] = productSettingsDrawers,
  menuEntries: readonly GeneratedProductMenuEntry[] = productMenuEntries,
  menuId = 'notifications'
): NotificationCenterSettingsEntry | null {
  const declaring = drawers.filter((drawer) => drawer.menus.includes(menuId))
  if (declaring.length !== 1) return null
  const owner = declaring[0]!
  const routes = menuEntries.filter((entry) => entry.productId === owner.productId)
  if (routes.length !== 1) return null
  return { productId: owner.productId, menuId, routePath: routes[0]!.routePath }
}

/**
 * 发导航：走既有 `app-shell:navigate`，detail 里带 `settingsDrawer`（产品页按自己的 productId 过滤）。
 * 先切到该产品页，否则监听者根本没挂载——按钮点了也不会有人接。
 */
export function openProductSettingsDrawer(entry: NotificationCenterSettingsEntry): void {
  // 先切到产品页，否则监听者根本没挂载；`settingsDrawer` 由产品页按自己的 productId 消费。
  window.dispatchEvent(
    new CustomEvent(APP_NAVIGATE_EVENT, {
      detail: { navKey: entry.routePath, settingsDrawer: { productId: entry.productId, menuId: entry.menuId } }
    })
  )
}

/** 通知中心那颗按钮的动作；与深链落点共用同一个 dispatch（一处实现）。 */
export function openNotificationCenterSettings(entry: NotificationCenterSettingsEntry): void {
  openProductSettingsDrawer(entry)
}
