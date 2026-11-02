/**
 * runtime 的读取面（runtime §3）：未读数、排序、键游标。
 *
 * 拆出来是为了让 `notificationRuntime.ts` 保持在体积门禁之下；这些函数是纯的，
 * 只依赖记录数组与「现在」，没有文件、没有时钟对象。
 */
import { isActiveNotification } from '../store/notificationStore'
import type { NotificationRecord, NotificationUnreadState } from '../contracts/notificationContracts'

/** 未读数与版本的唯一算法：角标、清空、事件三处读同一个结果。 */
export function unreadStateOf(
  records: readonly NotificationRecord[],
  now: string,
  productId: string | undefined,
  version: number
): NotificationUnreadState {
  const unread = records.filter(
    (record) =>
      record.state === 'unread' &&
      isActiveNotification(record, now) &&
      (!productId || record.productId === productId)
  ).length
  return { unread, version }
}

/** 未读优先时未读组在前；组内按 `createdAt` 倒序，同一毫秒用 `id` 兜底保证顺序稳定。 */
export function compareNotifications(left: NotificationRecord, right: NotificationRecord, unreadFirst: boolean): number {
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
export function notificationCursorKey(record: NotificationRecord): string {
  return `${record.createdAt}|${record.id}`
}

/**
 * 从游标继续：找到那一条就从它之后开始；找不到（被删或被改状态移出本组）就按排序键
 * 取「排在游标之后」的第一条，**绝不退回数组下标**。
 */
export function resumeIndex(sorted: readonly NotificationRecord[], cursor: string, unreadFirst: boolean): number {
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
