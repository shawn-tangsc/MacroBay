import { useEffect, useRef, useState } from 'react'

import type { MacroRatesSnapshotView } from '../../../../contracts/macro/macroRatesSnapshotContracts'
import type { MacroRatesSnapshotClient } from '../../../shared/ipc/macroRatesSnapshotClient'

/**
 * The rate rows are official **daily** closes: FRED publishes one observation per trading day, and a
 * new one cannot appear sooner than the market close. So this reads slowly — often enough to pick up
 * a new close during a session, rarely enough that a table of day-old figures is not repainted every
 * few seconds for nothing.
 */
export const macroRatesViewPolicy = Object.freeze({ settledQueryMs: 5 * 60_000 })

export type MacroRatesViewState = 'loading' | 'ready' | 'unavailable'

/**
 * Reads the daily rates snapshot for the 市场状态 table. No client, a failed call and an
 * `unavailable` answer all land on the same empty view, which the table renders as 未接入.
 */
export function useMacroRatesSnapshot({ client, disabled = false }: { client?: MacroRatesSnapshotClient; /** 读者把 10Y 那一格关掉时为 true：不读、停在加载态。 */ disabled?: boolean }): {
  snapshot: MacroRatesSnapshotView | undefined
  state: MacroRatesViewState
} {
  const [snapshot, setSnapshot] = useState<MacroRatesSnapshotView>()
  /** Read synchronously inside the poll's catch: a failed poll may not blank what is on screen. */
  const snapshotRef = useRef<MacroRatesSnapshotView>(undefined)
  const [state, setState] = useState<MacroRatesViewState>('loading')
  useEffect(() => {
    if (disabled) { setSnapshot(undefined); setState('loading'); return }
    if (!client) {
      setSnapshot(undefined)
      setState('unavailable')
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      try {
        const result = await client.query()
        if (!active) return
        snapshotRef.current = result
        setSnapshot(result)
        setState(result.state === 'unavailable' ? 'unavailable' : 'ready')
      } catch {
        if (!active) return
        setState(snapshotRef.current === undefined ? 'loading' : 'ready')
      }
      // Always the daily cadence: nothing in this snapshot can change between two closes.
      if (active) timer = setTimeout(() => { void poll() }, macroRatesViewPolicy.settledQueryMs)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [client, disabled])
  return { snapshot, state }
}
