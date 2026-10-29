import { useCallback, useEffect, useRef, useState } from 'react'
import { marketCalendarClient, type MarketCalendarClient } from '../../../shared/ipc/marketCalendarClient'
import type { MarketCalendarEvent, MarketCalendarSource, MarketCalendarRefreshResult } from '../../../../contracts/macro/marketCalendarQueryContracts'

// Three selected batches of at most 1000 rows; also bounds pathological empty continuations.
export const marketCalendarReadPolicy = { maximumEvents: 3000, maximumPages: 3000 } as const

/**
 * The provider's calendar for the months a grid draws.
 *
 * `month` is the month the page is named after and the one a manual refresh targets; `months` is
 * the read window, primary included. The window exists because a six-week grid draws its
 * neighbours' days: reading only `month` left those cells permanently blank.
 */
export function useMarketCalendar({ month, months = [month], locale, now, client = marketCalendarClient }: {
  month: string; months?: readonly string[]; locale: 'zh' | 'en'; now: () => Date; client?: MarketCalendarClient
}) {
  const [events, setEvents] = useState<readonly MarketCalendarEvent[]>([])
  const [sources, setSources] = useState<readonly MarketCalendarSource[]>([])
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState(false)
  const [feedback, setFeedback] = useState<MarketCalendarRefreshResult>()
  const generation = useRef(0)
  const scopeGeneration = useRef(0)
  const scopeKey = `${months.join(',')}\n${locale}`
  const scope = useRef({ month, months, locale, key: scopeKey }); scope.current = { month, months, locale, key: scopeKey }
  const clock = useRef(now); clock.current = now
  const activeRefresh = useRef(false)
  const mounted = useRef(true)
  const load = useCallback(async () => {
    const id = ++generation.current
    const requested = scope.current
    const asOf = clock.current().toISOString()
    setLoading(true); setFailure(false)
    const accumulated: MarketCalendarEvent[] = []
    const seen = new Set<string>()
    const cursors = new Set<string>()
    let sources: readonly MarketCalendarSource[] = []
    let pages = 0
    // The named month is read first so its source status is on screen while the edges load.
    const order = [requested.month, ...requested.months.filter(candidate => candidate !== requested.month)]
    try {
      for (const candidate of order) {
        let cursor: string | undefined
        do {
          const page = await client.queryMonth({ month: candidate, locale: requested.locale, asOf, ...(cursor ? { cursor } : {}) })
          if (id !== generation.current || requested.key !== scope.current.key) return
          if (page.state !== 'available') { setFailure(true); return }
          pages += 1
          // The window reads several month pages and a month page is itself paged: an event is
          // kept once, so a repeated row can never be counted or drawn twice.
          const fresh = page.events.filter(event => !seen.has(event.eventKey))
          for (const event of fresh) seen.add(event.eventKey)
          if (accumulated.length + fresh.length > marketCalendarReadPolicy.maximumEvents) { setFailure(true); return }
          accumulated.push(...fresh)
          if (candidate === requested.month) sources = page.sources
          setEvents([...accumulated]); setSources(sources)
          cursor = page.nextCursor
          if (cursor && pages >= marketCalendarReadPolicy.maximumPages) { setFailure(true); return }
          if (cursor && cursors.has(`${candidate}\n${cursor}`)) { setFailure(true); return }
          if (cursor) cursors.add(`${candidate}\n${cursor}`)
        } while (cursor)
      }
    } catch { if (id === generation.current) setFailure(true) }
    finally { if (id === generation.current) setLoading(false) }
  }, [client])
  useEffect(() => {
    mounted.current = true
    scopeGeneration.current++
    setEvents([]); setSources([]); setFeedback(undefined)
    void load()
    return () => { mounted.current = false; generation.current++ }
  }, [scopeKey, load])
  const refresh = useCallback(async () => {
    if (activeRefresh.current) return
    activeRefresh.current = true; setPending(true)
    const requested = scope.current
    const requestedGeneration = scopeGeneration.current
    const isCurrent = () => mounted.current && requestedGeneration === scopeGeneration.current && requested.key === scope.current.key
    try {
      // A refresh stays one month: it is a provider request the reader asked for, not a window read.
      const result = await client.refresh({ month: requested.month, locale: requested.locale })
      if (!isCurrent()) return
      setFeedback(result)
      await load()
    } catch { if (isCurrent()) setFailure(true) }
    finally { activeRefresh.current = false; if (mounted.current) setPending(false) }
  }, [client, load])
  return { month, events, sources, loading, pending, failure, feedback, refresh }
}
