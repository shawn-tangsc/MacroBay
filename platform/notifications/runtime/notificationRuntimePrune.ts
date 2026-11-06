/**
 * 保留期清理：按天数 + 条数剪记录，同时丢掉窗口外的计数桶。
 *
 * 清理任务（`@platform/jobs`）与启动恢复都只调这一处，避免两条清理路径各剪一半。
 * **不碰** `providerCredentialHealth`：那是判定状态，不是记录，清记录时不能顺手清掉它。
 */
import { pruneNotificationDailyCounters } from './notificationBreaker'
import { pruneNotificationRecords } from '../store/notificationRetention'
import type { NotificationStoreState } from '../store/notificationStore'

export async function pruneNotificationState(deps: {
  load: () => Promise<NotificationStoreState>
  retentionDays: () => Promise<number>
  persist: (state: NotificationStoreState) => Promise<void>
  notifyChanged: () => void
  exclusive: <T>(operation: () => Promise<T>) => Promise<T>
  now: () => string
}): Promise<{ removedRecords: number; removedCounters: number }> {
  return deps.exclusive(async () => {
    const state = await deps.load()
    const now = deps.now()
    const pruned = pruneNotificationRecords(state.records, {
      retentionDays: await deps.retentionDays(),
      now
    })
    const counters = pruneNotificationDailyCounters(state.dailyCounters ?? {}, now)
    const removedCounters = Object.keys(state.dailyCounters ?? {}).length - Object.keys(counters).length
    const removedRecords = state.records.length - pruned.records.length
    if (removedRecords === 0 && removedCounters === 0) return { removedRecords: 0, removedCounters: 0 }
    await deps.persist({ ...state, records: pruned.records, dailyCounters: counters })
    deps.notifyChanged()
    return { removedRecords, removedCounters }
  })
}
