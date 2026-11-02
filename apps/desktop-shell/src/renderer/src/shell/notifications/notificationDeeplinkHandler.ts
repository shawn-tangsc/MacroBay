import type { NotificationDeeplink } from '@platform/notifications/contracts/notificationContracts'

import { resolveNotificationNavigation, type ProductMenuEntry } from './notificationDeeplink'

/**
 * 把「通知动作要跳到哪一屏」变成外壳里的一行。
 *
 * 规则本身在 `resolveNotificationNavigation`（纯函数、有单测）；这里只负责把结果落到两个
 * 状态设置器上，并先关掉抽屉。放进接缝文件里会让 `AppShell` 每多一种跳转就长几行——
 * 那正是体积门禁在卡的东西。
 */
export function createNotificationDeeplinkHandler(deps: {
  productMenuEntries: readonly ProductMenuEntry[]
  setActiveNavKey: (key: string) => void
  setSettingsPanelKey: (key: string) => void
  setNotificationCenterOpen: (open: boolean) => void
}): (deeplink: NotificationDeeplink) => void {
  return (deeplink) => {
    deps.setNotificationCenterOpen(false)
    const target = resolveNotificationNavigation(deeplink, deps.productMenuEntries)
    if (target === null) return
    if (target.settingsPanelKey !== undefined) deps.setSettingsPanelKey(target.settingsPanelKey)
    if (target.navKey !== undefined) deps.setActiveNavKey(target.navKey)
  }
}
