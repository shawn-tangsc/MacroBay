import { useEffect, useRef, useState } from 'react'
import type { createCrossAssetObservationClient } from '../../../shared/ipc/crossAssetObservationClient'
import type { CrossAssetRange, CrossAssetSnapshot } from '../../../../contracts/crossAssetObservationContracts'

export const crossAssetViewPolicy = Object.freeze({
  queryMs: 1000,
  renewMs: 10_000,
  /**
   * Before the first successful read, a failed lease or query is "not ready yet", not "the read
   * failed": the runtime warms up for a moment on first open. Retry on this ladder (≈31s in total)
   * and only then show the error state — a terminal state is required, otherwise a broken runtime
   * would spin forever instead of saying so.
   */
  firstReadBackoffMs: Object.freeze([1000, 2000, 4000, 8000, 16000] as const)
})

export function useCrossAssetObservation({ client }: { client: ReturnType<typeof createCrossAssetObservationClient> }) {
  const [range, setRange] = useState<CrossAssetRange>('24h')
  const [snapshot, setSnapshot] = useState<CrossAssetSnapshot>()
  /** The same value, readable synchronously from the effect's timeout callbacks. */
  const snapshotRef = useRef<CrossAssetSnapshot>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  /** The rows on screen are from an earlier successful read; the newest attempt failed. */
  const [stale, setStale] = useState(false)
  /** Why it is unavailable: an unreadable contract needs a restart, a failed query needs a retry. */
  const [failure, setFailure] = useState<'query' | 'contract'>()
  const [refreshing, setRefreshing] = useState(false)
  const rangeRef = useRef(range)
  rangeRef.current = range
  const leaseRef = useRef<string | undefined>(undefined)
  const queryBusy = useRef(false)
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    let active = false
    let generation = 0
    let queryTimer: ReturnType<typeof setTimeout> | undefined
    let renewTimer: ReturnType<typeof setTimeout> | undefined
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const current = (epoch: number) => active && mounted.current && epoch === generation
    // Counts consecutive failures since the last good answer. A contract refusal is not retried:
    // a main process on another version will keep answering the same shape.
    let failures = 0
    /**
     * A failed attempt. With rows on screen nothing is blanked: they stay and are marked stale.
     * Before the first success the panel keeps saying loading until the ladder is exhausted, and
     * only then turns to the error state.
     */
    const failed = (cause: 'query' | 'contract' = 'query') => {
      failures += 1
      const terminal = cause === 'contract' || failures > crossAssetViewPolicy.firstReadBackoffMs.length
      const previous = snapshotRef.current
      if (previous) {
        // With rows on screen a failure only marks them; it never blanks them into an error screen.
        const marked: CrossAssetSnapshot = previous.mode !== 'current' ? previous : {
          ...previous, sourceState: 'unavailable', forming: { index: null, btc: null, eth: null },
          quotes: previous.quotes && Object.fromEntries(Object.entries(previous.quotes).map(([asset, quote]) =>
            [asset, quote.state === 'missing' ? quote : { ...quote, state: 'stale' }])) as CrossAssetSnapshot['quotes']
        }
        snapshotRef.current = marked
        setSnapshot(marked)
        setStale(true)
        setState('ready')
        return
      }
      if (terminal) { setFailure(cause); setState('error') }
    }
    const release = (id: string) => { void client.release(id).catch(() => undefined) }
    const stop = () => {
      active = false; generation++
      clearTimeout(queryTimer); clearTimeout(renewTimer); clearTimeout(retryTimer)
      const id = leaseRef.current; leaseRef.current = undefined
      if (id) release(id)
    }
    /**
     * The lease was lost or the runtime was not ready yet. That is not a failed read: keep the
     * panel in loading (or keep the rows it has) and come back after a backoff step.
     */
    const retry = () => {
      stop()
      failures += 1
      // The ladder is finite on purpose: "not ready yet" may be retried, but it must end in a
      // state the reader can act on (`error` + 再试一次) instead of a spinner that never stops.
      if (failures > crossAssetViewPolicy.firstReadBackoffMs.length) {
        if (snapshotRef.current) { setStale(true); setState('ready') }
        else { setFailure('query'); setState('error') }
        return
      }
      setState(current => current === 'ready' ? 'ready' : 'loading')
      const delay = crossAssetViewPolicy.firstReadBackoffMs[failures - 1]!
      retryTimer = setTimeout(() => { if (mounted.current) void start() }, delay)
    }
    const poll = async (epoch: number) => {
      if (!current(epoch)) return
      if (!queryBusy.current) {
        queryBusy.current = true
        const requestedRange = rangeRef.current
        try {
          const result = await client.query({ range: requestedRange })
          if (current(epoch) && requestedRange === rangeRef.current) {
            if ('schemaVersion' in result) {
              failures = 0
              snapshotRef.current = result
              setSnapshot(result); setState('ready'); setFailure(undefined); setStale(false)
            } else failed(result.cause ?? 'query')
          }
        } catch { if (current(epoch)) failed() }
        finally { queryBusy.current = false }
      }
      if (current(epoch)) queryTimer = setTimeout(() => { void poll(epoch) }, crossAssetViewPolicy.queryMs)
    }
    const renew = async (epoch: number) => {
      if (!current(epoch) || !leaseRef.current) return
      try {
        const result = await client.renew(leaseRef.current)
        if (current(epoch) && result.state !== 'active') { retry(); return }
      } catch { if (current(epoch)) retry(); return }
      if (current(epoch)) renewTimer = setTimeout(() => { void renew(epoch) }, crossAssetViewPolicy.renewMs)
    }
    const start = async () => {
      if (active || document.hidden) return
      active = true
      const epoch = ++generation
      void poll(epoch)
      try {
        const lease = await client.acquire()
        if (lease.state !== 'active') { if (current(epoch)) retry(); return }
        if (!current(epoch)) { release(lease.leaseId); return }
        leaseRef.current = lease.leaseId
        renewTimer = setTimeout(() => { void renew(epoch) }, crossAssetViewPolicy.renewMs)
      } catch { if (current(epoch)) retry() }
    }
    const visibility = () => { if (document.hidden) stop(); else void start() }
    document.addEventListener('visibilitychange', visibility)
    void start()
    return () => { mounted.current = false; stop(); document.removeEventListener('visibilitychange', visibility) }
  }, [client])
  const refresh = async () => {
    const leaseId = leaseRef.current
    if (!leaseId || refreshing) return
    setRefreshing(true)
    try {
      await client.refresh(leaseId)
    } catch {
      // A refresh that failed keeps the rows it already had and marks them as the previous read;
      // only a panel with nothing on screen falls to the error state.
      if (mounted.current) { setStale(true); setState(current => current === 'ready' ? 'ready' : 'error') }
    } finally { if (mounted.current) setRefreshing(false) }
  }
  return { range, setRange, snapshot: snapshot?.range === range ? snapshot : undefined, state, stale, failure, refreshing, refresh }
}
