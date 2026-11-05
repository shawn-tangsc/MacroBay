/**
 * runtime 的**读者侧读写面**：列表、未读、清空、删除已读、单条状态迁移、桌面权限。
 *
 * 拆出来的理由与 `notificationRuntimeQuery.ts` 同一条——文件体积门禁只降不升，而这一段是
 * 自成一体的职责：它只碰「读者对记录做了什么」与「读者看到了什么」，不碰提交、熔断、投递、
 * 剪枝。运行时那边只把它拼进返回对象，不再自己长。
 *
 * 一条纪律贯穿这个文件：**渲染层拿到的永远是句子**。所以每次读都要过 `centerItem`（主进程投影），
 * 不在这里另拼一份，否则横幅与中心会出现两种说法。
 */
import type {
  DesktopNotificationPermission,
  NotificationCenterItem,
  NotificationListPage,
  NotificationListQuery,
  NotificationRecord,
  NotificationUnreadState
} from '../contracts/notificationContracts'
import type { NotificationCopyLanguage } from '../../i18n/notificationCopy'
import {
  acknowledgeNotification,
  dismissNotification,
  isActiveNotification,
  markNotificationRead,
  snoozeNotification,
  type NotificationStoreState
} from '../store/notificationStore'
import type { NotificationDeliveryContent } from './notificationRouting'
import {
  compareNotifications,
  notificationCursorKey,
  resumeIndex,
  unreadStateOf
} from './notificationRuntimeQuery'

export type NotificationReadSurfaceInput = {
  load: () => Promise<NotificationStoreState>
  exclusive: <T>(task: () => Promise<T>) => Promise<T>
  persist: (state: NotificationStoreState) => Promise<void>
  notifyChanged: () => void
  /** 当前版本号：只在 `getUnreadState` 里进返回值，让订阅方能判断「是不是比上次新」。 */
  version: () => number
  nowIso: () => string
  /** 记录 → 渲染层那一份（句子已解析，键留在主进程）。 */
  centerItem: (record: NotificationRecord, content?: NotificationDeliveryContent) => Promise<NotificationCenterItem>
  /** 正文解析：列表一次读一页，语言由调用方取一次。 */
  resolveContent: (record: NotificationRecord, language?: NotificationCopyLanguage) => Promise<NotificationDeliveryContent>
  getLanguage?: () => Promise<NotificationCopyLanguage>
  readDesktopPermission?: () => Promise<DesktopNotificationPermission>
}

