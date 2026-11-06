import { useCallback, useEffect, useRef, useState } from 'react'

import type { NewsSentimentSymbol, NewsSentimentWindow } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'

export type NewsSentimentFilters = {
  direction: 'all' | 'bullish' | 'bearish' | 'neutral' | 'mixed'
  sourceId: 'all' | string
  scope: 'market' | NewsSentimentSymbol
  includeNeutral: boolean
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

const DEFAULT_FILTERS: NewsSentimentFilters = { direction: 'all', sourceId: 'all', scope: 'market', includeNeutral: true }

/**
 * How long a read may stay unanswered before the card says it failed.
 *
 * Without a deadline a hung IPC leaves the card on "加载中" forever, which is the other half of the
 * flash bug: the fix for "a failure flashes before the data" must not be "never admit the failure".
 */
const DEFAULT_READ_DEADLINE_MS = 15_000

/** One read per window/refresh. Never polls: the dashboard is a snapshot, not a stream. */
export function useNewsSentiment(input: {
  client: Pick<NewsSentimentClient, 'query'>
  now: () => Date
  /** Tests shorten this; production keeps the deadline above. */
  readDeadlineMs?: number
  /**
   * The interface language. Titles and body translations are resolved **on the server for the
   * language in force when the read runs**, so a language switch has to re-read: without this the
   * drawer keeps the previous language's strings while the chrome has already changed.
   */
  language?: string
}): UseNewsSentimentResult {
  const [window, setWindow] = useState<NewsSentimentWindow>('all')
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
    const deadlineMs = input.readDeadlineMs ?? DEFAULT_READ_DEADLINE_MS
    let timer: ReturnType<typeof setTimeout> | undefined
    const deadline = new Promise<'deadline'>((resolve) => {
      timer = setTimeout(() => resolve('deadline'), deadlineMs)
    })
    try {
      const next = await Promise.race([
        input.client.query({ asOf, window, limit: 100 }),
        deadline
      ])
      if (id !== requestId.current) return
      if (next === 'deadline') {
        // Bounded waiting, not endless: a read that never answers becomes a failure the reader can
        // retry, and whatever was already on screen stays (the callers keep data + mark it older).
        setFailed(true)
        return
      }
      setView(next)
      setFailed(next.state === 'unavailable')
    } catch {
      if (id !== requestId.current) return
      setFailed(true)
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      if (id === requestId.current) setLoading(false)
    }
  }, [asOf, input.client, input.language, input.readDeadlineMs, window])

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
