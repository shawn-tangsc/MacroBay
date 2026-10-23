import { CrossAssetClientError, type BinanceAsset, type createBinanceCrossAssetClient, type ClosedBar } from './binanceCrossAssetClient'
import type { createBinanceCrossAssetStream } from './binanceCrossAssetStream'
import { createCrossAssetLeaseStore } from './crossAssetLeaseStore'
import { crossAssetPolicy, type CrossAssetRow } from './crossAssetPolicy'
import { crossAssetStoragePolicy } from './crossAssetStore'
import { createCrossAssetBackfill } from './crossAssetBackfill'
import { createCrossAssetInterfaceTest } from './crossAssetInterfaceTest'

type Stream = ReturnType<typeof createBinanceCrossAssetStream>
/** A row's live trade. Quoted by row, not by Binance contract: the panel and the contract are row-keyed. */
type RowQuote = { state: 'live' | 'stale'; price: string; tradedAtMs: number; receivedAtMs: number } | { state: 'missing' }
type State = 'disabled' | 'connecting' | 'live' | 'stale' | 'limited' | 'unavailable'
type Store = {
  append: (input: { bars: readonly ClosedBar[]; observedAtMs: number; origin: 'rest' | 'ws' }) => { state: string }
  queryAt: (input: { symbol: ClosedBar['symbol']; fromMs: number; toMs: number; asOfMs: number }) => readonly ClosedBar[]
}

