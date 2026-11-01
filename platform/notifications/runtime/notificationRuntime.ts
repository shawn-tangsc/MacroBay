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
  NotificationListPage,
  NotificationListQuery,
  NotificationRecord,
  NotificationRequest,
  NotificationRuntimeSettings,
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
}

export function createNotificationRuntime(deps: NotificationRuntimeDependencies) {
  let cache: NotificationStoreState | null = null

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
              requestedChannels: normalizeRequestedChannels(request, settings, deps.clock)
            },
            now
          )

      const nextRecords = duplicate
        ? state.records.map((item: NotificationRecord) => (item.id === record.id ? record : item))
        : [record, ...state.records]

      await persist({ ...state, records: nextRecords })

      if (!duplicate) {
        await routeTransientDelivery(record, settings, deps.deliveryHooks ?? {}, deps.clock)
      }

      return toSafeNotificationRecord(record)
    },

    async list(query: NotificationListQuery = {}): Promise<NotificationListPage> {
      const state = await load()
      const now = new Date().toISOString()
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
      const allowedStates = query.state?.length ? new Set(query.state) : null

      const filtered = state.records.filter((record: NotificationRecord) => {
        if (query.productId && record.productId !== query.productId) return false
        if (allowedStates && !allowedStates.has(record.state)) return false
        if (!allowedStates && !isActiveNotification(record, now) && record.state !== 'read' && record.state !== 'acknowledged') {
          return false
        }
        return true
      })

      const startIndex = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0
      const page = filtered.slice(startIndex, startIndex + limit).map(toSafeNotificationRecord)
      const nextCursor = startIndex + limit < filtered.length ? String(startIndex + limit) : undefined
      return { items: page, nextCursor }
    },

    async getUnreadCount(productId?: string): Promise<number> {
      const state = await load()
      const now = new Date().toISOString()
      return state.records.filter(
        (record: NotificationRecord) =>
          record.state === 'unread' &&
          isActiveNotification(record, now) &&
          (!productId || record.productId === productId)
      ).length
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
    return toSafeNotificationRecord(nextRecord)
  }
}

export type NotificationRuntime = ReturnType<typeof createNotificationRuntime>

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}
