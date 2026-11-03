import type { IpcRenderer } from 'electron'

import { IpcChannels } from '../../ipc/channels'
import type { SafeNotificationRecord, NotificationUnreadState } from '../../../notifications/contracts/notificationContracts'
import type { NotificationRuntime } from '../../../notifications/runtime/notificationRuntime'

/** 测试通知的真实回执：一条记录 + 每一档投递的尝试结果。形状取自运行时签名，不在这里抄第二份。 */
export type NotificationSelfTestReceipt = Awaited<ReturnType<NotificationRuntime['submitSelfTest']>>

/** 订阅写入的回执：`ok:false` 带原因码。同样取自运行时签名，抄一份迟早与主进程漂移。 */
export type NotificationSubscriptionWriteResult = Awaited<ReturnType<NotificationRuntime['setSubscription']>>

/**
 * 通知命名空间（从 `preload/index.ts` 抽出来的第一块）。
 *
 * 为什么抽：渲染层的入口清单本来就该是一张细表，而 preload 是受保护接缝，**越薄越好**；
 * 更实际的理由是文件体积门禁——接缝文件不许随功能一起长，功能多了就该分文件。
 *
 * 这一块只有读写与两条订阅，**没有能凭空造通知的方法**：`submit` 不在渲染层，
 * 「谁可以产生一条通知」仍由主进程说了算（见 `notificationProducerBoundary.test.ts`）。
 *
 * **读写两侧的返回值都标了真实类型**，形状一律 `Awaited<ReturnType<NotificationRuntime[...]>>`
 * 从运行时签名取，不在这里抄第二份：`ipcRenderer.invoke` 的默认返回是 `any`，标漏一个，
 * 渲染层写错字段编译器就不会红——频道设置那 8 条重复频道正是这么来的。
 */
export function createNotificationsNamespace(ipcRenderer: IpcRenderer) {
  return {
    list: (query?: unknown) =>
      ipcRenderer.invoke(IpcChannels.notificationsList, query) as Promise<Awaited<ReturnType<NotificationRuntime['list']>>>,
    /** 返回 `{ unread, version }`：角标只需一次调用；版本号随每次记录变化递增。 */
    getUnreadState: (input?: { productId?: string }) =>
      ipcRenderer.invoke(
        IpcChannels.notificationsGetUnreadState,
        input
      ) as Promise<Awaited<ReturnType<NotificationRuntime['getUnreadState']>>>,
    markRead: (id: string) =>
      ipcRenderer.invoke(IpcChannels.notificationsMarkRead, { id }) as Promise<SafeNotificationRecord>,
    /** 发送一条测试通知：走真实 `submit()`，验证链路与系统放行；每次点击都是一条新记录。 */
    sendTest: () =>
      ipcRenderer.invoke(IpcChannels.notificationsSendTest) as Promise<NotificationSelfTestReceipt>,
    /** 清空 = 全部未读标为已读；返回 `{ unread, version }`，角标不必再查一次。 */
    markAllRead: (input?: { productId?: string }) =>
      ipcRenderer.invoke(IpcChannels.notificationsMarkAllRead, input) as Promise<NotificationUnreadState>,
    acknowledge: (id: string) =>
      ipcRenderer.invoke(IpcChannels.notificationsAcknowledge, { id }) as Promise<SafeNotificationRecord>,
    /** 真删除已读记录；返回实际删掉的条数。**未读不受影响**，与 `markAllRead` 不是一回事。 */
    // 单行形态是那条接线守卫的断言原文（`appIpcSurface.test.ts`），别为了排版拆开它。
    deleteRead: () => ipcRenderer.invoke(IpcChannels.notificationsDeleteRead) as Promise<{ deleted: number }>,
    dismiss: (id: string) =>
      ipcRenderer.invoke(IpcChannels.notificationsDismiss, { id }) as Promise<SafeNotificationRecord>,
    snooze: (id: string, until: string) =>
      ipcRenderer.invoke(IpcChannels.notificationsSnooze, { id, until }) as Promise<SafeNotificationRecord>,
    /** 返回 `granted | denied | unknown`；**`unknown` 是常态**，UI 不许把 unknown 显示成「已授权」。 */
    readDesktopPermission: () =>
      ipcRenderer.invoke(
        IpcChannels.notificationsReadDesktopPermission
      ) as Promise<Awaited<ReturnType<NotificationRuntime['readDesktopPermission']>>>,
    /** 事件目录投影：带 `notifyOnlyIfSubscribed` 与批准档位；清单按它渲染，不写死事件名。 */
    listEventCatalog: () =>
      ipcRenderer.invoke(IpcChannels.notificationsListEventCatalog) as Promise<
        Awaited<ReturnType<NotificationRuntime['listEventCatalog']>>
      >,
    getSubscriptions: () =>
      ipcRenderer.invoke(IpcChannels.notificationsGetSubscriptions) as Promise<
        Awaited<ReturnType<NotificationRuntime['getSubscriptions']>>
      >,
    setSubscription: (eventTypeId: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke(IpcChannels.notificationsSetSubscription, { eventTypeId, patch }) as Promise<NotificationSubscriptionWriteResult>,
    /** 当前提示开关 / 通道选择 / 接线状态：设置页首帧要三个值，不是只给写口。 */
    getDeliverySettings: () =>
      ipcRenderer.invoke(IpcChannels.notificationsGetDeliverySettings) as Promise<
        Awaited<ReturnType<NotificationRuntime['getDeliverySettings']>>
      >,
    setPushChannel: (channelId: string | null) =>
      ipcRenderer.invoke(IpcChannels.notificationsSetPushChannel, { channelId }) as Promise<{ channelId: string | null }>,
    setToastEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IpcChannels.notificationsSetToastEnabled, { enabled }) as Promise<{ toastEnabled: boolean }>,
    /**
     * 订阅「应用内投递」：`toast` / `popup` 两档真的投出去时才推，载荷是那条记录本身（键与参数）。
     * 渲染层据此画右上角横幅；不用轮询 `list()` 猜「有没有新的」。
     */
    onDelivered: (callback: (delivery: { channel: 'toast' | 'popup'; record: unknown }) => void) => {
      const listener = (_event: unknown, delivery: { channel: 'toast' | 'popup'; record: unknown }): void =>
        callback(delivery)
      ipcRenderer.on(IpcChannels.notificationsDelivered, listener)
      return () => { ipcRenderer.removeListener(IpcChannels.notificationsDelivered, listener) }
    },
    /**
     * 订阅「记录有变化」：投递、标读、撤销、稍后、清理之后各推一次，载荷是递增版本号。
     * 返回退订函数；事件只说明「变了」，真值仍由 `list()` / `getUnreadState()` 读。
     */
    onChanged: (callback: (change: { version: number }) => void) => {
      const listener = (_event: unknown, change: { version: number }): void => callback(change)
      ipcRenderer.on(IpcChannels.notificationsChanged, listener)
      return () => { ipcRenderer.removeListener(IpcChannels.notificationsChanged, listener) }
    }
  }
}
