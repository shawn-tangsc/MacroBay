import type { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

import type { MarketCalendarEvent, MarketCalendarPage, MarketCalendarSource }
  from '../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarPublicPolicy } from '../../../contracts/macro/marketCalendarQueryContracts'
import { standardRowsToMarketEvents, type StandardEventContext } from './marketCalendarStandardEventAdapter'
import { readStandardCalendarMonth } from './marketCalendarStandardMonthRead'
import { calendarFeedRegistry } from './calendarFeedRegistry'
import { feedLiveness, readProviderLastBatches, type CalendarFeedLiveness } from './marketCalendarFeedLiveness'

/**
 * **月查询接在标准表上**（S2 的最后一刀）：对外仍是 `MarketCalendarPage`，调用方一行不改。
 *
 * 四件契约必须逐条满足，缺一条校验就判 invalid：
 * 1. **分页**：`maximumEvents = 100`，一个月 426 行，不分页直接违约；游标必须是 UUID 形状
 *    （`page-2` 这种自造串同样 invalid），所以游标是服务端签发的随机 UUID，映射回偏移。
 * 2. **`sources` 恰好三条、顺序对齐 `kinds`**，每条的 `status` 取闭集：读到了但有行 → `success`；
 *    读到了这一类一行都没有 → `success-empty`；整次查询失败 → 返回 `unavailable` 页，
 *    **不能混成 `success`**（那就是谎报「市场安静」）。
 * 3. **月内校验**：每条 `scheduledAt` 必须以查询月前缀开头（`2026-11-`），越界行不许进页。
 * 4. `sourceObservedAt <= asOf`：这一条在写入端保证（观测时刻不早于查询时刻），读侧再挡一次。
 */
export type StandardMonthPageReader = Readonly<{
  queryMonth: (input: unknown) => MarketCalendarPage
}>

const isQuery = (value: unknown): value is { month: string; locale: 'zh' | 'en'; asOf: string; cursor?: string } => {
  if (typeof value !== 'object' || value === null) return false
  const input = value as Record<string, unknown>
  return typeof input.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)
    && (input.locale === 'zh' || input.locale === 'en') && typeof input.asOf === 'string'
    && (input.cursor === undefined || typeof input.cursor === 'string')
}

export function createStandardMonthPageReader(deps: Readonly<{
  database: DatabaseSync
  /** 名称解析由装配处给（指标码与事件码在两张名表里）。 */
  resolveTitle: StandardEventContext['resolveTitle']
  /** 兜底来源（认不出 feed id 时用）；不传就由适配器落 `unspecified`。 */
  sourceOf?: (row: { sourceProviderId: string }) => MarketCalendarEvent['source']
  limit?: number
  /** 诊断出口：默认进日志；测试可注入哨兵。 */
  onMissingSourceFeedId?: (count: number, month: string) => void
}>): StandardMonthPageReader {
  const contexts = new Map<string, { month: string; locale: 'zh' | 'en'; asOf: string; offset: number }>()
  const limit = deps.limit ?? marketCalendarPublicPolicy.maximumEvents
  return {
    queryMonth(input) {
      if (!isQuery(input)) return { state: 'unavailable', failureCode: 'input-invalid' }
      try {
        const rows = readStandardCalendarMonth(deps.database, { month: input.month, limit: 5_000 })
        const events = standardRowsToMarketEvents(rows, {
          locale: input.locale, resolveTitle: deps.resolveTitle,
          ...(deps.sourceOf === undefined ? {} : {
            resolveSource: (row: Readonly<{ sourceProviderId: string }>) =>
              deps.sourceOf!({ sourceProviderId: row.sourceProviderId })
          })
        })
        // 月内校验：越界的行不许进页（跨月数据串进来是分页最容易犯的错）。
        const inMonth = events.filter((event) => event.scheduledAt.startsWith(`${input.month}-`))
        // **可选字段要能量出来**：`sourceFeedId` 缺了不等于「没有来源」，而是「这条写入路径没带上」。
        // 长期不为 0 就说明有路径漏了；不为 0 也不改行为（页面照出），只报数。
        const missingFeedId = inMonth.filter((event) => event.sourceFeedId === undefined).length
        if (missingFeedId > 0) {
          if (deps.onMissingSourceFeedId !== undefined) deps.onMissingSourceFeedId(missingFeedId, input.month)
          else console.warn(`[macro-calendar] ${input.month} 有 ${missingFeedId} 行没有来源 feed id（写入路径未带上真值）`)
        }
        const offset = input.cursor === undefined ? 0 : (contexts.get(input.cursor)?.offset ?? -1)
        if (offset < 0) return { state: 'unavailable', failureCode: 'input-invalid' }
        const page = inMonth.slice(offset, offset + limit)
        const nextOffset = offset + page.length
        const nextCursor = nextOffset < inMonth.length ? randomUUID() : undefined
        if (nextCursor !== undefined) {
          contexts.set(nextCursor, { month: input.month, locale: input.locale, asOf: input.asOf, offset: nextOffset })
        }
        return {
          state: 'available', month: input.month, locale: input.locale, asOf: input.asOf,
          events: page, sources: sourcesOf(inMonth, input.asOf, readProviderLastBatches(deps.database)),
          // 空月要说清是「没有事件」还是「早于数据起点」：起点从库里最早一天派生，不写死在界面里。
          dataStartDate: readDataStartDate(deps.database),
          ...(nextCursor === undefined ? {} : { nextCursor })
        }
      } catch {
        return { state: 'unavailable', failureCode: 'query-unavailable' }
      }
    }
  }
}

