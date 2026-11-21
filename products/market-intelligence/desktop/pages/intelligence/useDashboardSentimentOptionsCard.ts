import { useCallback, useEffect, useRef, useState } from 'react'

import type { IntelligenceSentimentOptionsCardClient } from '../../shared/ipc/intelligenceSentimentOptionsCardClient'
import { isCanonicalFearGreedSnapshotTime, type SentimentOptionsCardResult } from '../../../contracts/intelligenceQueryContracts'
import { withQueryDeadline } from '../../shared/ipc/queryDeadline'

export type DashboardSentimentOptionsState =
  | { state: 'loading' }
  | { state: 'available'; result: SentimentOptionsCardResult }
  | { state: 'unavailable' }

type Input = {
  client: Pick<IntelligenceSentimentOptionsCardClient, 'query'>
  now: () => Date
  timeZone: string
  /** Both halves unusable / not connected: send no request at all. */
  disabled?: boolean
  revision?: number
}

/**
 * One read for the whole card: both halves come from the same composite query, so refresh, data
 * events and the page's fallback tick all go through this single door.
 *
 * A background re-read keeps the reading on screen (no whole-card loading) and a failure keeps the
 * previous reading; only the first read shows loading. Debounce/single-flight live in the page's
 * revision source, not here.
 */
export function useDashboardSentimentOptionsCard({ client, now, timeZone, disabled = false, revision }: Input): Readonly<{
  state: DashboardSentimentOptionsState
  reload: () => void
}> {
  const [state, setState] = useState<DashboardSentimentOptionsState>({ state: 'loading' })
  const [attempt, setAttempt] = useState(0)
  /** 同一时间只允许一路在飞；在飞期间来的重读只记一笔，落地后补一次。 */
  const [dirtyTick, setDirtyTick] = useState(0)
  const inFlight = useRef(false)
  const dirty = useRef(false)
  const [mountInput] = useState(() => ({ client, now }))
  const revisionRef = useRef<number | undefined>(revision)
  const lastResult = useRef<SentimentOptionsCardResult | undefined>(undefined)
  const reload = useCallback(() => setAttempt(current => current + 1), [])

  useEffect(() => {
    let active = true
    const quiet = revisionRef.current !== undefined && revisionRef.current !== revision
    revisionRef.current = revision
    if (!quiet) setState({ state: 'loading' })
    if (disabled) return () => { active = false }
    const asOf = readCanonicalClock(mountInput.now)
    if (!asOf) {
      setState({ state: 'unavailable' })
      return () => { active = false }
    }
    if (inFlight.current) {
      dirty.current = true
      return () => { active = false }
    }
    inFlight.current = true
    dirty.current = false
    void withQueryDeadline(mountInput.client.query({ asOf, timeZone, windowDays: 30 })).then((result) => {
      if (!active) return
      lastResult.current = result
      setState({ state: 'available', result })
    }).catch(() => {
      if (!active) return
      const held = lastResult.current
      // 后台重读失败保留旧读数；不置 loading，也不自动重试——下一次由读者或事件触发。
      setState(quiet && held ? { state: 'available', result: held } : { state: 'unavailable' })
    }).finally(() => {
      inFlight.current = false
      if (dirty.current) {
        dirty.current = false
        setDirtyTick(tick => tick + 1)
      }
    })
    return () => { active = false }
  }, [mountInput, attempt, dirtyTick, disabled, revision, timeZone])

  return { state, reload }
}

function readCanonicalClock(now: () => Date): string | undefined {
  try {
    const value = now().toISOString()
    return isCanonicalFearGreedSnapshotTime(value) ? value : undefined
  } catch {
    return undefined
  }
}