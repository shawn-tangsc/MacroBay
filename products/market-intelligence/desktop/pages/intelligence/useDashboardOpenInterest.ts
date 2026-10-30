import { useEffect, useState } from 'react'

import { isCanonicalOpenInterestTime, type OpenInterestHistoryResult, type OpenInterestWindow } from '../../../contracts/openInterestHistory'
import { projectDashboardPositioning, type DashboardPositioningViewState } from './dashboardOpenInterestModel'

/**
 * One read per window. Switching 7d/24h is a new query rather than a client-side reshape: the
 * fold and the liquidation lookback are the server's job, and asking twice keeps one owner for
 * each shape.
 */
export function useDashboardOpenInterest(input: Readonly<{
  client: { query: (input: { asOf: string; window: OpenInterestWindow }) => Promise<OpenInterestHistoryResult> }
  now: () => Date
  window: OpenInterestWindow
}>): DashboardPositioningViewState {
  const [state, setState] = useState<DashboardPositioningViewState>({ state: 'loading' })
  const [mountInput] = useState(() => input)
  const { window } = input

  useEffect(() => {
    let active = true
    const asOf = readClock(mountInput.now)
    if (!asOf || typeof mountInput.client?.query !== 'function') {
      setState({ state: 'unavailable' })
      return () => { active = false }
    }
    setState({ state: 'loading' })
    void mountInput.client.query({ asOf, window })
      .then((result) => { if (active) setState(projectDashboardPositioning(result, asOf, window)) })
      .catch(() => { if (active) setState({ state: 'unavailable' }) })
    return () => { active = false }
    // `mountInput` is captured once on purpose: the clock must not re-read on every render.
  }, [mountInput, window])

  return state
}

function readClock(now: () => Date): string | undefined {
  try {
    const current = now()
    const asOf = current instanceof Date && Number.isFinite(current.getTime()) ? current.toISOString() : undefined
    return isCanonicalOpenInterestTime(asOf) ? asOf : undefined
  } catch {
    return undefined
  }
}