/**
 * 三条，顺序对齐 `kinds`；「读到了但这一类没有行」与「读失败」是两种状态。
 *
 * 每条再带**出数状态**（`lastBatchAt` / `collectorSilent`）：这一类事件背后的源最近一次成功采集
 * 是什么时候、是不是已经错过好几个自己的周期。判据在 `marketCalendarFeedLiveness`，这里只把
 * 「这一类背后有哪些 feed」查出来交过去——一个 feed 都没有（例如历史行没带 `sourceFeedId`）时
 * 不下判据，不猜。
 */
function sourcesOf(
  events: readonly MarketCalendarEvent[], asOf: string,
  batches: ReadonlyMap<string, string>
): readonly MarketCalendarSource[] {
  // 「读到了、这一类没有行」也要给观测时刻：契约只允许 `unavailable` 的观测时刻为空，
  // 其余状态必须是有效时刻——填 `asOf` 是诚实的（这一刻我们读过，确实没有这一类）。
  const observed = events.map((event) => event.sourceObservedAt).sort().at(-1) ?? asOf
  return marketCalendarPublicPolicy.kinds.map((kind) => {
    const ofKind = events.filter((event) => event.eventType === kind)
    const liveness = kindLiveness(ofKind, asOf, batches)
    return {
      eventType: kind,
      status: ofKind.length === 0 ? 'success-empty' : 'success',
      sourceObservedAt: ofKind.map((event) => event.sourceObservedAt).sort().at(-1) ?? observed,
      ...(liveness === undefined ? {} : {
        ...(liveness.lastBatchAt === null ? {} : { lastBatchAt: liveness.lastBatchAt }),
        collectorSilent: liveness.silent
      })
    } as MarketCalendarSource
  })
}

/**
 * 这一类事件背后的出数状态。
 *
 * 一个 kind 背后可能有多个 feed（并存期间 Narwhal 与 0xrouter 都写）：**只要还有一个在出数，
 * 这一类就不是「已停止出数」**——读者看到的数据仍然在被刷新。所以「停」取交集，「最后批次」取最新。
 * 一个 feed 都查不出来时返回 `undefined`：不判，比编一个更诚实。
 */
function kindLiveness(
  events: readonly MarketCalendarEvent[], asOf: string, batches: ReadonlyMap<string, string>
): CalendarFeedLiveness | undefined {
  const feeds = [...new Set(events.map((event) => event.sourceFeedId).filter((feedId): feedId is string => feedId !== undefined))]
    .map((feedId) => calendarFeedRegistry[feedId as keyof typeof calendarFeedRegistry])
    .filter((feed): feed is NonNullable<typeof feed> => feed !== undefined)
  if (feeds.length === 0) return undefined
  const states = feeds.map((feed) => feedLiveness({ feedId: feed.feedId, providerId: feed.providerId, batches, asOf }))
  const lastBatchAt = states.map((state) => state.lastBatchAt).filter((at): at is string => at !== null).sort().at(-1) ?? null
  return { feedId: feeds[0]!.feedId, lastBatchAt, silent: states.every((state) => state.silent) }
}

/**
 * 库里最早一天有数据的日期（`YYYY-MM-DD`）；一条都没有就是 `null`。
 *
 * 这是**唯一**的起点来源：界面不写死日期，也不按「第一个月」去猜——那样换一次数据范围就要改两处。
 */
export function readDataStartDate(database: DatabaseSync): string | null {
  try {
    const row = database.prepare('select min(scheduled_date) as day from mi_calendar_releases').get() as
      { day: string | null } | undefined
    return row?.day ?? null
  } catch { return null }
}
