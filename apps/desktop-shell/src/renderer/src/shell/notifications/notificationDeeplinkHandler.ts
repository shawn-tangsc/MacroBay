import type { NotificationDeeplink } from '@platform/notifications/contracts/notificationContracts'

import { resolveNotificationNavigation, type ProductMenuEntry } from './notificationDeeplink'
import type { NotificationCenterSettingsEntry } from './notificationCenterSettingsEntry'

/**
 * 把「通知动作要跳到哪一屏」变成外壳里的一行。
 *
 * 规则本身在 `resolveNotificationNavigation`（纯函数、有单测）；这里只负责把结果落到两个
 * 状态设置器上，并先关掉抽屉。放进接缝文件里会让 `AppShell` 每多一种跳转就长几行——
 * 那正是体积门禁在卡的东西。
 */
export function createNotificationDeeplinkHandler(deps: {
  productMenuEntries: readonly ProductMenuEntry[]
  /**
   * **切页的唯一入口**：传 `activateNavKey`，不是 `setActiveNavKey`。
   *
   * 有受控 Tab 桥时页面由 `WorkspaceTabStrip` / `WorkspacePageHost` 驱动，`setActiveNavKey`
   * 只改侧栏高亮、不打开页——那正是「通知点了没反应」的形状。`activateNavKey` 在有桥时走
   * `openTab`，没桥时才回退到直接切页，是这两种情况都成立的那一个。
   */
  navigate: (navKey: string) => void
  setSettingsPanelKey: (key: string) => void
  setNotificationCenterOpen: (open: boolean) => void
  /** 设置面板里要定位的那一行；面板自己负责滚过去并高亮。 */
  setFocusEntityId?: (id: string | null) => void
  /** 产品设置抽屉的落点：与通知中心那颗「去设置」共用同一个 dispatch。 */
  openProductSettingsDrawer?: (entry: NotificationCenterSettingsEntry) => void
  /**
   * 严格判据：目标设置面板在本构建里真的存在吗。
   *
   * 「没给目标」才允许回落默认面板；「给了目标但不认识」（产品卸载、注册被撤）必须**整条不导航**——
   * 回落 models 会让读者以为点错了页，而代码里没有任何痕迹。
   */
  isSettingsPanelAvailable?: (key: string) => boolean
}): (deeplink: NotificationDeeplink) => void {
  return (deeplink) => {
    deps.setNotificationCenterOpen(false)
    const target = resolveNotificationNavigation(deeplink, deps.productMenuEntries)
    if (target === null) return
    if (target.settingsDrawer !== undefined) {
      // 产品给的落点：产品页自己打开抽屉；平台不碰 `settingsPanelKey`，也就不存在回落。
      deps.openProductSettingsDrawer?.(target.settingsDrawer)
      deps.setFocusEntityId?.(target.focusEntityId ?? null)
      return
    }
    if (
      target.settingsPanelKey !== undefined &&
      deps.isSettingsPanelAvailable !== undefined &&
      !deps.isSettingsPanelAvailable(target.settingsPanelKey)
    ) {
      // 目标存在与否是**导航**的判据：不认识就整条不导航（也不回落 models）。
      return
    }
    if (target.settingsPanelKey !== undefined) deps.setSettingsPanelKey(target.settingsPanelKey)
    if (target.navKey !== undefined) deps.navigate(target.navKey)
    // 定位只在设置面板有意义：换个分区就把上一次的定位清掉，否则下次进面板会莫名其妙高亮一行。
    deps.setFocusEntityId?.(target.focusEntityId ?? null)
  }
}
