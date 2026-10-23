import { useCallback, useRef, useState } from 'react'

import { marketCalendarClient } from '../../shared/ipc/marketCalendarClient'

export type MarketCalendarFeedState = {
  refreshing: boolean
  feedback?: 'succeeded' | 'failed'
  refresh: () => Promise<void>
}

export type MarketCalendarRefreshClient = {
  refresh: (input: { month: string; locale: 'zh' | 'en' }) => Promise<unknown>
}

/**
 * Shared refresh state for the 0xRouter market calendar. The official providers
 * use the provider run-now path instead; this hook only drives the product job.
 */
export function useMarketCalendarFeed(
  client: MarketCalendarRefreshClient = marketCalendarClient,
  locale: 'zh' | 'en' = 'zh'
): MarketCalendarFeedState {
  const [refreshing, setRefreshing] = useState(false)
  const [feedback, setFeedback] = useState<'succeeded' | 'failed' | undefined>()
  const inFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    setFeedback(undefined)
    try {
      const result = await client.refresh({
        month: new Date().toISOString().slice(0, 7),
        locale
      })
      const state = result && typeof result === 'object' && 'state' in result
        ? (result as { state?: unknown }).state
        : undefined
      setFeedback(state === 'completed' || state === 'partial' ? 'succeeded' : 'failed')
    } catch {
      setFeedback('failed')
    } finally {
      inFlight.current = false
      setRefreshing(false)
    }
  }, [client, locale])

  return { refreshing, feedback, refresh }
}
