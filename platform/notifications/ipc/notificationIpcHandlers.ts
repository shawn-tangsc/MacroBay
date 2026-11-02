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
  // 只读授权状态：主进程没有「申请授权」这个能力，真申请只能从渲染层走 Web Notification API。
  ipcMain.handle(IpcChannels.notificationsReadDesktopPermission, () => getNotificationRuntime().readDesktopPermission())

  // ── 订阅与投递设置（契约 §5.2）：五条读/写都只调 runtime，渲染层没有第二个写入 IO。 ──
  ipcMain.handle(IpcChannels.notificationsListEventCatalog, () => getNotificationRuntime().listEventCatalog())
  ipcMain.handle(IpcChannels.notificationsGetSubscriptions, () => getNotificationRuntime().getSubscriptions())
  ipcMain.handle(IpcChannels.notificationsSetSubscription, (_event, input) => {
    const payload = (input ?? {}) as { eventTypeId?: string; patch?: Record<string, unknown> }
    if (!payload.eventTypeId) throw new Error('eventTypeId is required.')
    return getNotificationRuntime().setSubscription(payload.eventTypeId, (payload.patch ?? {}) as never)
  })
  ipcMain.handle(IpcChannels.notificationsGetDeliverySettings, () =>
    getNotificationRuntime().getDeliverySettings()
  )
  ipcMain.handle(IpcChannels.notificationsSetPushChannel, (_event, input) => {
    const payload = (input ?? {}) as { channelId?: string | null }
    return getNotificationRuntime().setPushChannel(payload.channelId ?? null)
  })
  ipcMain.handle(IpcChannels.notificationsSetToastEnabled, (_event, input) => {
    const payload = (input ?? {}) as { enabled?: boolean }
    return getNotificationRuntime().setToastEnabled(payload.enabled === true)
  })
}
