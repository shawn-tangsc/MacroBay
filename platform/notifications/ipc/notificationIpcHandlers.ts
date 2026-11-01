import { ipcMain } from 'electron'

import { IpcChannels } from '../../desktop/ipc/channels'
import { buildTestNotificationRequest } from '../producers/testNotification'
import { getNotificationRuntime } from './registerNotificationIpc'

export function registerNotificationIpcHandlers(): void {
  ipcMain.handle(IpcChannels.notificationsList, (_event, query) => getNotificationRuntime().list(query))
  ipcMain.handle(IpcChannels.notificationsGetUnreadState, (_event, input) =>
    getNotificationRuntime().getUnreadState((input as { productId?: string } | undefined)?.productId)
  )
  ipcMain.handle(IpcChannels.notificationsMarkAllRead, (_event, input) =>
    getNotificationRuntime().markAllRead((input as { productId?: string } | undefined)?.productId)
  )
  ipcMain.handle(IpcChannels.notificationsMarkRead, (_event, input) =>
    getNotificationRuntime().markRead(String((input as { id?: string })?.id ?? ''))
  )
  ipcMain.handle(IpcChannels.notificationsAcknowledge, (_event, input) =>
    getNotificationRuntime().acknowledge(String((input as { id?: string })?.id ?? ''))
  )
  // 破坏性且不可撤销：只删已读，未读一条不动；返回实际删掉的条数，不整批失败。
  ipcMain.handle(IpcChannels.notificationsDeleteRead, () => getNotificationRuntime().deleteRead())
  ipcMain.handle(IpcChannels.notificationsDismiss, (_event, input) =>
    getNotificationRuntime().dismiss(String((input as { id?: string })?.id ?? ''))
  )
  ipcMain.handle(IpcChannels.notificationsSnooze, (_event, input) => {
    const payload = (input ?? {}) as { id?: string; until?: string }
    if (!payload.id || !payload.until) throw new Error('id and until are required.')
    return getNotificationRuntime().snooze(payload.id, payload.until)
  })
  ipcMain.handle(IpcChannels.notificationsSendTest, () =>
    getNotificationRuntime().submitSelfTest(buildTestNotificationRequest())
  )
  ipcMain.handle(IpcChannels.notificationsRequestDesktopPermission, () => getNotificationRuntime().readDesktopPermission())
}
