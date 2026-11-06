import { useEffect, useState } from 'react'

import { isCanonicalOpenInterestTime, type OpenInterestHistoryResult, type OpenInterestWindow } from '../../../contracts/openInterestHistory'
import type { SignalWithWindow } from '../../../contracts/moduleSignalEvidence'
import type { ModuleSignal } from '../../../contracts/moduleSignal'
import { projectDashboardPositioning, projectModuleSignalChip, type DashboardPositioningViewState } from './dashboardOpenInterestModel'
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
  signalClient?: { query: (input: { asOf: string }) => Promise<readonly SignalWithWindow[]> }
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
      setState({ state: 'unavailable', onReload: reload })
      return () => { active = false }
    }
    setState({ state: 'loading' })
    // The chip comes from the module's rule, not from the series: the two reads answer different
    // questions and either may fail alone. A missing signal is no chip, never a made-up one.
    const signals = readSignals(mountInput.signalClient ?? moduleSignalClient, asOf)
    void mountInput.client.query({ asOf, window })
      .then(async (result) => {
        if (!active) return
        const projected = projectDashboardPositioning(result, asOf, window, reload)
        const chip = projectModuleSignalChip(await signals)
        if (!active) return
        setState(projected.state === 'available'
          ? { ...projected, signal: chip }
          : projected)
      })
      .catch(() => { if (active) setState({ state: 'unavailable', onReload: reload }) })
    return () => { active = false }
    // `mountInput` is captured once on purpose: the clock must not re-read on every render.
  }, [mountInput, window, attempt])

  return state
}

/** A signal read that failed is no chip, not a fabricated one. */
async function readSignals(
  client: { query: (input: { asOf: string }) => Promise<readonly SignalWithWindow[]> },
  asOf: string
): Promise<readonly ModuleSignal[]> {
  try {
    // The chip reads the signal; the window it was judged over travels beside it.
    const entries = await client.query({ asOf })
    return entries.map(entry => entry.signal)
  } catch {
    return []
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
