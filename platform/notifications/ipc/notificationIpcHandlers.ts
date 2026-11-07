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
  /**
   * 表面选择**只露读**（契约 §5.5）：页面据此画能画的勾、并说明「为什么今天不发」。
   * 写入仍走主进程那一个入口（`setSurfaceSelection`），不为读多开一条写通道。
   */
  ipcMain.handle(IpcChannels.notificationsGetSurfaceSelection, (_event, input) => {
    const payload = (input ?? {}) as { eventTypeId?: string }
    if (typeof payload.eventTypeId !== 'string' || payload.eventTypeId.length === 0) {
      throw new Error('eventTypeId is required.')
    }
    return getNotificationRuntime().getSurfaceSelection(payload.eventTypeId)
  })
  /**
   * 写一份表面选择（契约 §5.5）。**只有这一条写通道**：不做批量、不做删除、不做 reset。
   *
   * 越权（给没批的面写 `true`）由运行时按 `notification-surface-not-approved` 拒——这里不预先
   * 夹掉：夹掉会让页面以为存上了，而读者看到的是一个勾在、实际不生效的配置。
   */
  ipcMain.handle(IpcChannels.notificationsSetSurfaceSelection, (_event, input) => {
    const payload = (input ?? {}) as { eventTypeId?: string; surfaces?: unknown }
    if (typeof payload.eventTypeId !== 'string' || payload.eventTypeId.length === 0) {
      throw new Error('eventTypeId is required.')
    }
    if (typeof payload.surfaces !== 'object' || payload.surfaces === null || Array.isArray(payload.surfaces)) {
      throw new Error('surfaces must be an object.')
    }
    return getNotificationRuntime().setSurfaceSelection(payload.eventTypeId, payload.surfaces)
  })
  ipcMain.handle(IpcChannels.notificationsRedeliverPush, (_event, input) => {
    const payload = (input ?? {}) as { recordId?: string; editionId?: string; locale?: string; surface?: string }
    if (!payload.recordId || !payload.editionId || !payload.locale) {
      throw new Error('recordId, editionId and locale are required.')
    }
    return getNotificationRuntime().redeliverPush({
      recordId: payload.recordId,
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
