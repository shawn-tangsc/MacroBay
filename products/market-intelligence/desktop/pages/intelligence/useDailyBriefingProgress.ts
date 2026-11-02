import { useEffect, useRef, useState } from 'react'

import type { DailyBriefingClient, DailyBriefingClientProgressResult } from '../../shared/ipc/dailyBriefingClient'

/**
 * Follows the generation that is running right now.
 *
 * Polling is deliberately narrow: it starts only while the page says a generation is in flight,
 * stops the moment that stops being true, and never overlaps two requests. The answer is a memory
 * snapshot on the service side, so a one-second interval costs no model calls and no store reads —
 * but an interval that keeps running after the run ends is still a leak, and this hook is where
 * that is prevented rather than left to each caller.
 *
 * A failed read is reported as `unavailable`, never as `idle`: a reader told "nothing is running"
 * while the pipeline is still spending model calls would stop waiting for the edition.
 */
export function useDailyBriefingProgress(input: Readonly<{
  client: Pick<DailyBriefingClient, 'getProgress'>
  /** True only while a generation is actually in flight. */
  running: boolean
  locale: 'zh-CN' | 'en-US'
  timeZone: string
  intervalMs?: number
}>): DailyBriefingClientProgressResult | undefined {
  const { client, running, locale, timeZone, intervalMs = 1_000 } = input
  const [result, setResult] = useState<DailyBriefingClientProgressResult | undefined>(undefined)
  // The client object may be rebuilt on every render; polling must not restart because of that.
  const clientRef = useRef(client)
  clientRef.current = client

  useEffect(() => {
    if (!running) {
      // The caller has the finished result by now; a stale snapshot would compete with it.
      setResult(undefined)
      return
    }
    let cancelled = false
    let inFlight = false
    const read = async (): Promise<void> => {
      if (inFlight) return
      inFlight = true
      try {
        const next = await clientRef.current.getProgress({ locale, timeZone })
        if (!cancelled) setResult(next)
      } finally {
        inFlight = false
      }
    }
    void read()
    const timer = setInterval(() => void read(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [running, locale, timeZone, intervalMs])

  return result
}
