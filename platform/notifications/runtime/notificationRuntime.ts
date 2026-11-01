import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { JsonFileStorage } from '../../storage/jsonFileStorage'
import {
  acknowledgeNotification,
  createDefaultNotificationStoreState,
  createNotificationFromRequest,
  dismissNotification,
  expireDueNotifications,
  isActiveNotification,
  markNotificationRead,
  mergeDuplicateNotification,
  normalizeNotificationStoreState,
  reactivateSnoozedNotifications,
  snoozeNotification,
  type NotificationStoreState
} from '../store/notificationStore'
import type {
  DesktopNotificationPermission,
  NotificationChannel,
  NotificationListPage,
  NotificationListQuery,
  NotificationRecord,
  NotificationRequest,
  NotificationRuntimeSettings,
  NotificationUnreadState,
  SafeNotificationRecord
} from '../contracts/notificationContracts'
import { toSafeNotificationRecord } from '../contracts/notificationContracts'
import { findActiveDuplicate } from '../runtime/notificationDedupe'
import { normalizeRequestedChannels, routeTransientDelivery, type DeliveryHooks, type NotificationClock } from '../runtime/notificationRouting'

export type NotificationStorage = JsonFileStorage<NotificationStoreState>

export function createNotificationJsonStorage(filePath: string): NotificationStorage {
  return {
    async read() {
      try {
        return normalizeNotificationStoreState(JSON.parse(await readFile(filePath, 'utf8')))
      } catch (error) {
        if (isMissingFileError(error)) return createDefaultNotificationStoreState()
        throw error
      }
    },
    async write(value) {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    }
  }
}

export type NotificationRuntimeDependencies = {
  storage: NotificationStorage
  getSettings: () => Promise<NotificationRuntimeSettings>
  /** 读者时区与当前时刻；免打扰窗口按它判断。**必传**：缺省成 UTC 会把「不知道」当成「用户在格林尼治」。 */
  clock: NotificationClock
  deliveryHooks?: DeliveryHooks
  /** 只有「系统能回答授没授权」时才给 granted/denied；查不到就返回 unknown，不许拿支持性冒充授权。 */
  readDesktopPermission?: () => Promise<DesktopNotificationPermission>
  /** 记录有任何变化（投递 / 标读 / 撤销 / 稍后 / 清理）时调用一次，载荷是递增的版本号。 */
  onChanged?: (change: { version: number }) => void
}

export function createNotificationRuntime(deps: NotificationRuntimeDependencies) {
  let cache: NotificationStoreState | null = null
  /** 进程内单调递增的变更版本：订阅方用它丢掉重复/乱序事件，重启后从 1 重新开始即可。 */
  let version = 0

  async function load(): Promise<NotificationStoreState> {
    if (cache) return cache
    const state = normalizeNotificationStoreState(await deps.storage.read())
    const now = new Date().toISOString()
    const normalized = {
      ...state,
      records: expireDueNotifications(reactivateSnoozedNotifications(state.records, now), now)
    }
    cache = normalized
    return normalized
  }

  async function persist(state: NotificationStoreState): Promise<void> {
    cache = state
    await deps.storage.write(state)
  }

  return {
    async initialize(): Promise<void> {
      await load()
    },

    async submit(request: NotificationRequest): Promise<SafeNotificationRecord> {
      const state = await load()
      const settings = await deps.getSettings()
      const now = new Date().toISOString()
      const duplicate = findActiveDuplicate(state.records, request, now)
      let record = duplicate
        ? mergeDuplicateNotification(duplicate, request, now)
        : createNotificationFromRequest(
            {
              ...request,
              requestedChannels: withCenterForDisruptiveChannels(request, normalizeRequestedChannels(request, settings, deps.clock))
            },
            now
          )

      const nextRecords = duplicate
        ? state.records.map((item: NotificationRecord) => (item.id === record.id ? record : item))
        : [record, ...state.records]

      await persist({ ...state, records: nextRecords })
      notifyChanged()

      if (!duplicate) {
        await routeTransientDelivery(record, settings, deps.deliveryHooks ?? {}, deps.clock)
      }

      return toSafeNotificationRecord(record)
    },

    /**
     * 分页列表。排序在这里做；游标是**键游标** `createdAt|id`。
     * 数组下标游标在「边翻边进新通知」时会让第 2 页重复第 1 页的末条——而这正是回看 30 天的核心场景。
     */
    async list(query: NotificationListQuery = {}): Promise<NotificationListPage> {
      const state = await load()
      const now = new Date().toISOString()
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
      const page = sorted.slice(start, end).map(toSafeNotificationRecord)
      const last = end > start ? sorted[end - 1] : undefined
      const nextCursor = end < sorted.length && last ? notificationCursorKey(last) : undefined
      return { items: page, nextCursor }
    },

    /** 角标状态：未读数 + 版本号。**不是**第二个函数：原来是单独一个 `getUnreadCount`，现在合成一个返回值。 */
    async getUnreadState(productId?: string): Promise<NotificationUnreadState> {
      const state = await load()
      const now = new Date().toISOString()
      const unread = state.records.filter(
        (record: NotificationRecord) =>
          record.state === 'unread' &&
          isActiveNotification(record, now) &&
          (!productId || record.productId === productId)
      ).length
      return { unread, version }
    },

    async markRead(id: string): Promise<SafeNotificationRecord> {
      return transition(id, (record) => markNotificationRead(record))
    },

    async acknowledge(id: string): Promise<SafeNotificationRecord> {
      return transition(id, (record) => acknowledgeNotification(record))
    },

    async dismiss(id: string): Promise<SafeNotificationRecord> {
      return transition(id, (record) => dismissNotification(record))
    },

    async snooze(id: string, until: string): Promise<SafeNotificationRecord> {
      if (until <= new Date().toISOString()) {
        throw new Error('Snooze time must be in the future.')
      }
      return transition(id, (record) => snoozeNotification(record, until))
    },

    async readDesktopPermission(): Promise<DesktopNotificationPermission> {
      if (deps.readDesktopPermission) {
        return deps.readDesktopPermission()
      }
      // 没有读法就是「不知道」，不是「被拒绝」，也不是「已授权」。
      return 'unknown'
    }
  }

  function notifyChanged(): void {
    version += 1
    const change = { version }
    try {
      deps.onChanged?.(change)
    } catch {
      // 广播失败不能回滚已经写入的记录：事件是提示，不是事实来源。
    }
  }

  async function transition(
    id: string,
    transform: (record: NotificationRecord) => NotificationRecord
  ): Promise<SafeNotificationRecord> {
    const state = await load()
    const index = state.records.findIndex((record: NotificationRecord) => record.id === id)
    if (index < 0) throw new Error(`Notification "${id}" was not found.`)

    const nextRecord = transform(state.records[index]!)
    const nextRecords = [...state.records]
    nextRecords[index] = nextRecord
    await persist({ ...state, records: nextRecords })
    notifyChanged()
    return toSafeNotificationRecord(nextRecord)
  }
}

