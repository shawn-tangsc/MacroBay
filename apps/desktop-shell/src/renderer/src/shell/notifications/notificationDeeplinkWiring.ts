import { useState } from 'react'

import { isBuiltInSettingsPanelId } from '../navigation/builtInNavEntries'

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
 * - 面板键必须先过严格判据（handler 的 `isSettingsPanelAvailable`）：产品卸载或版本差异会让键不存在；
 *   **不回落**到默认面板——那会把读者送进错的页，看起来像点错了。
 *
 * 放在这里也让它能被一条守卫直接读到：绑错名字，测试文件当场红。
 */
export function createNotificationNavigation(ports: {
  productMenuEntries: readonly ProductMenuEntry[]
  navigate: (navKey: string) => void
  setSettingsPanelKey: (key: string) => void
  /** 当前可用的设置面板：面板键要在这一份里解析，不能直接写进去。 */
  productSettingsEntries: readonly { id: string }[]
  setNotificationCenterOpen: (open: boolean) => void
  setFocusEntityId: (id: string | null) => void
}): ReturnType<typeof createNotificationDeeplinkHandler> {
  return createNotificationDeeplinkHandler({
    productMenuEntries: ports.productMenuEntries,
    navigate: ports.navigate,
    // handler 已经先过 `isSettingsPanelAvailable`；这里**不做回落**——回落到 models 就是「点了落到别页」。
    setSettingsPanelKey: (key) => ports.setSettingsPanelKey(key),
    // 严格版：只在目标真的存在时才导航；「给了目标但不认识」由 handler 整条丢掉，不回落 models。
    isSettingsPanelAvailable: (key) =>
      isBuiltInSettingsPanelId(key) || ports.productSettingsEntries.some((entry) => entry.id === key),
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
  productSettingsEntries: readonly { id: string }[]
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
 * `openTab` 没开出页面时的**唯一**诊断出口。
 *
 * 三件事都在这里定死（2026-11-06 真机上付出过代价）：
 *  1. **error 级**：应用日志只收 console.error，`console.warn` 在真机日志里一行都不留——那一晚
 *     「点了没反应」查了三轮就是因为拒绝现场一个字都没有。
 *  2. **拒绝也是一条诊断**：`openTab` 的拒绝是**返回值**（`status: 'rejected'` + `errorCode`），
 *     不是异常，`catch` 永远接不到。所以调用方必须显式把拒绝结果交给这里，`errorCode` 就是根因。
 *  3. **生产也记**：被拒意味着这一页根本打不开，不是开发期才有的噪声。它是给日志看的，不上界面。
 */
export function reportNavFallback(navKey: string, detail: unknown): void {
  console.error('[nav] openTab did not open a page, falling back to a highlight only:', navKey, detail)
}
