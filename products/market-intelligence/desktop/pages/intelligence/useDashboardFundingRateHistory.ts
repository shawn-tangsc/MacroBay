import { useEffect, useState } from 'react'

import { isCanonicalFundingRateHistoryTime } from '../../../contracts/intelligenceQueryContracts'
import { projectDashboardFundingRateHistory, type DashboardFundingRateHistoryState } from './dashboardFundingRateHistoryModel'

export function useDashboardFundingRateHistory(input: { client: { query: (input: { asOf: string }) => Promise<unknown> }; now: () => Date }): DashboardFundingRateHistoryState {
  const [state, setState] = useState<DashboardFundingRateHistoryState>({ state: 'loading' })
  const [mountInput] = useState(() => input)
  useEffect(() => {
    let active = true
    const asOf = readClock(mountInput.now)
    if (!asOf) { setState({ state: 'unavailable' }); return () => { active = false } }
    if (typeof mountInput.client.query !== 'function') { setState({ state: 'unavailable' }); return () => { active = false } }
    void mountInput.client.query({ asOf }).then((result) => { if (active) setState(projectDashboardFundingRateHistory(result, asOf)) }).catch(() => { if (active) setState({ state: 'unavailable' }) })
    return () => { active = false }
  }, [mountInput])
  return state
}

function readClock(now: () => Date): string | undefined {
  try { const current = now(); const asOf = current instanceof Date && Number.isFinite(current.getTime()) ? current.toISOString() : undefined; return isCanonicalFundingRateHistoryTime(asOf) ? asOf : undefined } catch { return undefined }
}
