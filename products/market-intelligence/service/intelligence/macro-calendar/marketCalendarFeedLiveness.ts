import type { DatabaseSync } from 'node:sqlite'

import { calendarFeedRegistry } from './calendarFeedRegistry'

/**
 * 「这条源还在出数吗」——只看**采集批次**，不看事件本身。
 *
 * 为什么不能用事件上的时刻判：`sourceObservedAt` 是「来源最后一次给出**这一条**」的时刻。
 * 翻到一个几年前的月份，那些行的时刻当然很旧，按它判会把每一个历史月份都写成「已停止出数」。
 * 采集批次回答的是另一个问题——「我们这边，这条源最近一次成功采到东西是什么时候」。
 * 2026-11-16 那次事故就是这个问题从来没被回答：Narwhal 自 11-13T13:20Z 之后再没产出，
 * 而界面一路显示正常，直到读者拿着错的预期值（10，实际 18）来问。
 *
 * 「停止」的判据是**错过几个自己的采集周期**，不是写死一个钟头数：不同源的排期差一个数量级
 * （官方 6 小时、市场源 30 分钟），同一个数字套在两处必然一边过敏一边失灵。
 */
export const calendarFeedLivenessPolicy = Object.freeze({
  /** 连续错过这么多个自己的周期就判「已停止出数」。 */
  silentAfterIntervals: 3
})

export type CalendarFeedLiveness = Readonly<{
  feedId: string
  /** 最近一次**成功**采集批次的时刻；从未成功过就是 `null`（那是「没跑过」，不是「停过」）。 */
  lastBatchAt: string | null
  /** 连续错过 N 个自己的周期。`lastBatchAt` 为 `null` 时恒为 `false`：没跑过与停下来是两件事。 */
  silent: boolean
}>

/**
 * 每个 provider 最近一次成功采集批次的时刻（`detected_at` 的最大值）。
 *
 * 读的是采集批次表，不是标准表：一条源「采到了但这次没有新发布」也会留下成功批次，
 * 而标准表没有新行——两者混用，安静的周末就会被读成「停止出数」。
 */
export function readProviderLastBatches(database: DatabaseSync): ReadonlyMap<string, string> {
  const batches = new Map<string, string>()
  try {
    const rows = database.prepare(
      `select provider_id as providerId, max(detected_at) as at
         from mi_macro_calendar_market_event_collections
        where status = 'success' and detected_at is not null
        group by provider_id`
    ).all() as unknown as readonly { providerId: string; at: string | null }[]
    for (const row of rows) {
      if (typeof row.providerId === 'string' && typeof row.at === 'string') batches.set(row.providerId, row.at)
    }
  } catch {
    // 表还没建（新库）：一条批次都没有，调用方据此什么都不判——不是「全都停了」。
    return batches
  }
  return batches
}

/**
 * 一条 feed 的出数状态。
 *
 * `lastBatchAt` 为 `null` 有两种来路，这里都不判「停止」：这条源从来没成功过（没跑过），
 * 或者我们根本读不到它的批次（表不存在）。判据只在**确实有过成功批次**之后才成立。
 */
export function feedLiveness(input: Readonly<{
  feedId: string
  providerId: string
  /** 这条源自己的采集周期；缺省取注册表里第一条能回答这个 provider 的排期。 */
  intervalSeconds?: number
  batches: ReadonlyMap<string, string>
  asOf: string
}>): CalendarFeedLiveness {
  const lastBatchAt = input.batches.get(input.providerId) ?? null
  const interval = input.intervalSeconds ?? providerIntervalSeconds(input.providerId)
  const asOfMs = Date.parse(input.asOf)
  const lastMs = lastBatchAt === null ? Number.NaN : Date.parse(lastBatchAt)
  const silent = Number.isFinite(asOfMs) && Number.isFinite(lastMs) && interval !== undefined
    && asOfMs - lastMs > interval * 1000 * calendarFeedLivenessPolicy.silentAfterIntervals
  return { feedId: input.feedId, lastBatchAt, silent }
}

/** 注册表里这个 provider 的采集周期；一条都没有（例如只登记不采的源）就给 `undefined`，不猜。 */
export function providerIntervalSeconds(providerId: string): number | undefined {
  for (const feed of Object.values(calendarFeedRegistry)) {
    if (feed.providerId !== providerId) continue
    const interval = feed.schedule?.intervalSeconds
    if (typeof interval === 'number' && interval > 0) return interval
  }
  return undefined
}
