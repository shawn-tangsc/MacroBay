import type {
  NotificationCenterItem,
  NotificationListPage,
  NotificationUnreadState
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
  markRead: (id: string) => Promise<NotificationCenterItem>
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

/** 桥缺失时的错误码：不是「没有通知」，是「这次构建读不到通知」。 */
export const NOTIFICATION_BRIDGE_MISSING = 'notification-bridge-missing'

function defaultBridge(): NotificationsBridge | null {
  return (window.platform?.notifications as NotificationsBridge | undefined) ?? null
}

/**
 * 默认走 preload 桥；测试注入替身，不在实现里留测试分支。
 *
 * **桥缺失不能把外壳拖崩**：没有 preload 桥的环境里（渲染层单测、旧构建），`onChanged` 曾经
 * 是同步抛错——一个订阅就让整个 `AppShell` 挂载失败，十一个既有用例一起红。这里的判法分两半：
 * 订阅退化成空（没人会来事件，也没人该因此崩），读操作**如实失败**（抽屉据此给错误态，
 * 说明「拿不到」）——清零或空列表会把它伪装成「没有通知」，那是在撒谎。
 */
export function createNotificationCenterSource(
  bridge: NotificationsBridge | null = defaultBridge()
): NotificationCenterSource {
  if (bridge === null) {
    const unavailable = (): Promise<never> => Promise.reject(new Error(NOTIFICATION_BRIDGE_MISSING))
    return {
      list: unavailable,
      unread: unavailable,
      markAllRead: unavailable,
      deleteRead: unavailable,
      markRead: unavailable,
      onChanged: () => () => undefined
    }
  }
  return {
    // 排序在查询里做（`unreadFirst`），渲染层不许拼两次查询再自己排。
    list: async () => (await bridge.list({ unreadFirst: true, limit: 100 })) as NotificationListPage,
    unread: async () => (await bridge.getUnreadState()) as NotificationUnreadState,
    markAllRead: async () => (await bridge.markAllRead()) as NotificationUnreadState,
    deleteRead: async () => (await bridge.deleteRead()) as { deleted: number },
    markRead: async (id: string) => (await bridge.markRead(id)) as NotificationCenterItem,
    onChanged: (callback) => bridge.onChanged(callback)
  }
}
