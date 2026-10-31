import { useEffect, useState } from 'react'

import type { MarketDivergenceResult } from '../../../contracts/marketDivergence'
import { projectDashboardDivergence, type DashboardDivergenceViewState } from './dashboardDivergenceModel'

/**
 * One query per mount. The reading is as-of a single instant by construction, so re-reading on
 * every render would risk legs from two instants being compared.
 */
export function useDashboardDivergence(input: Readonly<{
  client: { query: (input: { asOf: string; mode?: 'rules' | 'judge'; force?: boolean }) => Promise<MarketDivergenceResult> } | undefined
  now: () => Date
}>): Readonly<{ state: DashboardDivergenceViewState; reload: () => void }> {
  const [state, setState] = useState<DashboardDivergenceViewState>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [mountInput] = useState(() => input)

  useEffect(() => {
    let active = true
    const asOf = readClock(mountInput.now)
    const client = mountInput.client
    if (!asOf || typeof client?.query !== 'function') {
      setState({ state: 'unavailable', reason: 'query-failed', missing: [] })
      return () => { active = false }
    }
    setState({ state: 'loading' })
    // Two passes, one card: the rules answer in milliseconds and the model's reading replaces it
    // when it arrives. No spinner between them — a number that is already correct should not be
    // hidden behind a call that only improves the sentence.
    void client.query({ asOf, mode: 'rules' })
      .then((result) => {
        if (!active) return
        setState(projectDashboardDivergence(result, asOf))
        void client.query({ asOf, mode: 'judge', ...(attempt > 0 ? { force: true } : {}) })
          .then((judged) => {
            if (!active || judged.state === 'unavailable') return
            setState(projectDashboardDivergence(judged, asOf))
          })
          .catch(() => undefined)
      })
      .catch(() => { if (active) setState({ state: 'unavailable', reason: 'query-failed', missing: [] }) })
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
