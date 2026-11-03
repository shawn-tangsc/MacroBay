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
  /** 设置面板里要定位的那一行；面板自己负责滚过去并高亮。 */
  setFocusEntityId?: (id: string | null) => void
}): (deeplink: NotificationDeeplink) => void {
  return (deeplink) => {
    deps.setNotificationCenterOpen(false)
    const target = resolveNotificationNavigation(deeplink, deps.productMenuEntries)
    if (target === null) return
    if (target.settingsPanelKey !== undefined) deps.setSettingsPanelKey(target.settingsPanelKey)
    if (target.navKey !== undefined) deps.setActiveNavKey(target.navKey)
    // 定位只在设置面板有意义：换个分区就把上一次的定位清掉，否则下次进面板会莫名其妙高亮一行。
    deps.setFocusEntityId?.(target.focusEntityId ?? null)
  }
}
