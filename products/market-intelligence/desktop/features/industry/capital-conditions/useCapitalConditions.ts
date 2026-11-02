import { useEffect, useRef, useState } from 'react'

import type { IntelligenceCapitalConditionsClient } from '../../../shared/ipc/intelligenceCapitalConditionsClient'
import { isCanonicalCapitalConditionsSnapshotTime } from '../../../../contracts/intelligenceQueryContracts'

import { projectDashboardCapitalConditionsSnapshot, type DashboardCapitalConditionsState } from './capitalConditionsModel'

type Input = {
  client?: Pick<IntelligenceCapitalConditionsClient, 'querySnapshot'>
  now: () => Date
  /** Bumped by the panel's 刷新 after it has asked for the sources to be collected again. */
  reloadKey?: number
  /** Bumped by the panel's 重试, which re-reads without asking the sources for a new copy. */
  retryKey?: number
}

/**
 * How long the first read keeps trying before it admits failure.
 *
 * A read that fails instantly is usually a source still starting up, not a broken one, and the
 * reader should not see "failed" and then data a moment later — that flash reads as "your numbers
 * are gone". Two backoffs give it about 1.6 seconds to come back; after that the failure is real
 * enough to show, and the panel offers a retry.
 */
export const capitalConditionsReadRetryDelaysMs = [400, 1200] as const

export function useCapitalConditions({ client, now, reloadKey = 0, retryKey = 0 }: Input): DashboardCapitalConditionsState {
  const [state, setState] = useState<DashboardCapitalConditionsState>({ state: 'loading' })
  const [mountInput] = useState(() => ({ client, now }))
  // The attempt loop outlives a single render, so it reads the newest state from a ref instead of
  // from the closure it was created in.
  const latest = useRef(state)
  const apply = (next: DashboardCapitalConditionsState): void => {
    latest.current = next
    setState(next)
  }

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const asOf = readCanonicalClock(mountInput.now)
    const queryClient = mountInput.client
    if (!asOf || !queryClient) {
      apply({ state: 'unavailable' })
      return () => { active = false }
    }

    const read = (attempt: number): void => {
      void queryClient.querySnapshot({ asOf }).then((result) => {
        if (!active) return
        apply(projectDashboardCapitalConditionsSnapshot(result, asOf))
      }).catch(() => {
        if (!active) return
        // Readings already on screen outrank a failed refresh: keep them and say they are old.
        if (latest.current.state === 'available') {
          apply({ ...latest.current, stale: true })
          return
        }
        const delay = capitalConditionsReadRetryDelaysMs[attempt]
        if (delay === undefined) {
          apply({ state: 'unavailable' })
          return
        }
        timer = setTimeout(() => { if (active) read(attempt + 1) }, delay)
      })
    }

    read(0)
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [mountInput, reloadKey, retryKey])

  return state
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
