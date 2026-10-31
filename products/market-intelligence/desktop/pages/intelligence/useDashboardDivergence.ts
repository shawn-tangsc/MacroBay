import { useEffect, useState } from 'react'

import type { MarketDivergenceResult } from '../../../contracts/marketDivergence'
import { projectDashboardDivergence, type DashboardDivergenceViewState } from './dashboardDivergenceModel'

/**
 * One query per mount. The reading is as-of a single instant by construction, so re-reading on
 * every render would risk legs from two instants being compared.
 */
export function useDashboardDivergence(input: Readonly<{
  client: { query: (input: { asOf: string; mode?: 'auto' | 'manual' }) => Promise<MarketDivergenceResult> } | undefined
  now: () => Date
}>): Readonly<{ state: DashboardDivergenceViewState; reload: () => void }> {
  const [state, setState] = useState<DashboardDivergenceViewState>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [mountInput] = useState(() => input)

  useEffect(() => {
    let active = true
    const asOf = readClock(mountInput.now)
    if (!asOf || typeof mountInput.client?.query !== 'function') {
      setState({ state: 'unavailable' })
      return () => { active = false }
    }
    setState({ state: 'loading' })
    void mountInput.client.query({ asOf, ...(attempt > 0 ? { mode: 'manual' as const } : {}) })
      .then((result) => { if (active) setState(projectDashboardDivergence(result, asOf)) })
      .catch(() => { if (active) setState({ state: 'unavailable' }) })
    return () => { active = false }
  }, [mountInput, attempt])

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
