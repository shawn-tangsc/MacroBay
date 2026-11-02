import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'

import { IpcChannels } from '../../desktop/ipc/channels'
import { resolveNotificationCopyText, notificationCopyText, type NotificationCopyLanguage } from '../../i18n/notificationCopy'
import { createDesktopNotificationAdapter } from '../desktop/desktopNotificationAdapter'
import { createNotificationJsonStorage, createNotificationRuntime } from '../runtime/notificationRuntime'
import { toSafeNotificationRecord } from '../contracts/notificationContracts'
import type { NotificationRecord, NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationClock } from '../runtime/notificationRouting'

let notificationRuntime: ReturnType<typeof createNotificationRuntime> | null = null
let getNotificationSettings: (() => Promise<NotificationRuntimeSettings>) | null = null
let notificationClock: NotificationClock | null = null
let getLanguage: (() => Promise<NotificationCopyLanguage>) | null = null

export function configureNotificationRuntime(deps: {
  getSettings: () => Promise<NotificationRuntimeSettings>
  /** 读者时区与当前时刻。**必传**：缺省成 UTC 会把「不知道」当成「用户在格林尼治」（`MI-11-R68`）。 */
  clock: NotificationClock
  /**
   * 读者语言：桌面通知在主进程发出，文案必须在这里解析。
   * 类型上可缺是为了装配顺序（先 configure 再取实例），但**缺了会在取实例时直接抛错**，
   * 不会悄悄按中文发出去——静默兜底会让英文用户收到中文桌面通知。
   */
  getLanguage?: () => Promise<NotificationCopyLanguage>
}): void {
  getNotificationSettings = deps.getSettings
  notificationClock = deps.clock
  getLanguage = deps.getLanguage ?? null
}

/** 记录变化后广播一次：角标与列表订阅它，不轮询。事件只说明「变了」，真值仍由 `list()` 读。 */
/**
 * 应用内投递：把那条记录推给渲染层去画。
 *
 * 存在理由：`routeTransientDelivery` 早就有 `toast` / `popup` 两个钩子，但没人接——于是开关
 * 打开了、路由算完「该弹」、`hooks.toast` 缺席，记录被写成 `skipped: toast-unavailable`。
 * 效果与假开关相同：用户勾了它，屏幕上什么都没发生。
 */
function broadcastNotificationDelivered(record: NotificationRecord, channel: 'toast' | 'popup'): void {
  const payload = { channel, record: toSafeNotificationRecord(record) }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IpcChannels.notificationsDelivered, payload)
  }
}

function broadcastNotificationChanged(change: { version: number }): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IpcChannels.notificationsChanged, change)
  }
}

export function getNotificationRuntime() {
  if (!notificationRuntime) {
    if (getLanguage === null) {
      throw new Error('notification-runtime-language-not-configured')
    }
    if (notificationClock === null) {
      // 装配顺序错误：宁可启动即失败，也不拿 UTC 顶替读者时区去判一次免打扰。
      throw new Error('notification-runtime-clock-not-configured')
    }
    const desktopAdapter = createDesktopNotificationAdapter()
    notificationRuntime = createNotificationRuntime({
      storage: createNotificationJsonStorage(join(app.getPath('userData'), 'platform', 'notifications.json')),
      getSettings: () =>
        getNotificationSettings?.() ??
        Promise.resolve({
          desktopEnabled: true,
          toastEnabled: false,
          popupEnabled: true,
          push: { channelId: null },
          retentionDays: 30,
          defaultSnoozeMinutes: 60
        }),
      clock: notificationClock,
      deliveryHooks: {
        // 应用内两档直接推给渲染层：句子由渲染层按当前语言解析（记录里只有键与参数）。
        toast: (record) => broadcastNotificationDelivered(record, 'toast'),
        popup: (record) => broadcastNotificationDelivered(record, 'popup'),
        // 记录只存键与参数，句子在这里按**当前语言**解析：切语言后历史通知也跟着变。
        desktop: async (record) => {
          // 每次读设置：切语言后**历史通知**也按新语言解析（记录里只有键）。
          const language = (await getLanguage?.()) ?? 'zh-CN'
          const template = notificationCopyText(language, record.titleKey)
          const bodyTemplate = record.bodyKey === undefined
            ? undefined
            : notificationCopyText(language, record.bodyKey)
          return desktopAdapter.show({
            title: resolveNotificationCopyText(language, template, record.titleParams),
            ...(bodyTemplate === undefined
              ? {}
              : { body: resolveNotificationCopyText(language, bodyTemplate, record.bodyParams) })
          })
        }
      },
      readDesktopPermission: () => desktopAdapter.readPermission(),
      onChanged: broadcastNotificationChanged
    })
    void notificationRuntime.initialize()
  }
  return notificationRuntime
}

export function resetNotificationRuntimeForTests(): void {
  notificationRuntime = null
  getNotificationSettings = null
  notificationClock = null
}
