import { useCallback, useEffect, useRef, useState } from 'react'
import { marketCalendarClient, type MarketCalendarClient } from '../../../shared/ipc/marketCalendarClient'
import type { MarketCalendarEvent, MarketCalendarSource, MarketCalendarRefreshResult } from '../../../../contracts/macro/marketCalendarQueryContracts'

// Three selected batches of at most 1000 rows; also bounds pathological empty continuations.
export const marketCalendarReadPolicy = { maximumEvents: 3000, maximumPages: 3000 } as const

export function useMarketCalendar({ month, locale, now, client = marketCalendarClient }: {
  month: string; locale: 'zh' | 'en'; now: () => Date; client?: MarketCalendarClient
}) {
  const [events, setEvents] = useState<readonly MarketCalendarEvent[]>([])
  const [sources, setSources] = useState<readonly MarketCalendarSource[]>([])
  const [loading, setLoading] = useState(false)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState(false)
  const [feedback, setFeedback] = useState<MarketCalendarRefreshResult>()
  const generation = useRef(0)
  const scopeGeneration = useRef(0)
  const scope = useRef({ month, locale }); scope.current = { month, locale }
  const clock = useRef(now); clock.current = now
  const activeRefresh = useRef(false)
  const mounted = useRef(true)
  const load = useCallback(async () => {
    const id = ++generation.current
    const requested = scope.current
    const asOf = clock.current().toISOString()
    setLoading(true); setFailure(false)
    const accumulated: MarketCalendarEvent[] = []
    const cursors = new Set<string>()
    let cursor: string | undefined
    let pages = 0
    try {
      do {
        const page = await client.queryMonth({ ...requested, asOf, ...(cursor ? { cursor } : {}) })
        if (id !== generation.current || requested.month !== scope.current.month || requested.locale !== scope.current.locale) return
        if (page.state !== 'available') { setFailure(true); return }
        pages++
        if (accumulated.length + page.events.length > marketCalendarReadPolicy.maximumEvents) { setFailure(true); return }
        accumulated.push(...page.events)
        setEvents([...accumulated]); setSources(page.sources)
        cursor = page.nextCursor
        if (cursor && pages >= marketCalendarReadPolicy.maximumPages) { setFailure(true); return }
        if (cursor && cursors.has(cursor)) { setFailure(true); return }
        if (cursor) cursors.add(cursor)
      } while (cursor)
    } catch { if (id === generation.current) setFailure(true) }
    finally { if (id === generation.current) setLoading(false) }
  }, [client])
  useEffect(() => {
    mounted.current = true
    scopeGeneration.current++
    setEvents([]); setSources([]); setFeedback(undefined)
    void load()
    return () => { mounted.current = false; generation.current++ }
  }, [month, locale, load])
  const refresh = useCallback(async () => {
    if (activeRefresh.current) return
    activeRefresh.current = true; setPending(true)
    const requested = scope.current
    const requestedGeneration = scopeGeneration.current
    const isCurrent = () => mounted.current && requestedGeneration === scopeGeneration.current &&
      requested.month === scope.current.month && requested.locale === scope.current.locale
    try {
      const result = await client.refresh(requested)
      if (!isCurrent()) return
      setFeedback(result)
      await load()
    } catch { if (isCurrent()) setFailure(true) }
    finally { activeRefresh.current = false; if (mounted.current) setPending(false) }
  }, [client, load])
  return { month, events, sources, loading, pending, failure, feedback, refresh }
}
