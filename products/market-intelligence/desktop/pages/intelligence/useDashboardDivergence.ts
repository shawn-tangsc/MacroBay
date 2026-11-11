import { useEffect, useRef, useState } from 'react'

import type { MarketDivergenceResult } from '../../../contracts/marketDivergence'
import { projectDashboardDivergence, type DashboardDivergenceViewState } from './dashboardDivergenceModel'
import { trackQuietRevision } from './useDataChangeRevision'

/**
 * One query per mount. The reading is as-of a single instant by construction, so re-reading on
 * every render would risk legs from two instants being compared.
 */
export function useDashboardDivergence(input: Readonly<{
  client: { query: (input: { asOf: string }) => Promise<MarketDivergenceResult> } | undefined
  now: () => Date
  /** 「采集写了库」的计数：变了就是后台重读（保留旧读数、失败沿用上一次）。 */
  revision?: number
}>): Readonly<{ state: DashboardDivergenceViewState; reload: () => void }> {
  const [state, setState] = useState<DashboardDivergenceViewState>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [mountInput] = useState(() => input)
  const revisionRef = useRef<number | undefined>(input.revision)

  useEffect(() => {
    let active = true
    const quiet = trackQuietRevision(revisionRef, input.revision)
    const asOf = readClock(mountInput.now)
    const client = mountInput.client
    if (!asOf || typeof client?.query !== 'function') {
      setState({ state: 'unavailable', reason: 'query-failed', missing: [] })
      return () => { active = false }
    }
    // 读者的重试与首读先回到加载态；后台重读保留旧读数，不闪。
    if (!quiet) setState({ state: 'loading' })
    void client.query({ asOf })
      .then((result) => { if (active) setState(projectDashboardDivergence(result, asOf)) })
      .catch(() => {
        // 后台重读失败沿用上一次；屏上只有「加载中」时才说读不到。
        if (active) setState(current => quiet && current.state !== 'loading' ? current : { state: 'unavailable', reason: 'query-failed', missing: [] })
      })
    return () => { active = false }
  }, [mountInput, attempt, input.revision])

  return { state, reload: () => setAttempt(value => value + 1) }
}

/** The clock must not re-read on every render: one instant per mount. */
function readClock(now: () => Date): string | undefined {
  try {
    const value = now()
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString()
  } catch {
    return undefined
  }
}
