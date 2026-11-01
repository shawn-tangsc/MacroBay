import type {
  NotificationListPage,
  NotificationUnreadState,
  SafeNotificationRecord
} from '@platform/notifications/contracts/notificationContracts'

/**
 * 通知中心唯一的数据入口：渲染层只经这里读，不直接摸 `window.platform`。
 *
 * 存在理由：角标与抽屉必须读**同一份**未读事实（`getUnreadState().unread`），否则会出现
 * 「抽屉里 3 条未读、角标写 5」这种同屏两个数。订阅也在这里收口——`onChanged` 只说明「变了」，
 * 真值仍要重读，所以这里把「重读一次」包成一个方法。
 */
export type NotificationCenterSource = {
  list: () => Promise<NotificationListPage>
  unread: () => Promise<NotificationUnreadState>
  markAllRead: () => Promise<NotificationUnreadState>
  deleteRead: () => Promise<{ deleted: number }>
  markRead: (id: string) => Promise<SafeNotificationRecord>
  /** 订阅「记录有变化」；返回退订函数。 */
  onChanged: (callback: (change: { version: number }) => void) => () => void
}

type NotificationsBridge = {
  list: (query?: unknown) => Promise<unknown>
  getUnreadState: (input?: { productId?: string }) => Promise<unknown>
  markAllRead: (input?: { productId?: string }) => Promise<unknown>
  deleteRead: () => Promise<unknown>
  markRead: (id: string) => Promise<unknown>
  onChanged: (callback: (change: { version: number }) => void) => () => void
}

/** 默认走 preload 桥；测试注入替身，不在实现里留测试分支。 */
export function createNotificationCenterSource(
  bridge: NotificationsBridge = window.platform.notifications as NotificationsBridge
): NotificationCenterSource {
  return {
    // 排序在查询里做（`unreadFirst`），渲染层不许拼两次查询再自己排。
    list: async () => (await bridge.list({ unreadFirst: true, limit: 100 })) as NotificationListPage,
    unread: async () => (await bridge.getUnreadState()) as NotificationUnreadState,
    markAllRead: async () => (await bridge.markAllRead()) as NotificationUnreadState,
    deleteRead: async () => (await bridge.deleteRead()) as { deleted: number },
    markRead: async (id: string) => (await bridge.markRead(id)) as SafeNotificationRecord,
    onChanged: (callback) => bridge.onChanged(callback)
  }
}
