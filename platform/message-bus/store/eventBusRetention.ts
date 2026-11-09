import type { EventBusStoreState } from './eventBusStore'
import type { PlatformEventCheckpoint } from '../contracts/eventBusContracts'

/**
 * 事件总线的保留期（`MI-11-R16`：写侧原先无上限）。
 *
 * 读数（2026-11-09，本机真实文件）：2,953 条事件 / 654 条投递 / 2.63 MiB，17.8 天里平均
 * **174 条、168 KiB/天**；按这个速率 90 天会到 **17.6 MiB**，而每次启动都要整份读、整份写回。
 *
 * 双上限**先到先裁**：
 * - **30 天**（按 `recordedAt`）：日常速率下约 5,220 条，时间先挡；
 * - **5,000 条**：突发爆量时条数先挡。
 *
 * 稳态体积约 **5.0–5.5 MiB**（5,000 × ≈934 B + 终态投递），到顶后不再增长。
 *
 * **没有被上限约束的两类**：`pending` 投递以及它们引用的事件——重启后靠这些投递重放，
 * 裁掉就等于丢事件；因此当 pending 本身超过 5,000 条时，实际条数会超过上限，这是有意的优先级。
 * checkpoint 每个 consumer 只留最新一条。
 */
export const eventBusRetentionPolicy = Object.freeze({
  retentionDays: 30,
  maxEvents: 5_000
})

export type EventBusRetentionOptions = Readonly<{
  now?: string
  retentionDays?: number
  maxEvents?: number
}>

export type EventBusRetentionResult = Readonly<{
  state: EventBusStoreState
  removedEvents: number
  removedDeliveries: number
}>

export function clampEventBusRetentionDays(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return eventBusRetentionPolicy.retentionDays
  return Math.min(Math.floor(value as number), 365)
}

export function clampEventBusMaxEvents(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) <= 0) return eventBusRetentionPolicy.maxEvents
  return Math.max(1, Math.floor(value as number))
}

/**
 * 纯函数：给定的状态裁到保留窗口内。**幂等**——对结果再跑一次删 0 条、状态不变。
 *
 * 顺序：
 * 1. `pending` 投递引用的事件一律保留（钉住集合），不受时间与条数约束；
 * 2. 其余事件先按 `recordedAt` 过时间窗，再按「最新优先」保留到 `maxEvents - 钉住数`；
 *    时间解析不出的事件**保留**——删一条读不出时间的记录，比留一条旧记录更糟；
 * 3. 投递随事件走：事件不在则投递删除；`pending` 投递始终保留（正常路径第 1 步已钉住）；
 * 4. checkpoint 每个 consumer 只留 `updatedAt` 最新的一条。
 *
 * 输出保持输入原顺序，列表页读到的前后关系不会因为裁剪被打乱。
 */
export function pruneEventBusState(
  state: EventBusStoreState,
  options: EventBusRetentionOptions = {}
): EventBusRetentionResult {
  const nowMs = Date.parse(options.now ?? new Date().toISOString())
  if (!Number.isFinite(nowMs)) {
    // 时钟坏了就不裁：按一个读不出的「现在」删数据，比不裁更危险。
    return { state, removedEvents: 0, removedDeliveries: 0 }
  }

  const retentionDays = clampEventBusRetentionDays(options.retentionDays)
  const maxEvents = clampEventBusMaxEvents(options.maxEvents)
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000

  const pinnedEventIds = new Set(
    state.deliveries.filter((delivery) => delivery.status === 'pending').map((delivery) => delivery.eventId)
  )

  // 非钉住事件按「新→旧」排序，取前若干条；时间解析不出的保留。
  const candidates = state.events
    .filter((event) => !pinnedEventIds.has(event.eventId))
    .map((event) => ({ event, at: Date.parse(event.recordedAt) }))
    .filter((entry) => !Number.isFinite(entry.at) || entry.at >= cutoffMs)
  const budget = Math.max(0, maxEvents - pinnedEventIds.size)
  const keptCandidateIds = new Set(
    [...candidates]
      .sort((left, right) => (right.at || 0) - (left.at || 0))
      .slice(0, budget)
      .map((entry) => entry.event.eventId)
  )

  const events = state.events.filter(
    (event) => pinnedEventIds.has(event.eventId) || keptCandidateIds.has(event.eventId)
  )
  const keptEventIds = new Set(events.map((event) => event.eventId))
  const deliveries = state.deliveries.filter(
    (delivery) => delivery.status === 'pending' || keptEventIds.has(delivery.eventId)
  )

  return {
    state: {
      events,
      deliveries,
      checkpoints: latestCheckpointPerConsumer(state.checkpoints)
    },
    removedEvents: state.events.length - events.length,
    removedDeliveries: state.deliveries.length - deliveries.length
  }
}

/** 每个 consumer 只留 `updatedAt` 最新的一条；顺序按首次出现，避免同一 consumer 反复换位。 */
function latestCheckpointPerConsumer(checkpoints: readonly PlatformEventCheckpoint[]): PlatformEventCheckpoint[] {
  const winners = new Map<string, PlatformEventCheckpoint>()
  for (const checkpoint of checkpoints) {
    const current = winners.get(checkpoint.consumerId)
    if (!current || checkpoint.updatedAt > current.updatedAt) winners.set(checkpoint.consumerId, checkpoint)
  }
  const seen = new Set<string>()
  const kept: PlatformEventCheckpoint[] = []
  for (const checkpoint of checkpoints) {
    if (seen.has(checkpoint.consumerId)) continue
    seen.add(checkpoint.consumerId)
    kept.push(winners.get(checkpoint.consumerId)!)
  }
  return kept
}
