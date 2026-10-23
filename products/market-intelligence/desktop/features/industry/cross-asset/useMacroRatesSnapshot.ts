import { useEffect, useState } from 'react'

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
export function useMacroRatesSnapshot({ client }: { client?: MacroRatesSnapshotClient }): {
  snapshot: MacroRatesSnapshotView | undefined
  state: MacroRatesViewState
} {
  const [snapshot, setSnapshot] = useState<MacroRatesSnapshotView>()
  const [state, setState] = useState<MacroRatesViewState>('loading')
  useEffect(() => {
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
        setSnapshot(result)
        setState(result.state === 'unavailable' ? 'unavailable' : 'ready')
      } catch {
        if (!active) return
        setSnapshot(undefined)
        setState('unavailable')
      }
      // Always the daily cadence: nothing in this snapshot can change between two closes.
      if (active) timer = setTimeout(() => { void poll() }, macroRatesViewPolicy.settledQueryMs)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [client])
  return { snapshot, state }
}
