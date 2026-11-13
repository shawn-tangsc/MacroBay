import { useEffect, useRef, useState } from 'react'
import { withQueryDeadline } from '../../../shared/ipc/queryDeadline'

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
export function useMacroMarketSnapshot({ client, disabled = false, dollarSourceId }: { client?: MacroMarketSnapshotClient; /** 读者把美元/黄金两格都关掉时为 true：不读、停在加载态。 */ disabled?: boolean; /** 读者给美元格选的源；不传 = 没选过，走今天的默认规则。 */ dollarSourceId?: string }): {
  snapshot: MacroMarketSnapshotView | undefined
  state: MacroMarketViewState
} {
  const [snapshot, setSnapshot] = useState<MacroMarketSnapshotView>()
  /** Read synchronously inside the poll's catch: a failed poll may not blank what is on screen. */
  const snapshotRef = useRef<MacroMarketSnapshotView>(undefined)
  const [state, setState] = useState<MacroMarketViewState>('loading')
  useEffect(() => {
    // 关掉的格不读，也不给结论：停在加载态，表格里那几行由上层整行跳过。
    if (disabled) { setSnapshot(undefined); setState('loading'); return }
    if (!client) {
      setSnapshot(undefined)
      setState('unavailable')
      return
    }
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    /** 首答之前的连续失败数：读口挂了 10 秒期限，但轮询本身不该无限「加载中」。 */
    let failures = 0
    const poll = async (): Promise<void> => {
      let nextDelay: number = macroMarketViewPolicy.settledQueryMs
      try {
        const result = await withQueryDeadline(client.query(dollarSourceId === undefined ? {} : { dollarSourceId }))
        if (!active) return
        snapshotRef.current = result
        failures = 0
        setSnapshot(result)
        setState(result.state === 'unavailable' ? 'unavailable' : 'ready')
        nextDelay = hasLiveReading(result) ? macroMarketViewPolicy.liveQueryMs : macroMarketViewPolicy.settledQueryMs
      } catch {
        if (!active) return
        // A failed poll is not a failed read. Before the first answer the table waits — but **不无限**：
        // 每轮读都有 10 秒期限，连续 3 轮都没有答案就落 `unavailable`（可重试、不是「没有数据」）；
        // 有数据之后保持旧行。轮询继续，恢复时自己会变成 ready。
        if (snapshotRef.current !== undefined) {
          setState('ready')
        } else {
          failures += 1
          setState(failures >= 3 ? 'unavailable' : 'loading')
        }
      }
      if (active && snapshotRef.current !== undefined) failures = 0
      if (active) timer = setTimeout(() => { void poll() }, nextDelay)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [client, disabled, dollarSourceId])
  return { snapshot, state }
}
