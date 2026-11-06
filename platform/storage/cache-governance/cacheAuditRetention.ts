import type { CacheOperationAuditRecord } from './cacheContracts'

/**
 * 缓存操作审计的保留期（`MI-11-R16` 剩的那一项）。
 *
 * 这张表原来**只增不减**：`CacheOperationAuditRepository` 里只有 insert、select 和建表，没有
 * 任何 delete，所以每一次「清理 / 压缩 / 重新检查」都会留下一条永久记录。它记的是**用户做过的
 * 动作**，不是缓存内容本身，因此按时间与条数双重上限裁剪——和通知记录同一套形状，不另立一套。
 *
 * 为什么是 90 天 / 1000 条：界面上最近 20 条一页，1000 条约等于 50 页历史；缓存操作是低频
 * 动作（一次点击一条），90 天足够回答「上周是不是清过这个库」。两条上限**先到先删**，任何
 * 一条单独生效都不会让表无限长。
 */
export const cacheAuditRetentionPolicy = Object.freeze({
  defaultRetentionDays: 90,
  maxRetentionDays: 365,
  maxRecords: 1_000
})

export type CacheAuditRetentionInput = Readonly<{
  retentionDays?: number
  maxRecords?: number
  now?: string
}>

export type CacheAuditRetentionResult = Readonly<{
  records: CacheOperationAuditRecord[]
  removedByAge: number
  removedByCount: number
}>

/** 保留天数只接受正整数，且不超过上限；非法值回落到默认，而不是让清理变成「永不删」。 */
export function clampCacheAuditRetentionDays(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return cacheAuditRetentionPolicy.defaultRetentionDays
  return Math.min(Math.floor(value as number), cacheAuditRetentionPolicy.maxRetentionDays)
}

export function clampCacheAuditMaxRecords(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return cacheAuditRetentionPolicy.maxRecords
  return Math.max(1, Math.floor(value as number))
}

/**
 * 按时间与条数裁剪审计记录。纯函数：不读写存储，边界可以直接用超大输入验。
 *
 * `requestedAt` 解析不出的记录一律保留——删掉一条读不出时间的审计记录，比留一条旧记录更糟，
 * 因为它可能是唯一能证明「这里出过事」的那一条。
 *
 * 顺序与列表一致（`requested_at desc, operation_id desc`），所以「先到先删」删的正是列表最底部
 * 那几条，用户不会看到中间的记录莫名消失。
 */
export function pruneCacheAuditRecords(
  records: readonly CacheOperationAuditRecord[],
  input: CacheAuditRetentionInput = {}
): CacheAuditRetentionResult {
  const now = input.now ?? new Date().toISOString()
  const nowMs = Date.parse(now)
  const retentionDays = clampCacheAuditRetentionDays(input.retentionDays)
  const maxRecords = clampCacheAuditMaxRecords(input.maxRecords)

  if (!Number.isFinite(nowMs)) {
    return { records: [...records], removedByAge: 0, removedByCount: 0 }
  }

  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000
  const kept: CacheOperationAuditRecord[] = []
  let removedByAge = 0

  for (const record of records) {
    const requestedAtMs = Date.parse(record.requestedAt)
    if (Number.isFinite(requestedAtMs) && requestedAtMs < cutoffMs) {
      removedByAge += 1
      continue
    }
    kept.push(record)
  }

  if (kept.length <= maxRecords) {
    return { records: kept, removedByAge, removedByCount: 0 }
  }

  const ordered = [...kept].sort((left, right) => {
    const byTime = Date.parse(right.requestedAt) - Date.parse(left.requestedAt)
    if (Number.isFinite(byTime) && byTime !== 0) return byTime
    return right.operationId.localeCompare(left.operationId)
  })

  return {
    records: ordered.slice(0, maxRecords),
    removedByAge,
    removedByCount: kept.length - maxRecords
  }
}
