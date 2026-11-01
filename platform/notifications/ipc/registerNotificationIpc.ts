import { join } from 'node:path'

import { app } from 'electron'

import { createDesktopNotificationAdapter } from '../desktop/desktopNotificationAdapter'
import { createNotificationJsonStorage, createNotificationRuntime } from '../runtime/notificationRuntime'
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationClock } from '../runtime/notificationRouting'

let notificationRuntime: ReturnType<typeof createNotificationRuntime> | null = null
let getNotificationSettings: (() => Promise<NotificationRuntimeSettings>) | null = null
let notificationClock: NotificationClock | undefined

export function configureNotificationRuntime(deps: {
  getSettings: () => Promise<NotificationRuntimeSettings>
  /** 读者时区与当前时刻；免打扰窗口按它判断，缺省 UTC。 */
  clock?: NotificationClock
}): void {
  getNotificationSettings = deps.getSettings
  notificationClock = deps.clock
}

export function getNotificationRuntime() {
  if (!notificationRuntime) {
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
}
