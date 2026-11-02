import { useEffect, useState } from 'react'
import { macroEconomicCalendarClient } from '../../shared/ipc/macroEconomicCalendarClient'
import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'
import { calendarUpcomingPolicy } from './calendarUpcomingPolicy'
import { readMarketCalendarMonth } from './readMarketCalendarMonth'
import { toCardEventFromOfficial, toCardEventFromProvider } from './calendarCardEventProjection'
import { attachReactions, reactionAnchors, type CalendarCardReaction } from './calendarCardReaction'
import { projectUpcomingCalendarCard, type CalendarCardEvent, type CalendarCardProjection } from './projectUpcomingCalendarCard'

/**
 * Feeds the card from the calendar the page already has, read-only.
 *
 * Two existing month queries, one per route, and nothing else: no refresh, no polling, no
 * cache, no new IPC. The calendar page's own hook is not reused because it covers only the
 * 0xRouter route and carries a refresh state machine the card has no use for.
 *
 * Any failure degrades to `unavailable` rather than to an empty window, so "we could not read
 * this" never looks like "nothing is scheduled".
 */

/** No rows yet. `empty` is the projection's own word for "read, nothing in the window". */
const emptyProjection: CalendarCardProjection = { today: [], upcoming: [], state: 'empty' }

/**
 * What the card is doing, as three states.
 *
 * `loading` must never be spelled `unavailable`: the first frame of a slow read is not a failure,
 * and a card that opens on «读取失败 + 重试» then flips to data teaches the reader to distrust the
 * failure state itself. A refresh that fails keeps the rows it already has and says they are the
 * previous readings (`stale`) instead of falling back to the error screen.
 */
export type CalendarCardLoadState = 'loading' | 'ready' | 'error'

export type CalendarCardDataState = Readonly<{
  projection: CalendarCardProjection
  state: CalendarCardLoadState
  /** The rows on screen are from an earlier successful read; the newest attempt failed. */
  stale: boolean
  reload: () => void
}>

/** 「±30 分」反应的读取器，由页面注入（它才拥有跨资产那条查询与它的客户端）。 */
export type CalendarCardReactionReader = (instant: string) => Promise<CalendarCardReaction | undefined>

/**
 * The months the card's own window reaches, not a pair around the current month.
 *
 * The window is `releasedWindowDays` back and `upcomingWindowDays` ahead, so on the first days of
 * a month it reaches into the month before: on 11-02 the releases of 10-30 and 10-31 are three
 * days old and still news. Reading only the current month (plus the next one) made those
 * releases unreachable and the «最近已公布» section empty exactly when a month turned over —
 * the reader saw an empty section instead of a value that exists.
 *
 * Bounded by the window itself, so at most three months even across a February boundary.
 */
export function calendarCardMonths(asOf: string): readonly string[] {
  const dayMs = 24 * 60 * 60 * 1_000
  const from = new Date(Date.parse(asOf) - calendarUpcomingPolicy.releasedWindowDays * dayMs).toISOString().slice(0, 7)
  const to = new Date(Date.parse(asOf) + calendarUpcomingPolicy.upcomingWindowDays * dayMs).toISOString().slice(0, 7)
  const months: string[] = []
  let [year, index] = from.split('-').map(Number) as [number, number]
  for (;;) {
    const month = `${year}-${String(index).padStart(2, '0')}`
    months.push(month)
    if (month >= to) break
    if (index === 12) { year += 1; index = 1 } else index += 1
  }
  return months
}

export function useCalendarCardData({ asOf, locale = 'zh', reloadKey = 0, readReaction }: Readonly<{
  asOf: string; locale?: 'zh' | 'en'; reloadKey?: number
  /**
   * 读了才有「±30 分」那一行（原型 ④）。不注入、读失败、读回来是空，都是"卡片不画这一行"——
   * 一次跨资产读的缺席，绝不能让日历自己少一行。
   */
  readReaction?: CalendarCardReactionReader
}>): CalendarCardDataState {
  const [snapshot, setSnapshot] = useState<Readonly<{ projection: CalendarCardProjection; stale: boolean }>>()
  const [state, setState] = useState<CalendarCardLoadState>('loading')
  const [attempt, setAttempt] = useState(reloadKey)
  useEffect(() => {
    let live = true
    // With rows on screen a re-read does not blank them: they stay until the new answer arrives
    // (or stays failed, which marks them stale below). Without rows, the first frame is loading.
    setState(current => current === 'ready' ? 'ready' : 'loading')
    const months = calendarCardMonths(asOf)
    void Promise.all(months.map(async month => {
      const [official, market] = await Promise.all([
        macroEconomicCalendarClient.queryMonth({ month, asOf }),
        // Paged: reading one page hid the provider's later days from the card.
        readMarketCalendarMonth(marketCalendarClient, { month, locale, asOf })
      ])
      const events: CalendarCardEvent[] = official.state === 'available' ? official.events.map(toCardEventFromOfficial) : []
      if (market !== null) events.push(...market.events.map(toCardEventFromProvider))
      // A month that answered `unavailable` is a failed read, not an empty window. Losing the
      // provider route only costs its rows (it is the extra route); losing the official route for
      // every month means the card has nothing to stand on.
      return { events, officialRead: official.state === 'available' }
    })).then(async pages => {
      if (!live) return
      // Only when neither route produced anything at all is the read a failure. The official route
      // answering `unavailable` while the provider route still lists a release is a degraded read
      // with real rows, not an error screen.
      if (!pages.some(page => page.officialRead || page.events.length > 0)) throw new Error('calendar read failed')
      const events = pages.flatMap(page => page.events)
      const projection = projectUpcomingCalendarCard(events, asOf)
      setSnapshot({ projection, stale: false })
      setState('ready')
      if (!readReaction) return
      // 每个「已公布且有确切时刻」的行读一次（同一分钟共用一个窗口），读回来贴到对应时刻上。
      const anchors = reactionAnchors(projection.today)
      const reactions = new Map<string, CalendarCardReaction>()
      await Promise.all(anchors.map(async instant => {
        const reaction = await readReaction(instant).catch(() => undefined)
        if (reaction !== undefined) reactions.set(instant, reaction)
      }))
      if (live && reactions.size > 0) setSnapshot(current => current ? { ...current, projection: attachReactions(current.projection, reactions) } : current)
    }).catch(() => {
      if (!live) return
      // A failed refresh with rows on screen keeps them and marks them as the last readings; only a
      // card with nothing to show falls to the error state.
      setSnapshot(current => current ? { ...current, stale: true } : current)
      setState(current => current === 'ready' ? 'ready' : 'error')
    })
    return () => { live = false }
  }, [asOf, locale, attempt, readReaction])
  return {
    projection: snapshot?.projection ?? emptyProjection,
    state,
    stale: snapshot?.stale ?? false,
    reload: () => setAttempt(value => value + 1)
  }
}
