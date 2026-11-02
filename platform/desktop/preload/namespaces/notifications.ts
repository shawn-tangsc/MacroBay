import type { IpcRenderer } from 'electron'

import { IpcChannels } from '../../ipc/channels'

/**
 * 通知命名空间（从 `preload/index.ts` 抽出来的第一块）。
 *
 * 为什么抽：渲染层的入口清单本来就该是一张细表，而 preload 是受保护接缝，**越薄越好**；
 * 更实际的理由是文件体积门禁——接缝文件不许随功能一起长，功能多了就该分文件。
 *
 * 这一块只有读写与两条订阅，**没有能凭空造通知的方法**：`submit` 不在渲染层，
 * 「谁可以产生一条通知」仍由主进程说了算（见 `notificationProducerBoundary.test.ts`）。
 */
export function createNotificationsNamespace(ipcRenderer: IpcRenderer) {
  return {
    list: (query?: unknown) => ipcRenderer.invoke(IpcChannels.notificationsList, query),
    /** 返回 `{ unread, version }`：角标只需一次调用；版本号随每次记录变化递增。 */
    getUnreadState: (input?: { productId?: string }) => ipcRenderer.invoke(IpcChannels.notificationsGetUnreadState, input),
    markRead: (id: string) => ipcRenderer.invoke(IpcChannels.notificationsMarkRead, { id }),
    /** 发送一条测试通知：走真实 `submit()`，验证链路与系统放行；每次点击都是一条新记录。 */
    sendTest: () => ipcRenderer.invoke(IpcChannels.notificationsSendTest),
    /** 清空 = 全部未读标为已读；返回 `{ unread, version }`，角标不必再查一次。 */
    markAllRead: (input?: { productId?: string }) => ipcRenderer.invoke(IpcChannels.notificationsMarkAllRead, input),
    acknowledge: (id: string) => ipcRenderer.invoke(IpcChannels.notificationsAcknowledge, { id }),
    /** 真删除已读记录；返回实际删掉的条数。**未读不受影响**，与 `markAllRead` 不是一回事。 */
    deleteRead: () => ipcRenderer.invoke(IpcChannels.notificationsDeleteRead),
    dismiss: (id: string) => ipcRenderer.invoke(IpcChannels.notificationsDismiss, { id }),
    snooze: (id: string, until: string) => ipcRenderer.invoke(IpcChannels.notificationsSnooze, { id, until }),
    /** 返回 `granted | denied | unknown`；**`unknown` 是常态**，UI 不许把 unknown 显示成「已授权」。 */
    readDesktopPermission: () => ipcRenderer.invoke(IpcChannels.notificationsReadDesktopPermission),
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
