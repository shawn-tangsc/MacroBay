import { useEffect, useState } from 'react'

import type { IntelligenceCapitalConditionsClient } from '../../../shared/ipc/intelligenceCapitalConditionsClient'
import { isCanonicalCapitalConditionsSnapshotTime } from '../../../../contracts/intelligenceQueryContracts'

import { projectDashboardCapitalConditionsSnapshot, type DashboardCapitalConditionsState } from './capitalConditionsModel'

type Input = {
  client?: Pick<IntelligenceCapitalConditionsClient, 'querySnapshot'>
  now: () => Date
  /** Bumped by the panel's 刷新 after it has asked for the sources to be collected again. */
  reloadKey?: number
}

export function useCapitalConditions({ client, now, reloadKey = 0 }: Input): DashboardCapitalConditionsState {
  const [state, setState] = useState<DashboardCapitalConditionsState>({ state: 'loading' })
  const [mountInput] = useState(() => ({ client, now }))

  useEffect(() => {
    let active = true
    const asOf = readCanonicalClock(mountInput.now)
    if (!asOf || !mountInput.client) {
      setState({ state: 'unavailable' })
      return () => { active = false }
    }
    void mountInput.client.querySnapshot({ asOf }).then((result) => {
      if (active) setState((previous) => keepLastReadings(previous, projectDashboardCapitalConditionsSnapshot(result, asOf)))
    }).catch(() => {
      if (active) setState((previous) => keepLastReadings(previous, { state: 'unavailable' }))
    })
    return () => { active = false }
  }, [mountInput, reloadKey])

  return state
}

/**
 * A re-read that fails must not erase readings the reader already has: the panel keeps the last
 * good state instead of replacing it with an error view. A first read has nothing to keep, so a
 * failure there still reports itself. (The "these are the previous readings" label needs a copy key
 * that is currently being edited by another line, so it lands on its own.)
 */
function keepLastReadings(
  previous: DashboardCapitalConditionsState,
  next: DashboardCapitalConditionsState
): DashboardCapitalConditionsState {
  return next.state === 'unavailable' && previous.state === 'available' ? previous : next
}

function readCanonicalClock(now: () => unknown): string | undefined {
  try {
    const instant = now()
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return undefined
    const asOf = instant.toISOString()
    return isCanonicalCapitalConditionsSnapshotTime(asOf) ? asOf : undefined
  } catch {
    return undefined
  }
}
