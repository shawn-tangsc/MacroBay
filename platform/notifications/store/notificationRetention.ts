import type { NotificationRecord } from '../contracts/notificationContracts'

/**
 * 通知保留期与容量上限。
 *
 * 两件事必须同时成立，否则 JSON 文件只增不减：
 * - **时间上限**：`createdAt` 早于保留期的记录被删；设置值可调，但上调不得超过 90 天，
 *   否则「保留 30 天」这句承诺就随用户改设置失效。
 * - **条数上限**：超过条数时从最旧的一端删（先到先删），防止一条高频来源把文件撑大。
 */
export const notificationRetentionPolicy = Object.freeze({
  defaultRetentionDays: 30,
  maxRetentionDays: 90,
  maxRecords: 500
})

export type NotificationRetentionInput = Readonly<{
  retentionDays?: number
  maxRecords?: number
  now?: string
}>

export type NotificationRetentionResult = Readonly<{
  records: NotificationRecord[]
  removedByAge: number
  removedByCount: number
}>

/** 保留天数只接受正整数，且不得超过上限；非法值回落到默认，而不是让清理变成「永不删」。 */
export function clampNotificationRetentionDays(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return notificationRetentionPolicy.defaultRetentionDays
  return Math.min(Math.floor(value as number), notificationRetentionPolicy.maxRetentionDays)
}

export function clampNotificationMaxRecords(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return notificationRetentionPolicy.maxRecords
  return Math.max(1, Math.floor(value as number))
}

/**
 * 按时间与条数裁剪记录。纯函数：不读写存储，便于用超大输入直接验边界。
 *
 * `createdAt` 无法解析的记录一律保留——删掉一条读不出年龄的记录，比留一条旧记录更糟，
 * 因为它可能是唯一能证明「这里出过事」的那条。
 */
export function pruneNotificationRecords(
  records: readonly NotificationRecord[],
  input: NotificationRetentionInput = {}
): NotificationRetentionResult {
  const now = input.now ?? new Date().toISOString()
  const nowMs = Date.parse(now)
  const retentionDays = clampNotificationRetentionDays(input.retentionDays)
  const maxRecords = clampNotificationMaxRecords(input.maxRecords)

  if (!Number.isFinite(nowMs)) {
    return { records: [...records], removedByAge: 0, removedByCount: 0 }
  }

  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000
  const kept: NotificationRecord[] = []
  let removedByAge = 0

  for (const record of records) {
    const createdAtMs = Date.parse(record.createdAt)
    if (Number.isFinite(createdAtMs) && createdAtMs < cutoffMs) {
      removedByAge += 1
      continue
    }
    kept.push(record)
  }

  if (kept.length <= maxRecords) {
    return { records: kept, removedByAge, removedByCount: 0 }
  }

  // 先到先删：保留 createdAt 最新的 maxRecords 条；同一时刻按 id 排序，保证结果稳定。
  const ordered = [...kept].sort((left, right) => {
    const byTime = Date.parse(right.createdAt) - Date.parse(left.createdAt)
    return byTime !== 0 ? byTime : right.id.localeCompare(left.id)
  })
  const newest = ordered.slice(0, maxRecords)
  const keepIds = new Set(newest.map((record) => record.id))
  const trimmed = kept.filter((record) => keepIds.has(record.id))

  return {
    records: trimmed,
    removedByAge,
    removedByCount: kept.length - trimmed.length
  }
}
