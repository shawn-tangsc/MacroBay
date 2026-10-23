import { useEffect, useState } from 'react'

import type { MacroMarketSnapshotView } from '../../../../contracts/macro/macroMarketSnapshotContracts'
import type { MacroMarketSnapshotClient } from '../../../shared/ipc/macroMarketSnapshotClient'

/**
 * Two cadences, because the snapshot carries two kinds of fact.
 *
 * The collected levels move every fifteen minutes, but the gold row's 最新 cell rides a price stream
 * that ticks about once a second: polling at the collector's cadence would show a "live" price that
 * is minutes old, and polling that fast over a table that is only ever re-collected on the quarter
 * hour wastes the main process's time for nothing. So the next read is scheduled by what the last
 * answer contained — the live cadence while a tick exists (matching the cross-asset block, so the
 * live rows move together), the settled cadence when it does not.
 */
export const macroMarketViewPolicy = Object.freeze({
  /** While a series carries a live tick: the same second the cross-asset block polls at. */
  // Five seconds, not one: the panel repaints the whole snapshot on every answer, and a dashboard
  // that re-renders sixty times a minute reads to the reader as "the app keeps refreshing itself" —
  // which is exactly what they reported. A live price that lands within five seconds still ticks.
  liveQueryMs: 5_000,
  /** While nothing is live: the collector cannot have written a new level sooner than this. */
  settledQueryMs: 15_000
})

/** True when any reading carries a live tick, which is the only case the fast cadence is for. */
export function hasLiveReading(snapshot: MacroMarketSnapshotView | undefined): boolean {
  return snapshot?.state !== 'unavailable' && (snapshot?.readings ?? []).some(reading => reading.live !== undefined)
}

export type MacroMarketViewState = 'loading' | 'ready' | 'unavailable'

/**
 * Reads the macro-market snapshot for the 市场状态 table. No client, a failed call and an
 * `unavailable` answer all land on the same empty view, which the table renders as 未接入.
 */
export function useMacroMarketSnapshot({ client }: { client?: MacroMarketSnapshotClient }): {
  snapshot: MacroMarketSnapshotView | undefined
  state: MacroMarketViewState
} {
  const [snapshot, setSnapshot] = useState<MacroMarketSnapshotView>()
  const [state, setState] = useState<MacroMarketViewState>('loading')
  useEffect(() => {
    if (!client) {
      setSnapshot(undefined)
      setState('unavailable')
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async (): Promise<void> => {
      let nextDelay: number = macroMarketViewPolicy.settledQueryMs
      try {
        const result = await client.query()
        if (!active) return
        setSnapshot(result)
        setState(result.state === 'unavailable' ? 'unavailable' : 'ready')
        nextDelay = hasLiveReading(result) ? macroMarketViewPolicy.liveQueryMs : macroMarketViewPolicy.settledQueryMs
      } catch {
        if (!active) return
        setSnapshot(undefined)
        setState('unavailable')
      }
      if (active) timer = setTimeout(() => { void poll() }, nextDelay)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [client])
  return { snapshot, state }
}
