import { useEffect, useState } from 'react'

import type { IntelligenceFearGreedClient } from '../../features/industry/fear-greed'
import { isCanonicalFearGreedSnapshotTime } from '../../../contracts/intelligenceQueryContracts'
import { projectDashboardFearGreedSnapshot, type DashboardFearGreedState } from './dashboardFearGreedModel'

type Input = {
  client: Pick<IntelligenceFearGreedClient, 'querySnapshot'>
  now: () => Date
}

export function useDashboardFearGreed({ client, now }: Input): DashboardFearGreedState {
  const [state, setState] = useState<DashboardFearGreedState>({ state: 'loading' })
  const [mountInput] = useState(() => ({ client, now }))

  useEffect(() => {
    let active = true
    const asOf = readCanonicalClock(mountInput.now)
    if (!asOf) {
      setState({ state: 'unavailable' })
      return () => { active = false }
    }
    void mountInput.client.querySnapshot({ asOf }).then((result) => {
      if (active) setState(projectDashboardFearGreedSnapshot(result, asOf))
    }).catch(() => {
      if (active) setState({ state: 'unavailable' })
    })
    return () => { active = false }
  }, [mountInput])

  return state
}

function readCanonicalClock(now: () => unknown): string | undefined {
  try {
    const instant = now()
    if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) return undefined
    const asOf = instant.toISOString()
    return isCanonicalFearGreedSnapshotTime(asOf) ? asOf : undefined
  } catch {
    return undefined
  }
}
