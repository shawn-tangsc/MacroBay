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
  /** 读者把资本这两格关掉了：不读、停在等待态；卡片由上层整张跳过。 */
  disabled?: boolean
  /** 「采集写了库」的计数：变了就重读一次（读失败沿用上一次并标 `stale`，这条已有）。 */
  revision?: number
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

export function useCapitalConditions({ client, signalClient, now, reloadKey = 0, retryKey = 0, disabled = false, revision = 0 }: Input): DashboardCapitalConditionsState {
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
    if (disabled) { apply({ state: 'loading' }); return () => { active = false } }
    const asOf = readCanonicalClock(mountInput.now)
    const queryClient = mountInput.client
    if (!asOf || !queryClient) {
      // 两种都不是「读了但没读成」：时钟不合法是调用方给错了 asOf，客户端没接上是装配缺了东西。
      // 它们与读失败分开，读者才不会对着一个永远不会好的重试一直点。
      apply({ state: 'unavailable', reason: asOf ? 'client-unavailable' : 'invalid-clock' })
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
          apply({ state: 'unavailable', reason: 'query-failed' })
          return
        }
        timer = setTimeout(() => { if (active) read(attempt + 1) }, delay)
      })
    }

    read(0)
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [mountInput, reloadKey, retryKey, disabled, revision])

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
