import { readJsonFileRecovering, writeJsonFileAtomically } from '../../storage/jsonFileStorage'
import type { JsonFileStorage } from '../../storage/jsonFileStorage'
import {
  createDefaultNotificationStoreState,
  normalizeNotificationRecordsWithReport,
  normalizeNotificationStoreState,
  type NotificationStoreState
} from '../store/notificationStore'

/**
 * 通知状态的**文件存储**：整份读—改—写的那一端。
 *
 * 为什么单列一个文件（2026-11-08，运行时越过 500 行之后抽出来的）：这里回答的问题是
 * 「磁盘上那份 JSON 怎么读回来、怎么写回去」，与运行时怎么判提交、怎么投递是两件事；
 * 混在一起时，读文件的容错策略会被当成运行时行为的一部分去改。
 */
export type NotificationStorage = JsonFileStorage<NotificationStoreState>

export function createNotificationJsonStorage(filePath: string): NotificationStorage {
  return {
    /**
     * 读回整份状态。**走恢复读**：这一份 JSON 是整份读—改—写的目标，历史上被写成过
     * 「完整文档 + 上一版残片」；裸 `JSON.parse` 会把这种文件变成启动期的未处理拒绝，
     * 而 `readJsonFileRecovering` 会取回最长可解析前缀、留一份 `.corrupt-*` 再把干净内容写回。
     *
     * 文件不存在（首次启动）仍然是默认态，不当作损坏。
     */
    async read() {
      const value = await readJsonFileRecovering(filePath)
      if (value === undefined) return createDefaultNotificationStoreState()
      const state = normalizeNotificationStoreState(value)
      // 丢记录**不许静默**：条数与原因分类各报一次（静默丢过一次真数据：计数器 13 条、库里 4 条）。
      const report = normalizeNotificationRecordsWithReport((value as { records?: unknown }).records)
      if (report.dropped.length > 0) {
        const reasons = report.dropped.reduce<Record<string, number>>((acc, reason) => ({ ...acc, [reason]: (acc[reason] ?? 0) + 1 }), {})
        console.log(JSON.stringify({ marker: 'notification.records-dropped', count: report.dropped.length, reasons }))
      }
      return state
    },
    async write(value) {
      await writeJsonFileAtomically(filePath, value)
    }
  }
}
