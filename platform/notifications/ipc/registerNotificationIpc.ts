import { join } from 'node:path'

import { app } from 'electron'

import { createDesktopNotificationAdapter } from '../desktop/desktopNotificationAdapter'
import { createNotificationJsonStorage, createNotificationRuntime } from '../runtime/notificationRuntime'
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'

let notificationRuntime: ReturnType<typeof createNotificationRuntime> | null = null
let getNotificationSettings: (() => Promise<NotificationRuntimeSettings>) | null = null

export function configureNotificationRuntime(deps: {
  getSettings: () => Promise<NotificationRuntimeSettings>
}): void {
  getNotificationSettings = deps.getSettings
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
