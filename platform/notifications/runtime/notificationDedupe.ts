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
  now: string,
  /**
   * `condition` 事件的**滚动窗口**（毫秒）。给了它，只有「最近一次更新还在窗口内」的记录才算合并目标；
   * 窗口外的同键记录留在中心不动，这次提交开新行。
   *
   * 这是「键里不带时间」之后必须有的另一半：键说「这是同一件事」，窗口说「还在同一个时段里吗」。
   * 少任何一半都不成立——只有键，第二天的读数会并进昨天的记录（读者看到「昨天的旧读数 + 今天的次数」）；
   * 只有窗口，没有稳定的键，同一时段会被拆成好几条。
   */
  conditionWindowMs?: number
): NotificationRecord | undefined {
  if (!request.dedupeKey) return undefined
  const nowMs = Date.parse(now)
  let newest: NotificationRecord | undefined
  for (const record of records) {
    if (record.dedupeKey !== request.dedupeKey || !isActiveNotification(record, now)) continue
    if (conditionWindowMs !== undefined) {
      const updatedMs = Date.parse(record.updatedAt)
      // 时间戳读不出来就当作窗口外：宁可开新行，也不把两天的事并成一条。
      if (!Number.isFinite(updatedMs) || nowMs - updatedMs > conditionWindowMs) continue
    }
    if (newest === undefined || record.createdAt > newest.createdAt) newest = record
  }
  return newest
}

export function shouldBypassThrottle(priority: NotificationPriority): boolean {
  return priority === 'urgent'
}
