import type { IpcRenderer } from 'electron'

import { IpcChannels } from '../../ipc/channels'
import type { NotificationCenterItem, NotificationUnreadState } from '../../../notifications/contracts/notificationContracts'
import type { NotificationRuntime } from '../../../notifications/runtime/notificationRuntime'

/** 测试通知的真实回执：一条记录 + 每一档投递的尝试结果。形状取自运行时签名，不在这里抄第二份。 */
export type NotificationSelfTestReceipt = Awaited<ReturnType<NotificationRuntime['submitSelfTest']>>

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
      ipcRenderer.invoke(IpcChannels.notificationsMarkRead, { id }) as Promise<NotificationCenterItem>,
    /** 发送一条测试通知：走真实 `submit()`，验证链路与系统放行；每次点击都是一条新记录。 */
    sendTest: (input?: { kind?: string }) =>
      ipcRenderer.invoke(IpcChannels.notificationsSendTest, input) as Promise<NotificationSelfTestReceipt>,
    /** 清空 = 全部未读标为已读；返回 `{ unread, version }`，角标不必再查一次。 */
    markAllRead: (input?: { productId?: string }) =>
      ipcRenderer.invoke(IpcChannels.notificationsMarkAllRead, input) as Promise<NotificationUnreadState>,
    acknowledge: (id: string) =>
      ipcRenderer.invoke(IpcChannels.notificationsAcknowledge, { id }) as Promise<NotificationCenterItem>,
    /** 真删除已读记录；返回实际删掉的条数。**未读不受影响**，与 `markAllRead` 不是一回事。 */
    // 单行形态是那条接线守卫的断言原文（`appIpcSurface.test.ts`），别为了排版拆开它。
    deleteRead: () => ipcRenderer.invoke(IpcChannels.notificationsDeleteRead) as Promise<{ deleted: number }>,
    dismiss: (id: string) =>
      ipcRenderer.invoke(IpcChannels.notificationsDismiss, { id }) as Promise<NotificationCenterItem>,
    snooze: (id: string, until: string) =>
      ipcRenderer.invoke(IpcChannels.notificationsSnooze, { id, until }) as Promise<NotificationCenterItem>,
    /** 返回 `granted | denied | unknown`；**`unknown` 是常态**，UI 不许把 unknown 显示成「已授权」。 */
    readDesktopPermission: () =>
      ipcRenderer.invoke(
        IpcChannels.notificationsReadDesktopPermission
      ) as Promise<Awaited<ReturnType<NotificationRuntime['readDesktopPermission']>>>,
    /** 事件目录投影：带批准档位；界面按它渲染，不写死事件名。 */
    listEventCatalog: () =>
      ipcRenderer.invoke(IpcChannels.notificationsListEventCatalog) as Promise<
        Awaited<ReturnType<NotificationRuntime['listEventCatalog']>>
      >,
    /** 情报三条「推不推手机」：读回那张表（只含批准含 channel 的三条）。 */
    getChannelEvents: () =>
      ipcRenderer.invoke(IpcChannels.notificationsGetChannelEvents) as Promise<
        Awaited<ReturnType<NotificationRuntime['getChannelEvents']>>
      >,
    /** 读一条通知（或其组）的表面选择（契约 §5.5 第三层）：只读，画勾用。 */
    getSurfaceSelection: (eventTypeId: string) =>
      ipcRenderer.invoke(IpcChannels.notificationsGetSurfaceSelection, { eventTypeId }) as Promise<
        Awaited<ReturnType<NotificationRuntime['getSurfaceSelection']>>
      >,
    /** 写同一份选择。**唯一一条写通道**：没有批量、没有删除、没有 reset。 */
    setSurfaceSelection: (eventTypeId: string, surfaces: { channel?: boolean; toast?: boolean; desktop?: boolean }) =>
      ipcRenderer.invoke(IpcChannels.notificationsSetSurfaceSelection, { eventTypeId, surfaces }) as Promise<
        Awaited<ReturnType<NotificationRuntime['setSurfaceSelection']>>
      >,
    setChannelEvent: (eventId: string, enabled: boolean) =>
      ipcRenderer.invoke(IpcChannels.notificationsSetChannelEvent, { eventId, enabled }) as Promise<
        Awaited<ReturnType<NotificationRuntime['setChannelEvent']>>
      >,
    /** 读者点「推送到手机」才调：不新建记录、不改内容，只重投这一条的手机一面。 */
    /** 只认 `recordId`（提交回执里那个）；键形态在这条路上不再存在（契约 v2.32）。 */
    redeliverPush: (input: { recordId: string; editionId: string; locale: string; surface?: string }) =>
      ipcRenderer.invoke(IpcChannels.notificationsRedeliverPush, input) as Promise<
        Awaited<ReturnType<NotificationRuntime['redeliverPush']>>
      >,
    /** 当前提示开关 / 桌面开关 / 接线状态：设置页首帧要这几个值，不是只给写口。 */
    getDeliverySettings: () =>
      ipcRenderer.invoke(IpcChannels.notificationsGetDeliverySettings) as Promise<
        Awaited<ReturnType<NotificationRuntime['getDeliverySettings']>>
      >,
    setToastEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IpcChannels.notificationsSetToastEnabled, { enabled }) as Promise<{ toastEnabled: boolean }>,
    /** 桌面开关（缺过一行：IPC 常量与 handler 都在，桥接漏了，于是那颗开关永远存不上）。 */
    setDesktopEnabled: (enabled: boolean) =>
      ipcRenderer.invoke(IpcChannels.notificationsSetDesktopEnabled, { enabled }) as Promise<{
        desktopEnabled: boolean
      }>,
    /**
     * 订阅「应用内投递」：`toast` / `popup` 两档真的投出去时才推，载荷是**已解析好句子**的那一条
     * （主进程投影，键与参数不在里面）。渲染层据此画右上角横幅；不用轮询 `list()` 猜「有没有新的」。
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
