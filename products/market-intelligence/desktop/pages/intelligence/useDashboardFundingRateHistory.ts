import { useEffect, useState } from 'react'

import { isCanonicalFundingRateHistoryTime } from '../../../contracts/intelligenceQueryContracts'
import { projectDashboardFundingRateHistory, type DashboardFundingRateHistoryState } from './dashboardFundingRateHistoryModel'

/**
 * `disabled` = 读者把持仓那两格关掉了：一次请求都不发，停在等待态；卡片由上层整张跳过。
 * 「没接上客户端」仍是 `unavailable`（读不到），两者不共用一个词。
 */
export function useDashboardFundingRateHistory(input: { client: { query: (input: { asOf: string }) => Promise<unknown> }; now: () => Date; disabled?: boolean; reloadKey?: number }): DashboardFundingRateHistoryState {
  const [state, setState] = useState<DashboardFundingRateHistoryState>({ state: 'loading' })
  const [mountInput] = useState(() => input)
  useEffect(() => {
    let active = true
    if (input.disabled === true) { setState({ state: 'loading' }); return () => { active = false } }
    const asOf = readClock(mountInput.now)
    if (!asOf) { setState({ state: 'unavailable' }); return () => { active = false } }
    if (typeof mountInput.client.query !== 'function') { setState({ state: 'unavailable' }); return () => { active = false } }
    void mountInput.client.query({ asOf }).then((result) => { if (active) setState(projectDashboardFundingRateHistory(result, asOf)) }).catch(() => { if (active) setState({ state: 'unavailable' }) })
    return () => { active = false }
  }, [mountInput, input.disabled, input.reloadKey])
  return state
}

function readClock(now: () => Date): string | undefined {
  try { const current = now(); const asOf = current instanceof Date && Number.isFinite(current.getTime()) ? current.toISOString() : undefined; return isCanonicalFundingRateHistoryTime(asOf) ? asOf : undefined } catch { return undefined }
}