export function createCrossAssetRuntime(deps: {
  now: () => number; readEnabled: () => Promise<boolean>
  client: Pick<ReturnType<typeof createBinanceCrossAssetClient>, 'fetchMetadata' | 'fetchClosedBars'>
  store: Store; createStream: (onState: (state: ReturnType<Stream['snapshot']>['state']) => void) => Stream
}) {
  const leases = createCrossAssetLeaseStore(deps)
  const backfill = createCrossAssetBackfill(deps)
  let state: State = 'connecting'
  let enabled = false
  let disposed = false
  let generation = 0
  let stream: Stream | undefined
  let controller: AbortController | undefined
  let pending: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let checking = false
  let limitedUntil = 0
  let banned = false
  let storageBlocked: 'limited' | 'unavailable' | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectAttempt = 0
  let connectedAt = 0
  let testController: AbortController | undefined
  let testSocket: Stream | undefined
  let lastRepairAt = -Infinity
  let priceDecimals: Partial<Record<BinanceAsset, number>> = {}
  let admittedAssets: BinanceAsset[] = []
  let lastSuccessfulWriteAt: number | null = null
  let closedBacklogPeak = 0
  const maintenanceNextByAsset = new Map<BinanceAsset, number>()
  let maintenancePending = false

  function persist(bars: readonly ClosedBar[], origin: 'rest' | 'ws'): boolean {
    if (origin === 'ws') closedBacklogPeak = Math.max(closedBacklogPeak, bars.length)
    bars = bars.filter(bar => admittedAssets.some(asset => crossAssetPolicy.binanceAssets[asset] === bar.symbol))
    for (let index = 0; index < bars.length; index += crossAssetStoragePolicy.batchLimit) {
      const result = deps.store.append({ bars: bars.slice(index, index + crossAssetStoragePolicy.batchLimit), observedAtMs: deps.now(), origin })
      if (result.state !== 'updated' && result.state !== 'unchanged') {
        state = result.state === 'limited' ? 'limited' : 'unavailable'
        storageBlocked = state
        stop(false)
        return false
      }
      if (result.state === 'updated') lastSuccessfulWriteAt = deps.now()
    }
    return true
  }

  function stop(drain = true) {
    generation++
    controller?.abort(); controller = undefined
    if (stream) {
      const closed = stream.takeClosed()
      stream.close(); stream = undefined
      if (drain && !storageBlocked && closed.length) persist(closed, 'ws')
    }
    if (timer) clearInterval(timer)
    timer = undefined
    if (reconnectTimer) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }

  function scheduleReconnect() {
    if (disposed || !enabled || !leases.count() || reconnectTimer || banned || storageBlocked) return
    const delays = crossAssetPolicy.reconnect.delaysMs
    const delay = delays[Math.min(reconnectAttempt++, delays.length - 1)]
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      void reconcile().then(() => launch())
    }, Math.max(limitedUntil - deps.now(), delay * (1 + Math.random() * crossAssetPolicy.reconnect.jitterRatio)))
  }

  function launch(repair = false) {
    if (pending || testController || reconnectTimer || disposed || !enabled || !leases.count() || banned || storageBlocked || deps.now() < limitedUntil) return
    const currentGeneration = generation
    controller = new AbortController()
    const signal = controller.signal
    const current = () => !disposed && enabled && leases.count() > 0 && currentGeneration === generation && !signal.aborted
    const operation = (async () => {
      try {
        const admitted = await deps.client.fetchMetadata({ signal })
        if (!current()) return
        priceDecimals = Object.fromEntries(admitted.filter(asset => asset.state === 'admitted').map(asset => [asset.asset, asset.priceDecimals]))
        admittedAssets = admitted.filter(asset => asset.state === 'admitted').map(asset => asset.asset)
        if (!admittedAssets.length) { stop(); state = 'unavailable'; return }
        if (!stream) {
          connectedAt = deps.now()
          stream = deps.createStream(next => {
          if (!current()) return
          if (next === 'connected' && !pending) state = 'live'
          if (next === 'disconnected' || next === 'overflow') {
            if (deps.now() - connectedAt >= crossAssetPolicy.reconnect.stableResetMs) reconnectAttempt = 0
            stop(); state = 'stale'
            scheduleReconnect()
          }
          })
        }
        state = 'connecting'
        const endMs = Math.floor(deps.now() / crossAssetPolicy.intervalMs) * crossAssetPolicy.intervalMs
        for (const asset of admittedAssets) {
          if (repair) {
            const bars = await deps.client.fetchClosedBars({ asset, endMs, limit: crossAssetPolicy.repair.trailingBars }, { signal })
            if (!current() || !persist(bars, 'rest')) return
            continue
          }
          for await (const bars of backfill.collect({ asset, endMs, asOfMs: deps.now() }, { signal })) {
            if (!current()) return
            if (!persist(bars, 'rest')) return
          }
        }
        if (current() && stream) {
          if (!persist(stream.takeClosed(), 'ws')) return
          state = stream.snapshot().state === 'connected' ? 'live' : 'stale'
        }
      } catch (error) {
        if (!current()) return
        if (error instanceof CrossAssetClientError && error.code === 'rate-limited') {
          limitedUntil = deps.now() + (error.retryAfterMs ?? crossAssetPolicy.http.retryFallbackMs); state = 'limited'
        } else if (error instanceof CrossAssetClientError && error.code === 'request-banned') {
          banned = true; state = 'limited'
        } else state = 'unavailable'
        if (!banned) scheduleReconnect()
      }
    })()
    pending = operation
    void operation.finally(() => { if (pending === operation) pending = undefined })
  }

  async function reconcile() {
    if (checking || disposed) return
    checking = true
    try {
      const nextEnabled = await deps.readEnabled()
      if (disposed) return
      enabled = nextEnabled
      if (!enabled || !leases.count()) { stop(); state = enabled ? 'stale' : 'disabled'; return }
      if (!timer) timer = setInterval(() => { void reconcile() }, crossAssetPolicy.leases.profileCheckMs)
      if (storageBlocked) { state = storageBlocked; return }
      if (stream && !pending) {
        if (!persist(stream.takeClosed(), 'ws')) return
        const now = deps.now()
        const endMs = Math.floor(now / crossAssetPolicy.intervalMs) * crossAssetPolicy.intervalMs
        if (now - endMs >= crossAssetPolicy.repair.missingGraceMs && now - lastRepairAt >= crossAssetPolicy.repair.minIntervalMs &&
          !testController && !banned && now >= limitedUntil && !reconnectTimer) {
          const missing = admittedAssets.map(asset => crossAssetPolicy.binanceAssets[asset]).some(symbol => !deps.store.queryAt({
            symbol, fromMs: endMs - crossAssetPolicy.intervalMs, toMs: endMs - crossAssetPolicy.intervalMs, asOfMs: now
          }).some(bar => bar.barEndMs === endMs))
          if (missing) { lastRepairAt = now; launch(true) }
        }
      }
      if (!stream) launch()
    } catch { stop(); state = 'unavailable' }
    finally { checking = false }
  }

  const runtime = {
    async acquire() {
      if (disposed) return { state: 'unavailable' as const }
      const lease = leases.acquire()
      if (lease.state === 'active') await reconcile()
      return lease
    },
    async renew(leaseId: string) { const result = leases.renew(leaseId); await reconcile(); return result },
    async release(leaseId: string) {
      const result = leases.release(leaseId); await reconcile(); return result
    },
    async refresh(leaseId: string) {
      if (!leases.has(leaseId) || disposed) return { state: 'expired' }
      await reconcile()
      if (!enabled) return { state: 'disabled' }
      if (pending || testController) return { state: 'busy' }
      if (deps.now() < limitedUntil) return { state: 'limited' }
      banned = false
      storageBlocked = undefined
      launch()
      return { state: 'accepted' }
    },
    async maintain(leaseId: string, asset: BinanceAsset, signal?: AbortSignal) {
      if (!leases.has(leaseId) || disposed) return { state: 'expired' as const }
      if (!Object.hasOwn(crossAssetPolicy.binanceAssets, asset)) return { state: 'invalid' as const }
      if (maintenancePending) return { state: 'busy' as const }
      maintenancePending = true
      const step = crossAssetPolicy.intervalMs
      const endMs = Math.floor(deps.now() / step) * step
      const nextBarOpenMs = maintenanceNextByAsset.get(asset) ?? Math.max(0, endMs - crossAssetPolicy.repair.trailingBars * step)
      try {
        let bars: readonly ClosedBar[]
        try {
          bars = await deps.client.fetchClosedBars({ asset, endMs, limit: crossAssetPolicy.repair.trailingBars }, { signal })
        } catch {
          if (signal?.aborted) {
            maintenanceNextByAsset.set(asset, nextBarOpenMs)
            return { state: 'cancelled' as const, nextBarOpenMs }
          }
          return { state: 'unavailable' as const, nextBarOpenMs }
        }
        const ordered = [...bars].sort((a, b) => a.barOpenMs - b.barOpenMs)
        for (const item of ordered) {
          if (item.barOpenMs < nextBarOpenMs) continue
          if (signal?.aborted) {
            maintenanceNextByAsset.set(asset, item.barOpenMs)
            return { state: 'cancelled' as const, nextBarOpenMs: item.barOpenMs }
          }
          if (!persist([item], 'rest')) return { state: 'unavailable' as const, nextBarOpenMs: item.barOpenMs }
          maintenanceNextByAsset.set(asset, item.barOpenMs + step)
        }
        maintenanceNextByAsset.delete(asset)
        return { state: 'completed' as const }
      } finally { maintenancePending = false }
    },
    async cancelInterfaceTest() { testController?.abort(); return { state: 'cancelled' as const } },
    async testInterface() {
      if (disposed) return { state: 'unavailable' }
      if (testController || pending) return { state: 'busy' }
      if (deps.now() < limitedUntil || banned) return { state: 'limited' }
      const control = new AbortController()
      testController = control
      const deadline = setTimeout(() => control.abort(), crossAssetPolicy.interfaceTest.deadlineMs)
      // The sampling socket is chosen here because it belongs to this runtime's lifecycle: the live
      // collection socket when one exists, and a temporary one this test owns and must close.
      const sampling = stream ?? (testSocket = deps.createStream(() => undefined))
      try {
        return await createCrossAssetInterfaceTest({
          now: deps.now, sampling,
          fetchClosedBars: (input, sample) => deps.client.fetchClosedBars(input, sample),
          onRateLimited: retryAfterMs => {
            limitedUntil = deps.now() + (retryAfterMs ?? crossAssetPolicy.http.retryFallbackMs)
          },
          onBanned: () => { banned = true }
        }).run(control.signal)
      } finally {
        clearTimeout(deadline)
        testSocket?.close(); testSocket = undefined
        testController = undefined
      }
    },
    snapshot() {
      const incoming = stream?.snapshot().quotes
      const rows = Object.keys(crossAssetPolicy.assets) as CrossAssetRow[]
      const quotes = Object.fromEntries(rows.map(row => {
        const asset = crossAssetPolicy.liveQuoteAssets[row] as BinanceAsset
        return [row, admittedAssets.includes(asset) && incoming ? incoming[asset] : { state: 'missing' as const }]
      })) as Record<CrossAssetRow, RowQuote>
      const decimals = Object.fromEntries(rows.flatMap(row => {
        const value = priceDecimals[crossAssetPolicy.liveQuoteAssets[row] as BinanceAsset]
        return value === undefined ? [] : [[row, value]]
      })) as Partial<Record<CrossAssetRow, number>>
      return { state, quotes, priceDecimals: decimals }
    },
    async whenIdle() { await pending },
    diagnostics() {
      const current = stream?.snapshot()
      return { activeLeases: disposed ? 0 : leases.count(), physicalSockets: Number(!!stream) + Number(!!testSocket),
        pendingRest: Number(!!pending), closedBacklog: current?.closedCount ?? 0,
        closedBacklogPeak: Math.max(closedBacklogPeak, current?.closedCount ?? 0), lastSuccessfulWriteAt, state }
    },
    async dispose() { if (disposed) return; disposed = true; testController?.abort(); stop(); await runtime.whenIdle() }
  }
  return runtime
}
