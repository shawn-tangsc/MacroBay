import { useCallback, useEffect, useRef, useState } from 'react'

import type { NewsSentimentSymbol, NewsSentimentWindow } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'

export type NewsSentimentFilters = {
  direction: 'all' | 'bullish' | 'bearish' | 'neutral' | 'mixed'
  sourceId: 'all' | string
  scope: 'market' | NewsSentimentSymbol
}

export type UseNewsSentimentResult = Readonly<{
  view?: NewsSentimentView
  loading: boolean
  failed: boolean
  window: NewsSentimentWindow
  filters: NewsSentimentFilters
  setWindow: (window: NewsSentimentWindow) => void
  setFilters: (next: Partial<NewsSentimentFilters>) => void
  refresh: () => void
}>

const DEFAULT_FILTERS: NewsSentimentFilters = { direction: 'all', sourceId: 'all', scope: 'market' }

/** One read per window/refresh. Never polls: the dashboard is a snapshot, not a stream. */
export function useNewsSentiment(input: {
  client: Pick<NewsSentimentClient, 'query'>
  now: () => Date
}): UseNewsSentimentResult {
  const [window, setWindow] = useState<NewsSentimentWindow>('24h')
  const [filters, setFiltersState] = useState<NewsSentimentFilters>(DEFAULT_FILTERS)
  const [view, setView] = useState<NewsSentimentView>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [asOf, setAsOf] = useState(() => input.now().toISOString())
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setFailed(false)
    try {
      const next = await input.client.query({ asOf, window, limit: 100 })
      if (id !== requestId.current) return
      setView(next)
      setFailed(next.state === 'unavailable')
    } catch {
      if (id !== requestId.current) return
      setFailed(true)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [asOf, input.client, window])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = useCallback(() => {
    setAsOf(input.now().toISOString())
  }, [input.now])

  const setWindowAndReload = useCallback((next: NewsSentimentWindow) => {
    setWindow(next)
    setAsOf(input.now().toISOString())
  }, [input.now])

  const setFilters = useCallback((next: Partial<NewsSentimentFilters>) => {
    setFiltersState((current) => ({ ...current, ...next }))
  }, [])

  return { view, loading, failed, window, filters, setWindow: setWindowAndReload, setFilters, refresh }
}
