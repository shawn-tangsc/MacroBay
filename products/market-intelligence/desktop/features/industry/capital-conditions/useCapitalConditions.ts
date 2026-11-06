import { useEffect, useRef, useState } from 'react'

import type { IntelligenceCapitalConditionsClient } from '../../../shared/ipc/intelligenceCapitalConditionsClient'
import type { ModuleSignal } from '../../../../contracts/moduleSignal'
import { isCanonicalCapitalConditionsSnapshotTime } from '../../../../contracts/intelligenceQueryContracts'
import { moduleSignalClient } from '../../../shared/ipc/moduleSignalClient'
import type { ModuleSignalAnalysisRead } from '../../../../service/intelligence/analysis/signalAnalysisRead'

import { etfChipAnalysisOf, projectDashboardCapitalConditionsSnapshot, projectEtfOutflowChip, type DashboardCapitalConditionsState } from './capitalConditionsModel'

type SignalClient = { query: (input: Readonly<{ asOf: string }>) => Promise<ModuleSignalAnalysisRead> }

type Input = {
  client?: Pick<IntelligenceCapitalConditionsClient, 'querySnapshot'>
  /** Defaults to the real bridge; a test hands in its own reader. */
  signalClient?: SignalClient
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

export function useCapitalConditions({ client, signalClient, now, reloadKey = 0, retryKey = 0 }: Input): DashboardCapitalConditionsState {
  const [state, setState] = useState<DashboardCapitalConditionsState>({ state: 'loading' })
  const [mountInput] = useState(() => ({ client, signalClient, now }))
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

    // The chip comes from the module's rule, not from the series: the two reads answer different
    // questions and either may fail alone. `undefined` means the signal read itself failed — a
    // different fact from a rule with nothing to say (`[]`), and the chip must not merge them.
    const signals = readSignals(mountInput.signalClient ?? moduleSignalClient, asOf)

    const read = (attempt: number): void => {
      void queryClient.querySnapshot({ asOf }).then(async (result) => {
        const projected = projectDashboardCapitalConditionsSnapshot(result, asOf)
        const read = await signals
        const chip = projectEtfOutflowChip(read)
        const analysis = etfChipAnalysisOf(read)
        if (!active) return
        apply(projected.state === 'available'
          ? { ...projected, etfSignal: chip, ...(analysis ? { etfSignalAnalysis: analysis } : {}) }
          : projected)
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

async function readSignals(client: SignalClient, asOf: string): Promise<ModuleSignalAnalysisRead> {
  try {
    // The window belongs to the chip too, but this hook only needs the signal to pick its state.
    return await client.query({ asOf })
  } catch {
    // One shape for "could not read", whether the client threw or answered in another shape.
    return { state: 'unavailable', failureCode: 'query-failed' }
  }
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
