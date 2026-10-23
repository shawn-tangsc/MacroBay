import { useEffect, useRef, useState } from 'react'
import type { createCrossAssetObservationClient } from '../../../shared/ipc/crossAssetObservationClient'
import type { CrossAssetRange, CrossAssetSnapshot } from '../../../../contracts/crossAssetObservationContracts'

export const crossAssetViewPolicy = Object.freeze({ queryMs: 1000, renewMs: 10_000 })

export function useCrossAssetObservation({ client }: { client: ReturnType<typeof createCrossAssetObservationClient> }) {
  const [range, setRange] = useState<CrossAssetRange>('24h')
  const [snapshot, setSnapshot] = useState<CrossAssetSnapshot>()
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
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
    const unavailable = () => {
      setState('unavailable')
      setSnapshot(previous => previous?.mode !== 'current' ? previous : {
        ...previous, sourceState: 'unavailable', forming: { index: null, btc: null, eth: null },
        observationKey: { indexBtc: 'unavailable', ethBtc: 'unavailable' },
        quotes: previous.quotes && Object.fromEntries(Object.entries(previous.quotes).map(([asset, quote]) =>
          [asset, quote.state === 'missing' ? quote : { ...quote, state: 'stale' }])) as CrossAssetSnapshot['quotes']
      })
    }
    const release = (id: string) => { void client.release(id).catch(() => undefined) }
    const stop = () => {
      active = false; generation++
      clearTimeout(queryTimer); clearTimeout(renewTimer); clearTimeout(retryTimer)
      const id = leaseRef.current; leaseRef.current = undefined
      if (id) release(id)
    }
    const retry = () => {
      stop(); unavailable()
      retryTimer = setTimeout(() => { if (mounted.current) void start() }, crossAssetViewPolicy.renewMs)
    }
    const poll = async (epoch: number) => {
      if (!current(epoch)) return
      if (!queryBusy.current) {
        queryBusy.current = true
        const requestedRange = rangeRef.current
        try {
          const result = await client.query({ range: requestedRange })
          if (current(epoch) && requestedRange === rangeRef.current) {
            if ('schemaVersion' in result) { setSnapshot(result); setState('ready') }
            else unavailable()
          }
        } catch { if (current(epoch)) unavailable() }
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
    try { await client.refresh(leaseId) } catch { if (mounted.current) setState('unavailable') }
    finally { if (mounted.current) setRefreshing(false) }
  }
  return { range, setRange, snapshot: snapshot?.range === range ? snapshot : undefined, state, refreshing, refresh }
}
