import { useCallback, useRef, useState } from 'react'

import { formatShellYearMonth, resolveShellTimeZone } from '@platform/ui/time/shellTimeFormat'

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
  locale: 'zh' | 'en' = 'zh',
  options: Readonly<{ timeZone?: string; now?: () => Date }> = {}
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
      // 月份按读者时区取：月底差一天用 UTC 会刷错月。
      const at = (options.now ?? (() => new Date()))()
      const result = await client.refresh({
        month: formatShellYearMonth(at, options.timeZone ?? resolveShellTimeZone(undefined)),
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
  }, [client, locale, options.now, options.timeZone])

  return { refreshing, feedback, refresh }
}
