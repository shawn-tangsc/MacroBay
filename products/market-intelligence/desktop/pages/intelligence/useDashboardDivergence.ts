import { useEffect, useState } from 'react'

import type { MarketDivergenceResult } from '../../../contracts/marketDivergence'
import { projectDashboardDivergence, type DashboardDivergenceViewState } from './dashboardDivergenceModel'

/**
 * One query per mount. The reading is as-of a single instant by construction, so re-reading on
 * every render would risk legs from two instants being compared.
 */
export function useDashboardDivergence(input: Readonly<{
  client: { query: (input: { asOf: string }) => Promise<MarketDivergenceResult> } | undefined
  now: () => Date
}>): DashboardDivergenceViewState {
  const [state, setState] = useState<DashboardDivergenceViewState>({ state: 'loading' })
  const [mountInput] = useState(() => input)

  useEffect(() => {
    let active = true
    const asOf = readClock(mountInput.now)
    if (!asOf || typeof mountInput.client?.query !== 'function') {
      setState({ state: 'unavailable' })
      return () => { active = false }
    }
    setState({ state: 'loading' })
    void mountInput.client.query({ asOf })
      .then((result) => { if (active) setState(projectDashboardDivergence(result, asOf)) })
      .catch(() => { if (active) setState({ state: 'unavailable' }) })
    return () => { active = false }
  }, [mountInput])

  return state
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
