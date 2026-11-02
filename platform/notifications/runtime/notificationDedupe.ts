import type { NotificationPriority } from '../contracts/notificationContracts'
import type { NotificationRecord } from '../contracts/notificationContracts'
import type { NotificationRequest } from '../contracts/notificationContracts'
import { isActiveNotification } from '../store/notificationStore'

/**
 * 合并目标 = **该键最近一条仍在保留期内的记录**（契约 §7.2），不是「数组里第一条」。
 *
 * 旧写法用 `records.find`：它能取到最近一条，完全依赖 runtime 每次都用
 * `[record, ...state.records]` 头插；有人改成追加或重排，就会静默并进已过期的旧行，
 * 而且不会有任何报错。同键两行（一旧一新）在 `condition` 类事件里是合法状态：
 * 窗口过期后新起一行，旧行留在中心不动。
 */
export function findActiveDuplicate(
  records: NotificationRecord[],
  request: NotificationRequest,
  now: string
): NotificationRecord | undefined {
  if (!request.dedupeKey) return undefined
  let newest: NotificationRecord | undefined
  for (const record of records) {
    if (record.dedupeKey !== request.dedupeKey || !isActiveNotification(record, now)) continue
    if (newest === undefined || record.createdAt > newest.createdAt) newest = record
  }
  return newest
}

export function shouldBypassThrottle(priority: NotificationPriority): boolean {
  return priority === 'urgent'
}
