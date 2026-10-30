import { useEffect, useState } from 'react'

import { policyPathClient, type PolicyPathReadResult } from '../../shared/ipc/policyPathClient'

/**
 * Reads the policy path once at mount and then every ten minutes.
 *
 * Ten minutes matches the collection cadence: polling faster would re-read the same stored row.
 * A failed read keeps the previous reading on screen rather than blanking the block.
 */
export function usePolicyPathReading(enabled: boolean): PolicyPathReadResult | undefined {
  const [result, setResult] = useState<PolicyPathReadResult | undefined>(undefined)
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
  }, [enabled])
  return result
}
