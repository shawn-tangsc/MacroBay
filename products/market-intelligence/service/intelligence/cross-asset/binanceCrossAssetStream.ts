import type { PlatformWebSocketConstructor } from '../../../../../platform/network/platformWebSocket'
import type { BinanceAsset, ClosedBar } from './binanceCrossAssetClient'
import { crossAssetPolicy } from './crossAssetPolicy'

type State = 'connecting' | 'connected' | 'disconnected' | 'overflow' | 'closed'
type Trade = { price: string; tradeId: number; tradedAtMs: number; receivedAtMs: number }
type Quote = ({ state: 'live' | 'stale' } & Trade) | { state: 'missing' }
const assets = Object.keys(crossAssetPolicy.binanceAssets) as BinanceAsset[]
const policy = crossAssetPolicy.stream
const decimal = (value: unknown, zero = false): value is string => typeof value === 'string' && value.length <= crossAssetPolicy.decimalMaxLength &&
  crossAssetPolicy.decimalPattern.test(value) && Number.isFinite(Number(value)) && (zero ? Number(value) >= 0 : Number(value) > 0)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

export function createBinanceCrossAssetStream(deps: {
  platformWebSocket: PlatformWebSocketConstructor; now: () => number; onState: (state: State) => void
}) {
  if (!deps.platformWebSocket) throw new Error('dependency-unavailable')
  const streams = assets.flatMap(asset => policy.subscriptions.map(kind => `${crossAssetPolicy.binanceAssets[asset].toLowerCase()}@${kind}`))
  const socket = new deps.platformWebSocket(`${policy.baseUrl}?streams=${streams.join('/')}`)
  const trades = new Map<BinanceAsset, Trade>()
  const forming = new Map<BinanceAsset, ClosedBar>()
  const closed: ClosedBar[] = []
  const klineListeners = new Set<(asset: BinanceAsset) => void>()
  let state: State = 'connecting'
  let disposed = false
  const transition = (next: State) => {
    if (!disposed && state !== 'disconnected' && state !== 'overflow' && state !== next) { state = next; deps.onState(next) }
  }

  socket.onopen = () => transition('connected')
  socket.onerror = () => transition('disconnected')
  socket.onclose = () => transition('disconnected')
  socket.onmessage = event => {
    if (disposed || state === 'overflow' || state === 'disconnected') return
    const raw: unknown = event.data
    let text: string
    if (typeof raw === 'string') {
      if (Buffer.byteLength(raw, 'utf8') > policy.maxMessageBytes) return
      text = raw
    } else if (Buffer.isBuffer(raw)) {
      if (raw.byteLength > policy.maxMessageBytes) return
      text = raw.toString('utf8')
    } else return
    let payload: unknown
    let envelopeStream: string | undefined
    try { payload = JSON.parse(text) } catch { return }
    if (object(payload) && Object.hasOwn(payload, 'stream')) {
      if (typeof payload.stream !== 'string' || !streams.includes(payload.stream)) return
      envelopeStream = payload.stream
      payload = payload.data
    }
    if (!object(payload)) return
    const asset = assets.find(asset => crossAssetPolicy.binanceAssets[asset] === payload.s)
    const now = deps.now()
    if (!asset || !timestamp(payload.E) || payload.E > now + policy.futureToleranceMs) return
    const suffix = payload.e === 'kline' ? policy.subscriptions[0] : policy.subscriptions[1]
    if (envelopeStream && envelopeStream !== `${crossAssetPolicy.binanceAssets[asset].toLowerCase()}@${suffix}`) return
    if (payload.e === 'aggTrade') {
      if (!timestamp(payload.a) || !timestamp(payload.T) || payload.T > now + policy.futureToleranceMs || !decimal(payload.p)) return
      const previous = trades.get(asset)
      if (previous && (payload.a <= previous.tradeId || payload.T < previous.tradedAtMs)) return
      trades.set(asset, { price: payload.p, tradeId: payload.a, tradedAtMs: payload.T, receivedAtMs: now })
      return
    }
    if (payload.e !== 'kline' || !object(payload.k)) return
    const k = payload.k
    if (k.s !== payload.s || k.i !== crossAssetPolicy.interval || !timestamp(k.t) || k.t % crossAssetPolicy.intervalMs !== 0 ||
      k.T !== k.t + crossAssetPolicy.intervalMs - 1 || typeof k.x !== 'boolean' ||
      k.t > now + policy.futureToleranceMs || (k.x && k.t + crossAssetPolicy.intervalMs > now) ||
      !decimal(k.o) || !decimal(k.h) || !decimal(k.l) || !decimal(k.c) || !decimal(k.v, true) ||
      Number(k.l) > Math.min(Number(k.o), Number(k.c)) || Number(k.h) < Math.max(Number(k.o), Number(k.c))) return
    const bar: ClosedBar = { symbol: crossAssetPolicy.binanceAssets[asset], barOpenMs: k.t, barEndMs: k.t + crossAssetPolicy.intervalMs,
      open: k.o, high: k.h, low: k.l, close: k.c, volume: k.v }
    for (const listener of klineListeners) { try { listener(asset) } catch { /* Test observers cannot interrupt core collection. */ } }
    if (!k.x) {
      if ((forming.get(asset)?.barOpenMs ?? -1) <= bar.barOpenMs) forming.set(asset, bar)
      return
    }
    if ((forming.get(asset)?.barOpenMs ?? Infinity) <= bar.barOpenMs) forming.delete(asset)
    if (closed.length >= policy.maxClosedPending) { transition('overflow'); return }
    closed.push(bar)
  }

  return {
    observeKlines(listener: (asset: BinanceAsset) => void) {
      if (disposed || klineListeners.size >= crossAssetPolicy.interfaceTest.maxListeners) throw new Error('stream-observer-unavailable')
      klineListeners.add(listener)
      return () => { klineListeners.delete(listener) }
    },
    snapshot() {
      const now = deps.now()
      const quotes = Object.fromEntries(assets.map(asset => {
        const trade = trades.get(asset)
        const quote: Quote = trade ? { ...trade, state: state !== 'disconnected' && state !== 'overflow' && Math.max(0, now - trade.tradedAtMs) <= policy.freshnessMs &&
          Math.max(0, now - trade.receivedAtMs) <= policy.freshnessMs ? 'live' : 'stale' } : { state: 'missing' }
        return [asset, quote]
      })) as Record<BinanceAsset, Quote>
      return { state, quotes, quoteCount: trades.size, formingCount: forming.size, closedCount: closed.length }
    },
    takeClosed(): ClosedBar[] { return closed.splice(0, closed.length) },
    close() {
      if (disposed) return
      disposed = true; state = 'closed'
      socket.onopen = null; socket.onclose = null; socket.onerror = null; socket.onmessage = null
      socket.close(); trades.clear(); forming.clear(); closed.length = 0; klineListeners.clear()
    }
  }
}
