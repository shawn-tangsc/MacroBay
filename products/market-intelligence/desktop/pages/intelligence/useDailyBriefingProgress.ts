import { useEffect, useRef, useState } from 'react'

import type { DailyBriefingClient, DailyBriefingClientProgressResult } from '../../shared/ipc/dailyBriefingClient'

/**
 * Follows the generation that is running right now.
 *
 * The caller keeps it running whenever the page is open, because the run it must report may have
 * been started elsewhere — by the 07:00 schedule, or by another window — and local state cannot see
 * it. The answer is a memory snapshot on the service side: no model calls and no store reads, so a
 * one-second read is cheap. Requests never overlap.
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
  /** 这一次跑的期号（发起时记下的），不是"当前选中的期"：并行时两者可能不是同一跑。 */
  periodId?: string
  intervalMs?: number
}>): DailyBriefingClientProgressResult | undefined {
  const { client, running, locale, timeZone, periodId, intervalMs = 1_000 } = input
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
        const next = await clientRef.current.getProgress({ locale, timeZone, ...(periodId === undefined ? {} : { periodId }) })
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
  }, [running, locale, timeZone, periodId, intervalMs])

  return result
}
