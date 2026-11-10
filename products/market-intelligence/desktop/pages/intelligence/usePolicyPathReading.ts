import { useCallback, useEffect, useState } from 'react'

import { policyPathClient, type PolicyPathReadResult } from '../../shared/ipc/policyPathClient'

/**
 * Reads the policy path once at mount and then every ten minutes.
 *
 * Ten minutes matches the collection cadence: polling faster would re-read the same stored row.
 * A failed read keeps the previous reading on screen rather than blanking the block.
 */
export function usePolicyPathReading(enabled: boolean): Readonly<{
  result?: PolicyPathReadResult
  /** 「再试一次」：立刻重读一次，不等十分钟那一轮。读失败时卡片靠它给唯一动作。 */
  reload: () => void
}> {
  const [result, setResult] = useState<PolicyPathReadResult | undefined>(undefined)
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick(value => value + 1), [])
  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false
    const read = async () => {
      const next = await policyPathClient.read(new Date().toISOString())
      if (!cancelled) setResult(next)
    }
    void read()
    const timer = setInterval(() => { void read() }, 10 * 60_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [enabled, tick])
  return { ...(result === undefined ? {} : { result }), reload }
}
