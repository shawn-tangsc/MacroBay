import { Notification } from 'electron'

import type { NotificationRecord } from '../contracts/notificationContracts'

export type DesktopNotificationAdapter = {
  requestPermission: () => Promise<{ granted: boolean; supported: boolean }>
  show: (record: NotificationRecord) => Promise<{ ok: boolean; reason?: string }>
}

export function createDesktopNotificationAdapter(): DesktopNotificationAdapter {
  return {
    async requestPermission() {
      return { supported: true, granted: Notification.isSupported() }
    },
    async show(record) {
      if (!Notification.isSupported()) {
        return { ok: false, reason: 'unsupported' }
      }

      const notification = new Notification({
        title: record.title,
        body: record.body
      })
      notification.show()
      return { ok: true }
    }
  }
}
