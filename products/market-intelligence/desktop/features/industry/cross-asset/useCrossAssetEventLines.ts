import { useEffect, useRef, useState } from 'react'
import { crossAssetEventLines, type CrossAssetEventLine, type CrossAssetEventLineSource } from './crossAssetEventLines'
import { crossAssetMarketEventSources, officialEventKeysInWindow } from './crossAssetMarketEventLines'

/**
 * The window's high-importance calendar events, reduced to the lines the chart draws.
 *
 * Read by the calendar's own month route, because that is the only query it has; two calls at most,
 * since the chart's window was at most eight days. **现在不再成立**：`30d` 被准入后，一个窗口可以跨三个
 * 自然月，而下面只枚举首尾两个月的话，中间那个月的事件**根本读不到**（评审 be5e5e55 的 ⑥）。
 * costs the lines and nothing else — the curves are already on screen, and a calendar that did not
 * answer must never take them away.
 *
 * The month an event was **read from** travels with it, because that is what the page re-reads the
 * event by: an event scheduled on the 30th and detected after midnight belongs to the earlier month,
 * and the Agent's facts are read by the month the calendar filed the event under.
 */
export type CrossAssetEventLines = Readonly<{
  lines: readonly CrossAssetEventLine[]
  collapsed: number
  months: Readonly<Record<string, string>>
}>

/** Nothing read yet, or a calendar that failed: no lines, and nothing to collapse. */
export const emptyCrossAssetEventLines: CrossAssetEventLines = Object.freeze({ lines: [], collapsed: 0, months: {} })

export function useCrossAssetEventLines({ calendar, readMarketEvents, eventTitles, windowStart, windowEnd, asOf }: Readonly<{
  /** The official calendar, read by month: the only place this panel learns what was published. */
  calendar: Readonly<{ queryMonth: (input: { month: string; asOf: string }) => Promise<unknown> }>
  /**
   * The 0xRouter route, read by month and paged, injected by the page (which owns the locale).
   *
   * Both routes feed the lines: the official one carries nine release families, the provider carries
   * the rest of the US data calendar, and a day whose releases came through the provider alone would
   * otherwise show nothing. Optional: without it the chart draws the official rows only.
   */
  readMarketEvents?: (month: string, asOf: string) => Promise<readonly unknown[] | null>
  /**
   * The calendar's title vocabulary, handed down by the page. Without it the key is shown rather
   * than a name invented here, which would be a second list of event names and would drift.
   */
  eventTitles?: Record<string, string>
  windowStart?: string
  windowEnd?: string
  asOf?: string
}>): CrossAssetEventLines {
  const [lines, setLines] = useState<CrossAssetEventLines>(emptyCrossAssetEventLines)
  /**
   * The instant the read is scoped by, kept fresh without being a dependency of the read.
   *
   * The snapshot's `asOf` moves every second while `windowStart`/`windowEnd` move once per five-minute
   * bar. Depending on `asOf` therefore re-read the calendar — a month query per month, on both routes
   * — once a second, for a window that had not changed at all. The window is what the lines are about,
   * so the window is what triggers a read; the instant only ever bounds it.
   */
  const readAsOf = useRef(asOf)
  readAsOf.current = asOf
  useEffect(() => {
    const asOf = readAsOf.current
    if (!windowStart || !windowEnd || !asOf) return
    let current = true
    const months = calendarMonthsBetween(windowStart, windowEnd)
    // Each page keeps the month it was asked for, so a line can say which month it belongs to.
    void Promise.all(months.map(async (month, index) => {
      const official = month
      return {
        month: months[index] ?? official,
        page: await calendar.queryMonth({ month: official, asOf }).catch(() => undefined),
        market: await readMarketEvents?.(month, asOf).catch(() => null) ?? null
      }
    }))
      .then(pages => {
        if (!current) return
        const events: CrossAssetEventLineSource[] = []
        const monthsByEventKey: Record<string, string> = {}
        for (const { month, page } of pages) {
          const wireEvents = (page as { events?: readonly Record<string, unknown>[] } | undefined)?.events ?? []
          for (const event of wireEvents) {
            const atMs = Date.parse(String(event.publishedAt ?? event.scheduledAt ?? ''))
            const titleKey = String(event.titleKey ?? '')
            if (!Number.isFinite(atMs) || titleKey.length === 0) continue
            const eventKey = String(event.eventKey ?? `${titleKey}:${atMs}`)
            monthsByEventKey[eventKey] = month
            events.push({
              eventKey,
              titleKey,
              title: eventTitles?.[titleKey] ?? titleKey,
              countryCode: typeof event.countryCode === 'string' ? event.countryCode : null,
              importance: event.importance === 'high' ? 'high' : event.importance === 'low' ? 'low' : 'medium',
              eventType: event.eventType === 'financial-event' || event.eventType === 'central-bank-activity' ? event.eventType : 'economic-indicator',
              lifecycleState: event.lifecycleState === 'released' ? 'released' : event.lifecycleState === 'cancelled' ? 'cancelled' : 'scheduled',
              atMs,
              source: event.source === 'market' ? 'market' : 'official'
            })
          }
        }
        // The provider's own events join them, minus the ones the official route already draws: a
        // release the calendar has as an official row is that row, however differently the two routes
        // name it. Their month travels the same way, so a click re-reads the event where it was filed.
        // 只有**会被画出**的官方行才算"官方已经画了这条"：用整月的官方键去去重，会把窗口外的官方行
        // 也当成已画，于是 provider 的那条被吞掉、这条发布在图上整个消失（独立评审 be5e5e55 的 ⑤）。
        const officialKeys = officialEventKeysInWindow(events, Date.parse(windowStart), Date.parse(windowEnd))
        for (const { month, market } of pages) {
          for (const source of crossAssetMarketEventSources(market ?? [], officialKeys)) {
            monthsByEventKey[source.eventKey] = month
            events.push(source)
          }
        }
        setLines({
          ...crossAssetEventLines({ events, fromMs: Date.parse(windowStart), toMs: Date.parse(windowEnd) }),
          months: monthsByEventKey
        })
      })
      .catch(() => { if (current) setLines(emptyCrossAssetEventLines) })
    return () => { current = false }
    // `asOf` is deliberately absent: it moves every second while the window moves every five minutes
    // (see `readAsOf`), and re-reading two months of two calendars per second is not a read anyone asked for.
  }, [calendar, eventTitles, readMarketEvents, windowEnd, windowStart])
  return lines
}

/**
 * 窗口跨过的**每一个**自然月（含首尾）。
 *
 * 用"首尾两个月"是 7 天窗口时代的写法；`30d` 准入后，2026-01-30 → 2026-03-01 这样的窗口跨三个自然月，
 * 只枚举首尾就会漏掉中间那个月——那一个月的事件竖线会整段消失，而且没有任何提示。
 */
export function calendarMonthsBetween(fromIso: string, toIso: string): readonly string[] {
  const months: string[] = []
  const [fromYear, fromMonth] = fromIso.slice(0, 7).split('-').map(Number)
  const [toYear, toMonth] = toIso.slice(0, 7).split('-').map(Number)
  if (![fromYear, fromMonth, toYear, toMonth].every(value => Number.isSafeInteger(value))) return months
  for (let year = fromYear, month = fromMonth; year < toYear || (year === toYear && month <= toMonth);) {
    months.push(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return months
}
