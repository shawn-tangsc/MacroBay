import { useEffect, useRef, useState } from 'react'
import { withQueryDeadline } from '../../../shared/ipc/queryDeadline'

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
export function useMacroRatesSnapshot({ client, disabled = false, refreshToken = 0 }: {
  client?: MacroRatesSnapshotClient
  /** 读者把 10Y 那一格关掉时为 true：不读、停在加载态。 */
  disabled?: boolean
  /** 刷新按钮：换一个值就重读同一份快照（表与图一起），不新开第二条读路径。 */
  refreshToken?: number
}): {
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
    /** 首答之前的连续失败数：读口挂了 10 秒期限，但轮询本身不该无限「加载中」。 */
    let failures = 0
    const poll = async (): Promise<void> => {
      try {
        const result = await withQueryDeadline(client.query())
        if (!active) return
        snapshotRef.current = result
        failures = 0
        setSnapshot(result)
        setState(result.state === 'unavailable' ? 'unavailable' : 'ready')
      } catch {
        if (!active) return
        // 每轮读都有 10 秒期限，但轮询本身不该无限「加载中」：首答前连续 3 轮没有答案就落
        // `unavailable`（可重试、不是「没有数据」）；有数据之后保持旧行。轮询继续，恢复时自己变 ready。
        if (snapshotRef.current !== undefined) {
          setState('ready')
        } else {
          failures += 1
          setState(failures >= 3 ? 'unavailable' : 'loading')
        }
      }
      // Always the daily cadence: nothing in this snapshot can change between two closes.
      if (active) timer = setTimeout(() => { void poll() }, macroRatesViewPolicy.settledQueryMs)
    }
    void poll()
    return () => { active = false; clearTimeout(timer) }
  }, [client, disabled, refreshToken])
  return { snapshot, state }
}
