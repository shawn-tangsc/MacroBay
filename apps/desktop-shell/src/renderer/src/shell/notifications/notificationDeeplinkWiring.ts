import { useState } from 'react'

import { resolveAvailableSettingsPanelKey } from '../navigation/settingsPanelKey'

import { createNotificationDeeplinkHandler } from './notificationDeeplinkHandler'
import type { ProductMenuEntry } from './notificationDeeplink'

/**
 * 通知跳转的**装配**：把外壳那几件东西绑成 handler。
 *
 * 为什么单独一个文件：`AppShell` 是体积基线文件（只减不增），而这段装配的意义全在
 * **绑什么**上——那不是「几行代码」，是两条容易绑错的规则：
 *
 * - `navigate` 必须是 `activateNavKey`（有 Tab 桥时走 `openTab`），不能是 `setActiveNavKey`
 *   （它只改侧栏高亮，页面不会打开）。上一版就是这么错的，而单测断言回调名，把错误钉成了绿。
 * - 面板键必须先过 `resolveAvailableSettingsPanelKey`：产品卸载或版本差异会让键不存在，
 *   直接设置就把读者送进空屏。
 *
 * 放在这里也让它能被一条守卫直接读到：绑错名字，测试文件当场红。
 */
export function createNotificationNavigation(ports: {
  productMenuEntries: readonly ProductMenuEntry[]
  navigate: (navKey: string) => void
  setSettingsPanelKey: (key: string) => void
  /** 当前可用的设置面板：面板键要在这一份里解析，不能直接写进去。 */
  productSettingsEntries: Parameters<typeof resolveAvailableSettingsPanelKey>[1]
  setNotificationCenterOpen: (open: boolean) => void
  setFocusEntityId: (id: string | null) => void
}): ReturnType<typeof createNotificationDeeplinkHandler> {
  return createNotificationDeeplinkHandler({
    productMenuEntries: ports.productMenuEntries,
    navigate: ports.navigate,
    setSettingsPanelKey: (key) =>
      ports.setSettingsPanelKey(resolveAvailableSettingsPanelKey(key, ports.productSettingsEntries)),
    setNotificationCenterOpen: ports.setNotificationCenterOpen,
    setFocusEntityId: ports.setFocusEntityId
  })
}

/**
 * 外壳只需调这一个 hook：它持有「要定位哪一行」的状态，并把装配好的 handler 交出去。
 *
 * 收进来的原因很实际：`AppShell` 是体积基线文件（只减不增），而这两件事永远是成对的
 * （handler 写了定位、状态却没人接，等于点了不亮），分开写就会一半一半地漂。
 */
export function useNotificationNavigation(ports: {
  productMenuEntries: readonly ProductMenuEntry[]
  navigate: (navKey: string) => void
  setSettingsPanelKey: (key: string) => void
  productSettingsEntries: Parameters<typeof resolveAvailableSettingsPanelKey>[1]
  setNotificationCenterOpen: (open: boolean) => void
}): {
  openNotificationTarget: (deeplink: Parameters<ReturnType<typeof createNotificationDeeplinkHandler>>[0]) => void
  focusEntityId: string | null
} {
  const [focusEntityId, setFocusEntityId] = useState<string | null>(null)
  const openNotificationTarget = createNotificationNavigation({ ...ports, setFocusEntityId })
  return { openNotificationTarget, focusEntityId }
}

/**
 * `openTab` 被主进程拒掉（例如 `registration-missing`：key 不在注册表里）时的诊断。
 *
 * 外壳随后会退回「只切侧栏高亮」——那看起来像跳了、其实页面没开，是今天最难查的一种形状。
 * 所以开发期必须吵一声；生产静默，读屏和界面不受影响。
 */
export function reportNavFallback(navKey: string, error: unknown): void {
  if (import.meta.env.DEV) console.warn('[nav] openTab failed, falling back to a highlight only:', navKey, error)
}
