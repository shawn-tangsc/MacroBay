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
  /** 读者把背离卡那几格全关掉了：不读、停在等待态；卡片由上层整张跳过。 */
  disabled?: boolean
}>): Readonly<{ state: DashboardDivergenceViewState; reload: () => void }> {
  const [state, setState] = useState<DashboardDivergenceViewState>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [mountInput] = useState(() => input)

  useEffect(() => {
    let active = true
    if (input.disabled === true) { setState({ state: 'loading' }); return () => { active = false } }
    const asOf = readClock(mountInput.now)
    const client = mountInput.client
    if (!asOf || typeof client?.query !== 'function') {
      setState({ state: 'unavailable', reason: 'query-failed', missing: [] })
      return () => { active = false }
    }
    setState({ state: 'loading' })
    void client.query({ asOf })
      .then((result) => { if (active) setState(projectDashboardDivergence(result, asOf)) })
      .catch(() => { if (active) setState({ state: 'unavailable', reason: 'query-failed', missing: [] }) })
    return () => { active = false }
  }, [mountInput, attempt, input.disabled])

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