export type NotificationRuntime = ReturnType<typeof createNotificationRuntime>

/**
 * 4a「中心必达」：只要这条通知会走任何一个打断式通道，`channels` 就必须含 `center`。
 * 归一化放在这里一处，**不靠四个生产者各自记得传**——靠调用点记得，等于有四个地方会忘。
 * 这条不为「要不要响」负责：免打扰和通道开关仍由路由决定，它只保证「响过的东西一定能回看」。
 */
function withCenterForDisruptiveChannels(
  request: NotificationRequest,
  channels: readonly NotificationChannel[]
): NotificationChannel[] {
  const disruptive = channels.some((channel) => channel === 'desktop' || channel === 'toast' || channel === 'popup')
  if (!disruptive || channels.includes('center')) return [...channels]
  return ['center', ...channels]
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

/** 未读优先时未读组在前；组内按 `createdAt` 倒序，同一毫秒用 `id` 兜底保证顺序稳定。 */
function compareNotifications(left: NotificationRecord, right: NotificationRecord, unreadFirst: boolean): number {
  if (unreadFirst) {
    const leftRank = left.state === 'unread' ? 0 : 1
    const rightRank = right.state === 'unread' ? 0 : 1
    if (leftRank !== rightRank) return leftRank - rightRank
  }
  if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1
  if (left.id === right.id) return 0
  return left.id < right.id ? 1 : -1
}

/** 键游标 `createdAt|id`：同一毫秒的多条各有不同 id，因此不会丢；也是排序位置，插入不影响已翻过的页。 */
function notificationCursorKey(record: NotificationRecord): string {
  return `${record.createdAt}|${record.id}`
}

/**
 * 从游标继续：找到那一条就从它之后开始；找不到（被删或被改状态移出本组）就按排序键
 * 取「排在游标之后」的第一条，**绝不退回数组下标**。
 */
function resumeIndex(sorted: readonly NotificationRecord[], cursor: string, unreadFirst: boolean): number {
  const exact = sorted.findIndex((record) => notificationCursorKey(record) === cursor)
  if (exact >= 0) return exact + 1

  const separator = cursor.lastIndexOf('|')
  if (separator <= 0) return 0
  const createdAtPart = cursor.slice(0, separator)
  const idPart = cursor.slice(separator + 1)
  const index = sorted.findIndex((record) => {
    if (record.createdAt !== createdAtPart) return record.createdAt > createdAtPart
    return record.id > idPart
  })
  return index < 0 ? sorted.length : index
}
