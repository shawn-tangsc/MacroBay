import { useEffect, useState } from 'react'

import { isCanonicalOpenInterestTime, type OpenInterestHistoryResult, type OpenInterestWindow } from '../../../contracts/openInterestHistory'
import type { ModuleSignalAnalysisRead } from '../../../service/intelligence/analysis/signalAnalysisRead'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import { chipAnalysisOf, projectDashboardPositioning, projectModuleSignalChip, type DashboardPositioningViewState } from './dashboardOpenInterestModel'
import { moduleSignalClient } from '../../shared/ipc/moduleSignalClient'

/**
 * One read per window. Switching 7d/24h is a new query rather than a client-side reshape: the
 * fold and the liquidation lookback are the server's job, and asking twice keeps one owner for
 * each shape.
 */
export function useDashboardOpenInterest(input: Readonly<{
  client: { query: (input: { asOf: string; window: OpenInterestWindow }) => Promise<OpenInterestHistoryResult> }
  now: () => Date
  window: OpenInterestWindow
  /** Defaults to the real bridge; a test hands in its own reader. */
  signalClient?: { query: (input: { asOf: string }) => Promise<ModuleSignalAnalysisRead> }
}>): DashboardPositioningViewState {
  const [state, setState] = useState<DashboardPositioningViewState>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const reload = () => setAttempt(value => value + 1)
  const [mountInput] = useState(() => input)
  const { window } = input

  useEffect(() => {
    let active = true
    const asOf = readClock(mountInput.now)
    if (!asOf || typeof mountInput.client?.query !== 'function') {
      setState({ state: 'unavailable', cause: 'query-failed', onReload: reload })
      return () => { active = false }
    }
    setState({ state: 'loading' })
    // The chip comes from the module's rule, not from the series: the two reads answer different
    // questions and either may fail alone. A missing signal is no chip, never a made-up one.
    // 牌子固定按 24 小时判（用户 2026-11-08 10:4x 定）：切页签不改「现在怎么样」。
    // 图上的点跟窗口，那是这一行下面那次历史查询的事。
    const signals = readSignals(mountInput.signalClient ?? moduleSignalClient, asOf)
    void mountInput.client.query({ asOf, window })
      .then(async (result) => {
        if (!active) return
        const projected = projectDashboardPositioning(result, asOf, window, reload)
        const read = await signals
        const chip = projectModuleSignalChip(read, 'open-interest', reload)
        const analysis = chipAnalysisOf(read)
        if (!active) return
        setState(projected.state === 'available'
          ? { ...projected, signal: chip, ...(analysis ? { signalAnalysis: analysis } : {}) }
          : projected)
      })
      .catch(() => { if (active) setState({ state: 'unavailable', cause: 'query-failed', onReload: reload }) })
    return () => { active = false }
    // `mountInput` is captured once on purpose: the clock must not re-read on every render.
  }, [mountInput, window, attempt])

  return state
}

/** A signal read that failed is no chip, not a fabricated one. */
async function readSignals(
  client: { query: (input: { asOf: string }) => Promise<ModuleSignalAnalysisRead> },
  asOf: string
): Promise<ModuleSignalAnalysisRead> {
  try {
    // The chip is the 24-hour read; the view's window never travels with it.
    return await client.query({ asOf })
  } catch {
    // A client that does not answer in the read shape is a failed read, not a quiet market.
    return { state: 'unavailable', failureCode: 'query-failed' }
  }
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
