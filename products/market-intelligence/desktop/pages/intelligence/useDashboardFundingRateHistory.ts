import { useEffect, useRef, useState } from 'react'

import { isCanonicalFundingRateHistoryTime } from '../../../contracts/intelligenceQueryContracts'
import { projectDashboardFundingRateHistory, type DashboardFundingRateHistoryState } from './dashboardFundingRateHistoryModel'
import { trackQuietRevision } from './useDataChangeRevision'

/**
 * `disabled` = 读者把持仓那两格关掉了：一次请求都不发，停在等待态；卡片由上层整张跳过。
 * 「没接上客户端」仍是 `unavailable`（读不到），两者不共用一个词。
 */
export function useDashboardFundingRateHistory(input: { client: { query: (input: { asOf: string }) => Promise<unknown> }; now: () => Date; disabled?: boolean; waiting?: boolean; reloadKey?: number
  /** 「采集写了库」的计数：变了就是后台重读（保留旧读数、失败沿用上一次）。 */
  revision?: number }): DashboardFundingRateHistoryState {
  const [state, setState] = useState<DashboardFundingRateHistoryState>({ state: 'loading' })
  const [mountInput] = useState(() => input)
  const revisionRef = useRef<number | undefined>(input.revision)
  useEffect(() => {
    let active = true
    const quiet = trackQuietRevision(revisionRef, input.revision)
    if (input.waiting === true) { setState({ state: 'loading' }); return () => { active = false } }
    // 决定不读：终态，不再用「加载中」冒充（2026-11-11）。
    if (input.disabled === true) { setState({ state: 'unavailable' }); return () => { active = false } }
    const asOf = readClock(mountInput.now)
    if (!asOf) { setState({ state: 'unavailable' }); return () => { active = false } }
    if (typeof mountInput.client.query !== 'function') { setState({ state: 'unavailable' }); return () => { active = false } }
    void mountInput.client.query({ asOf }).then((result) => { if (active) setState(projectDashboardFundingRateHistory(result, asOf)) }).catch(() => {
      // 后台重读失败沿用上一次；屏上只有「加载中」时才说读不到。
      if (active) setState(current => quiet && current.state !== 'loading' ? current : { state: 'unavailable' })
    })
    return () => { active = false }
  }, [mountInput, input.disabled, input.waiting, input.reloadKey, input.revision])
  return state
}

function readClock(now: () => Date): string | undefined {
  try { const current = now(); const asOf = current instanceof Date && Number.isFinite(current.getTime()) ? current.toISOString() : undefined; return isCanonicalFundingRateHistoryTime(asOf) ? asOf : undefined } catch { return undefined }
}
