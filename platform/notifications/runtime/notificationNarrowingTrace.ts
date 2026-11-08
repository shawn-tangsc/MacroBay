import type { NotificationDiagnosticsSink, NotificationRecord } from '../contracts/notificationContracts'
import type { NotificationApprovedLevel } from '../contracts/notificationEventCatalog'

/**
 * 「同一键的第二次提交想比**首次定档**更宽」的留痕。
 *
 * 按第一次定档，是合并的既有规则（不升级）；但生产者会遇到「我传了全档为什么只进中心」而毫无线索，
 * 所以要记**恰好一条**。
 *
 * 比较用 `duplicate.appliedLevels`（首次定档的快照）。老记录没有它时按面推断一次——**那是兼容用的
 * 推断，不是权威**：`channels` 只有 center 时，分不清是「调用方收窄」还是「免打扰/读者关闭摘掉」，
 * 所以新记录一律以 `appliedLevels` 为准，这个兜底只为不让老数据炸掉。
 */
export function reportNarrowingWidened(input: Readonly<{
  duplicate: NotificationRecord
  levels: readonly NotificationApprovedLevel[]
  eventTypeId: string
  diagnostics: NotificationDiagnosticsSink
  at: string
}>): void {
  const applied = input.duplicate.appliedLevels
    ?? [...input.duplicate.channels, ...(input.duplicate.delivery.push === undefined ? [] : ['channel' as const])]
  if (!input.levels.some((level) => !applied.includes(level))) return
  input.diagnostics({ code: 'narrowing-widened', at: input.at, eventTypeId: input.eventTypeId })
}
