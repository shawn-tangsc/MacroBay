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

  // ── 开关与频道事件表（契约 §5.1 / §5.4）：读/写都只调 runtime，渲染层没有第二个写入 IO。 ──
  // 订阅那一层（逐事件三列矩阵）在 2026-11-04 整层撤销：没有 getSubscriptions/setSubscription 了。
  ipcMain.handle(IpcChannels.notificationsListEventCatalog, () => getNotificationRuntime().listEventCatalog())
  ipcMain.handle(IpcChannels.notificationsGetDeliverySettings, () =>
    getNotificationRuntime().getDeliverySettings()
  )
  ipcMain.handle(IpcChannels.notificationsSetDesktopEnabled, (_event, input) => {
    const payload = (input ?? {}) as { enabled?: boolean }
    return getNotificationRuntime().setDesktopEnabled(payload.enabled === true)
  })
  ipcMain.handle(IpcChannels.notificationsGetChannelEvents, () => getNotificationRuntime().getChannelEvents())
  ipcMain.handle(IpcChannels.notificationsSetChannelEvent, (_event, input) => {
    const payload = (input ?? {}) as { eventId?: string; enabled?: boolean }
    if (!payload.eventId) throw new Error('eventId is required.')
    return getNotificationRuntime().setChannelEvent(payload.eventId, payload.enabled === true)
  })
  ipcMain.handle(IpcChannels.notificationsRedeliverPush, (_event, input) => {
    const payload = (input ?? {}) as { dedupeKey?: string; editionId?: string; locale?: string; surface?: string }
    if (!payload.dedupeKey || !payload.editionId || !payload.locale) {
      throw new Error('dedupeKey, editionId and locale are required.')
    }
    return getNotificationRuntime().redeliverPush({
      dedupeKey: payload.dedupeKey,
      editionId: payload.editionId,
      locale: payload.locale,
      ...(payload.surface === undefined ? {} : { surface: payload.surface })
    })
  })
  ipcMain.handle(IpcChannels.notificationsSetToastEnabled, (_event, input) => {
    const payload = (input ?? {}) as { enabled?: boolean }
    return getNotificationRuntime().setToastEnabled(payload.enabled === true)
  })
}
