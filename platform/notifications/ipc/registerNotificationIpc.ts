import { join } from 'node:path'

import { app } from 'electron'

import { createDesktopNotificationAdapter } from '../desktop/desktopNotificationAdapter'
import { createNotificationJsonStorage, createNotificationRuntime } from '../runtime/notificationRuntime'
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationClock } from '../runtime/notificationRouting'

let notificationRuntime: ReturnType<typeof createNotificationRuntime> | null = null
let getNotificationSettings: (() => Promise<NotificationRuntimeSettings>) | null = null
let notificationClock: NotificationClock | null = null

export function configureNotificationRuntime(deps: {
  getSettings: () => Promise<NotificationRuntimeSettings>
  /** 读者时区与当前时刻。**必传**：缺省成 UTC 会把「不知道」当成「用户在格林尼治」（`MI-11-R68`）。 */
  clock: NotificationClock
}): void {
  getNotificationSettings = deps.getSettings
  notificationClock = deps.clock
}

export function getNotificationRuntime() {
  if (!notificationRuntime) {
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
          centerEnabled: true,
          desktopEnabled: true,
          toastEnabled: true,
          popupEnabled: true,
          retentionDays: 30,
          defaultSnoozeMinutes: 60
        }),
      clock: notificationClock,
      deliveryHooks: {
        desktop: (record) => desktopAdapter.show(record)
      },
      requestDesktopPermission: () => desktopAdapter.requestPermission()
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
