import { useEffect, useState } from 'react'
import { macroEconomicCalendarClient } from '../../shared/ipc/macroEconomicCalendarClient'
import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'
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

const emptyProjection: CalendarCardProjection = { today: [], upcoming: [], state: 'unavailable' }

export type CalendarCardDataState = Readonly<{ projection: CalendarCardProjection; loading: boolean; reload: () => void }>

/** 「±30 分」反应的读取器，由页面注入（它才拥有跨资产那条查询与它的客户端）。 */
export type CalendarCardReactionReader = (instant: string) => Promise<CalendarCardReaction | undefined>

/** The single month the card needs: its window can only cross into the next month. */
export function calendarCardMonths(asOf: string): readonly string[] {
  const month = asOf.slice(0, 7)
  const [year, index] = month.split('-').map(Number) as [number, number]
  const next = index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, '0')}`
  return [month, next]
}

export function useCalendarCardData({ asOf, locale = 'zh', reloadKey = 0, readReaction }: Readonly<{
  asOf: string; locale?: 'zh' | 'en'; reloadKey?: number
  /**
   * 读了才有「±30 分」那一行（原型 ④）。不注入、读失败、读回来是空，都是"卡片不画这一行"——
   * 一次跨资产读的缺席，绝不能让日历自己少一行。
   */
  readReaction?: CalendarCardReactionReader
}>): CalendarCardDataState {
  const [projection, setProjection] = useState<CalendarCardProjection>(emptyProjection)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(reloadKey)
  useEffect(() => {
    let live = true
    setLoading(true)
    const months = calendarCardMonths(asOf)
    void Promise.all(months.map(async month => {
      const [official, market] = await Promise.all([
        macroEconomicCalendarClient.queryMonth({ month, asOf }),
        // Paged: reading one page hid the provider's later days from the card.
        readMarketCalendarMonth(marketCalendarClient, { month, locale, asOf })
      ])
      const events: CalendarCardEvent[] = official.state === 'available' ? official.events.map(toCardEventFromOfficial) : []
      if (market !== null) events.push(...market.events.map(toCardEventFromProvider))
      return events
    })).then(async pages => {
      if (!live) return
      const events = pages.flat()
      const projection = projectUpcomingCalendarCard(events, asOf)
      setProjection(projection)
      setLoading(false)
      if (!readReaction) return
      // 每个「已公布且有确切时刻」的行读一次（同一分钟共用一个窗口），读回来贴到对应时刻上。
      const anchors = reactionAnchors(projection.today)
      const reactions = new Map<string, CalendarCardReaction>()
      await Promise.all(anchors.map(async instant => {
        const reaction = await readReaction(instant).catch(() => undefined)
        if (reaction !== undefined) reactions.set(instant, reaction)
      }))
      if (live && reactions.size > 0) setProjection(current => attachReactions(current, reactions))
    }).catch(() => {
      if (!live) return
      setProjection(emptyProjection)
      setLoading(false)
    })
    return () => { live = false }
  }, [asOf, locale, attempt, readReaction])
  return { projection, loading, reload: () => setAttempt(value => value + 1) }
}
