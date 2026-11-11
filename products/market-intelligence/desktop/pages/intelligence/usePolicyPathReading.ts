import { useCallback, useEffect, useState } from 'react'

import { policyPathClient, type PolicyPathReadResult } from '../../shared/ipc/policyPathClient'

/**
 * Reads the policy path once at mount, every ten minutes, and whenever `revision` moves
 * (a collector wrote the store).
 *
 * Ten minutes matches the collection cadence: polling faster would re-read the same stored row.
 * A failed read keeps the previous reading on screen rather than blanking the block.
 */
export function usePolicyPathReading(enabled: boolean, revision?: number): Readonly<{
  result?: PolicyPathReadResult
  /**
   * 首读回来了没有。`false` 时卡片必须画平台加载，**不许**画失败：
   * 把「还没读到」画成「暂时读不到 + 再试一次」是这条线上一版的真错。
   */
  settled: boolean
  /** 「再试一次」：立刻重读一次，不等十分钟那一轮。读失败时卡片靠它给唯一动作。 */
  reload: () => void
}> {
  const [result, setResult] = useState<PolicyPathReadResult | undefined>(undefined)
  const [settled, setSettled] = useState(false)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(value => value + 1), [])
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const read = async () => {
      // 读口自己把失败翻成 `unavailable`，不会 reject；这里仍兜一层，保证 `settled` 一定落。
      const next = await policyPathClient.read(new Date().toISOString()).catch(() => undefined)
      if (cancelled) return
      // A failed read keeps the previous reading: nothing is set, nothing is blanked.
      if (next !== undefined) setResult(next)
      setSettled(true)
    }
    void read()
    const timer = setInterval(() => { void read() }, 10 * 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [enabled, tick, revision])
  return { ...(result === undefined ? {} : { result }), settled, reload }
}