export function composeNotificationReadSurface(input: NotificationReadSurfaceInput) {
  /**
   * 分页列表。排序在查询模块里做；游标是**键游标** `createdAt|id`。
   * 数组下标游标在「边翻边进新通知」时会让第 2 页重复第 1 页的末条——而这正是回看 30 天的核心场景。
   */
  async function list(query: NotificationListQuery = {}): Promise<NotificationListPage> {
    const state = await input.load()
    const now = input.nowIso()
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
    const allowedStates = query.state?.length ? new Set(query.state) : null
    const unreadFirst = query.unreadFirst === true

    const filtered = state.records.filter((record: NotificationRecord) => {
      if (query.productId && record.productId !== query.productId) return false
      if (allowedStates && !allowedStates.has(record.state)) return false
      if (!allowedStates && !isActiveNotification(record, now) && record.state !== 'read' && record.state !== 'acknowledged') {
        return false
      }
      return true
    })

    const sorted = [...filtered].sort((left, right) => compareNotifications(left, right, unreadFirst))
    const start = query.cursor ? resumeIndex(sorted, query.cursor, unreadFirst) : 0
    const end = Math.min(start + limit, sorted.length)
    // 一整页只读一次语言：每条读一次设置，同屏就可能出现两种语言。
    const language = await input.getLanguage?.()
    const page = await Promise.all(
      sorted.slice(start, end).map(async (record) =>
        input.centerItem(record, await input.resolveContent(record, language))
      )
    )
    const last = end > start ? sorted[end - 1] : undefined
    const nextCursor = end < sorted.length && last ? notificationCursorKey(last) : undefined
    return { items: page, nextCursor }
  }

  /** 角标状态：未读数 + 版本号。**不是**第二个函数：原来是单独一个 `getUnreadCount`，现在合成一个返回值。 */
  async function getUnreadState(productId?: string): Promise<NotificationUnreadState> {
    const state = await input.load()
    return unreadStateOf(state.records, input.nowIso(), productId, input.version())
  }

  /**
   * 「清空」= 全部未读标为已读，**不是删除**（用户 11-01 定的口径）。
   *
   * 一次落盘、一次广播：前端绝不能拿列表逐条 `markRead` —— 翻到第 120 条就是 120 次 IPC，
   * 中间失败会留下「标了一半」的状态。范围是**全部未读**，不是「当前页」：
   * 只清当前页会让角标残留，用户会以为没生效。幂等：没有未读时返回 0，不报错。
   */
  async function markAllRead(productId?: string): Promise<NotificationUnreadState> {
    return input.exclusive(async () => {
      const state = await input.load()
      const now = input.nowIso()
      let changed = false
      const records = state.records.map((record: NotificationRecord) => {
        if (record.state !== 'unread') return record
        if (productId && record.productId !== productId) return record
        changed = true
        return markNotificationRead(record, now)
      })
      if (changed) {
        await input.persist({ ...state, records })
        input.notifyChanged()
      }
      return unreadStateOf(records, now, productId, input.version())
    })
  }

  /**
   * 删除**已读**记录（不是清空、不是单条收起）。三件事必须分清：
   * 清空 = 全部标已读（`markAllRead`），单条收起 = 状态迁移（`dismiss`），这里才是真删。
   *
   * 口径（架构师 2026-11-02 裁定）：只删 `state === 'read'`，未读一条不动；**不整批失败**——
   * 部分能删就返回实际删掉的条数；删完必须走一次 `notifyChanged()`，否则角标不清零，
   * 用户会看到「删了但数字还在」。计数桶与保留期剪枝都不受影响。
   */
  async function deleteRead(): Promise<{ deleted: number }> {
    return input.exclusive(async () => {
      const state = await input.load()
      const kept = state.records.filter((record: NotificationRecord) => record.state !== 'read')
      const deleted = state.records.length - kept.length
      if (deleted === 0) return { deleted: 0 }
      await input.persist({ ...state, records: kept })
      input.notifyChanged()
      return { deleted }
    })
  }

  async function transition(
    id: string,
    transform: (record: NotificationRecord) => NotificationRecord
  ): Promise<NotificationCenterItem> {
    return input.exclusive(async () => {
      const state = await input.load()
      const index = state.records.findIndex((record: NotificationRecord) => record.id === id)
      if (index < 0) throw new Error(`Notification "${id}" was not found.`)

      const nextRecord = transform(state.records[index]!)
      const nextRecords = [...state.records]
      nextRecords[index] = nextRecord
      await input.persist({ ...state, records: nextRecords })
      input.notifyChanged()
      return input.centerItem(nextRecord)
    })
  }

  async function readDesktopPermission(): Promise<DesktopNotificationPermission> {
    if (input.readDesktopPermission) {
      return input.readDesktopPermission()
    }
    // 没有读法就是「不知道」，不是「被拒绝」，也不是「已授权」。
    return 'unknown'
  }

  return {
    list,
    getUnreadState,
    markAllRead,
    deleteRead,
    markRead: (id: string): Promise<NotificationCenterItem> =>
      transition(id, (record) => markNotificationRead(record)),
    acknowledge: (id: string): Promise<NotificationCenterItem> =>
      transition(id, (record) => acknowledgeNotification(record)),
    dismiss: (id: string): Promise<NotificationCenterItem> =>
      transition(id, (record) => dismissNotification(record)),
    snooze: (id: string, until: string): Promise<NotificationCenterItem> => {
      if (until <= input.nowIso()) {
        throw new Error('Snooze time must be in the future.')
      }
      return transition(id, (record) => snoozeNotification(record, until))
    },
    readDesktopPermission
  }
}

export type NotificationReadSurface = ReturnType<typeof composeNotificationReadSurface>
