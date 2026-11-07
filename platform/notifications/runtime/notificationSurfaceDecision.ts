/**
 * 「这条通知能打扰哪些面」的**唯一判定**（契约 §5.1 / §5.5）。
 *
 * 三个面一起算，一起出：桌面、应用内提示、手机。**不是两个函数各算一半**——
 * 只搬「桌面 + 提示」、把手机留在调用方，判定点就变成两个：现在语义还一致，
 * 下一次改动只会改一处，那时才分叉（「勾了应用内提示，一条闪一条不闪」就是那个形状）。
 *
 * 三条不许变形的规矩，都写在这一个函数里：
 * 1. **桌面与提示互斥，桌面优先**：`toast = desktop ? false : …`。拆开就是跨模块互斥，
 *    现场会出现「两个都弹」或「明明批了桌面却只闪提示」；
 * 2. **`selection.x !== false` 原样保留**：缺省＝读者还没表过态（走批准默认）——
 *    写成 `=== true` 会把所有默认值变成关，那是另一场事故；
 * 3. **三个面读同一份 `selection`**：手机不是「不受事件级收窄」的那一个。
 *
 * **这个函数不认识事件 id**。P7（`platform.desktop.blocked`）不投桌面，靠调用方传
 * `desktopSupported: false` 或批准表里没有 `desktop` 表达——这里不写 `if (eventId === …)`，
 * 否则它就从「判定函数」变成「第二张特例表」，下一个事件再特殊一次就得回来改它。
 *
 * 纯函数：无 IO、不看时钟、不读设置文件，所以能直接单测（本文件同目录有它的用例）。
 */
import type { NotificationApprovedLevel, NotificationEventCatalogEntry } from '../contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'
import { resolveSurfaceSelection, type NotificationSurfaceSelection } from '../contracts/notificationSurfaceSelection'

export type NotificationSurfaceDecision = Readonly<{
  desktop: boolean
  toast: boolean
  /**
   * `channel` 只回答「批准 ∩ 选择」；**免打扰不在这里判**——那是提交规划的事
   * （S6：窗口内本机与手机一律安静，只进中心），两件事不能混进同一个布尔。
   */
  channel: boolean
}>

export function decideNotificationSurfaces(input: {
  /** 这一条事件批准到的面（上限）。 */
  approvedDisruptionLevels: readonly NotificationApprovedLevel[]
  settings: NotificationRuntimeSettings
  /** 平台支不支持桌面通知（`Notification.isSupported()`）。P7 那条传 `false`。 */
  desktopSupported: boolean
  /** 读者的第三层选择（契约 §5.5）：缺省＝允许，只有明确的 `false` 才收窄。 */
  selection?: NotificationSurfaceSelection
}): NotificationSurfaceDecision {
  const selection = input.selection ?? {}
  const desktop =
    input.approvedDisruptionLevels.includes('desktop') &&
    input.settings.desktopEnabled &&
    input.desktopSupported &&
    selection.desktop !== false
  // 桌面优先：桌面真能弹时，这条不再另外在应用内重复一次。
  const toast = desktop
    ? false
    : input.approvedDisruptionLevels.includes('toast') && input.settings.toastEnabled && selection.toast !== false
  const channel = input.approvedDisruptionLevels.includes('channel') && selection.channel !== false
  return Object.freeze({ desktop, toast, channel })
}

/**
 * 提交规划用的那一步：先解读者选择（含「同组两条对不上 → 都关」），再算三个面。
 *
 * 它只是把两件已经定好的事按顺序串起来，**没有第三条规矩**——所以放这儿而不是留在
 * `notificationSubmitPlan` 里，那个文件已经两次顶到 500 行。
 */
export function resolveSubmitSurfaces(input: {
  entry: NotificationEventCatalogEntry
  list: () => readonly NotificationEventCatalogEntry[]
  settings: NotificationRuntimeSettings
  desktopSupported: boolean
}): { surfaces: NotificationSurfaceDecision; conflict: boolean } {
  const resolution = resolveSurfaceSelection({
    entry: input.entry,
    list: input.list,
    selections: input.settings.surfaceSelections ?? {}
  })
  return {
    surfaces: decideNotificationSurfaces({
      approvedDisruptionLevels: input.entry.approvedDisruptionLevels,
      settings: input.settings,
      desktopSupported: input.desktopSupported,
      selection: resolution.selection
    }),
    conflict: resolution.conflict
  }
}
