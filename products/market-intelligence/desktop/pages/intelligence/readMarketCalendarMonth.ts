import type { MarketCalendarClient } from '../../shared/ipc/marketCalendarClient'
import type { MarketCalendarEvent, MarketCalendarPage, MarketCalendarSource } from '../../../contracts/macro/marketCalendarQueryContracts'
import { marketCalendarReadPolicy } from '../../features/macro/economic-calendar/useMarketCalendar'

/**
 * One month of 0xRouter events, following the cursor, with the route's own per-source status.
 *
 * The month query is paged, and reading only its first page is why the dashboard card's upcoming
 * section showed official rows alone: the provider's later days (and with them the events the reader
 * was looking for) sat on page two. This walks the cursor under the same bounded-read policy the
 * calendar page uses, so a caller cannot read without limit and cannot quietly read too little.
 *
 * The sources travel back with the events because two surfaces need them, not just the rows:
 *
 * - the dashboard's calendar card;
 * - the event detail a chart line opens, which prints the provider's own body — including how the
 *   source's last refresh went, and, when the live source has moved past the observation the reader
 *   picked, which observation those values belong to.
 *
 * Returns null when the route is unavailable, so a caller can tell "nothing scheduled" from "we could
 * not read this".
 */
/**
 * 一次按月读的**完整结果**：事件，以及这一路的来源状态。
 *
 * 两者必须一起走：来源状态里有「这条源是不是已经停止出数」和它最后一次成功批次，抽屉要靠它把
 * 「数据可能停在上一次采集」写出来。只传事件的旧形状让那一句永远没地方落地（2026-11-16）。
 */
export type MarketCalendarMonthRead = Readonly<{
  events: readonly MarketCalendarEvent[]
  sources: readonly MarketCalendarSource[]
}>

export async function readMarketCalendarMonth(
  client: Pick<MarketCalendarClient, 'queryMonth'>,
  query: Readonly<{ month: string; locale: 'zh' | 'en'; asOf: string }>
): Promise<MarketCalendarMonthRead | null> {
  const events: MarketCalendarEvent[] = []
  let sources: readonly MarketCalendarSource[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page: MarketCalendarPage = await client.queryMonth(cursor === undefined ? query : { ...query, cursor })
    if (page.state !== 'available') return null
    if (events.length + page.events.length > marketCalendarReadPolicy.maximumEvents) return null
    events.push(...page.events)
    // Every page reports the route's sources; the last page read carries the current state.
    sources = page.sources
    cursor = page.nextCursor
    pages += 1
    if (cursor !== undefined && pages >= marketCalendarReadPolicy.maximumPages) return null
  } while (cursor !== undefined)
  return { events, sources }
}
