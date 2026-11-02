import { Notification } from 'electron'

import type { DesktopNotificationPermission } from '../contracts/notificationContracts'

/** 已解析成读者语言的文案；适配器不认键，也不认记录形状。 */
export type DesktopNotificationText = { title: string; body?: string }

export type DesktopNotificationAdapter = {
  /** 只有「系统能回答授没授权」时才返回 granted/denied；查不到一律 unknown，不许拿支持性冒充授权。 */
  readPermission: () => Promise<DesktopNotificationPermission>
  show: (text: DesktopNotificationText) => Promise<{ ok: boolean; reason?: string }>
}

export function createDesktopNotificationAdapter(): DesktopNotificationAdapter {
  return {
    async readPermission() {
      // Electron 41.9.2：`getMediaAccessStatus` 只认 microphone/camera/screen，没有通知；`Notification`
      // 的 `failed` 事件仅 win32。所以这里**没有**可靠的授权读法——「查不到」就说查不到。
      // `Notification.isSupported()` 只说明这个平台支持通知，推不出用户已授权。
      return 'unknown'
    },
    async show(text) {
      if (!Notification.isSupported()) {
        return { ok: false, reason: 'unsupported' }
      }

      const notification = new Notification({
        title: text.title,
        body: text.body
      })
      notification.show()
      return { ok: true }
    }
  }
}
