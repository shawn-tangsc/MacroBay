import { describe, expect, it, vi } from 'vitest'
import { createBinanceCrossAssetStream } from './binanceCrossAssetStream'

// Derived ingress cases. Fake only the platform socket; parsing and resource bounds are real.
const now = 1_700_000_400_000
const open = now - 300_000
class Socket {
  static instances: Socket[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  send = vi.fn()
  constructor(readonly url: string) { Socket.instances.push(this) }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }) }
}
const trade = (id = 1, time = now) => ({ e: 'aggTrade', E: time, s: 'BTCUSDT', a: id, p: '100.5', T: time })
const kline = (closed = true, start = open) => ({ e: 'kline', E: now, s: 'BTCUSDT', k: {
  t: start, T: start + 299_999, s: 'BTCUSDT', i: '5m', o: '100', h: '101', l: '99', c: '100.5', v: '12', x: closed
} })
const setup = () => {
  Socket.instances = []
  let clock = now
  const onState = vi.fn()
  const stream = createBinanceCrossAssetStream({ platformWebSocket: Socket as never, now: () => clock, onState })
  return { stream, socket: Socket.instances[0], onState, setNow: (value: number) => { clock = value } }
}

describe('cross-asset bounded stream', () => {
  it('fences messages captured before disconnection without losing already validated closed bars', () => {
    const { stream, socket } = setup()
    try {
      socket.emit(trade())
      socket.emit(kline())
      const late = socket.onmessage
      socket.onclose?.()
      late?.({ data: JSON.stringify(trade(2)) })
      late?.({ data: JSON.stringify(kline(true, open - 300_000)) })
      expect(stream.snapshot().quotes.btc).toMatchObject({ tradeId: 1, state: 'stale' })
      expect(stream.takeClosed()).toHaveLength(1)
      socket.onopen?.()
      expect(stream.snapshot().state).toBe('disconnected')
    } finally { stream.close() }
  })

  it('releases pending closed bars on final disposal after the owner has had an opportunity to drain', () => {
    const { stream, socket } = setup()
    socket.emit(kline())
    stream.close()
    expect(stream.snapshot().closedCount).toBe(0)
    expect(stream.takeClosed()).toEqual([])
  })

  it('allows a bounded interface-test listener to detach without closing production collection', () => {
    const { stream, socket } = setup()
    const listener = vi.fn()
    const remove = stream.observeKlines(listener)
    socket.emit(kline())
    expect(listener).toHaveBeenCalledWith('btc')
    remove(); remove()
    socket.emit(kline())
    expect(listener).toHaveBeenCalledOnce()
    expect(socket.close).not.toHaveBeenCalled()
    expect(stream.takeClosed()).toHaveLength(2)
    stream.close()
  })
  it('does not accept an envelope that claims a different subscribed stream', () => {
    const { stream, socket } = setup()
    try {
      socket.emit({ stream: 'ethusdt@aggTrade', data: trade() })
      socket.emit({ stream: 'btcusdt@kline_5m', data: trade() })
      expect(stream.snapshot().quoteCount).toBe(0)
    } finally { stream.close() }
  })

  it('marks retained quotes stale immediately on disconnection', () => {
    const { stream, socket } = setup()
    try {
      socket.emit(trade())
      socket.onclose?.()
      expect(stream.snapshot().quotes.btc).toMatchObject({ state: 'stale', price: '100.5' })
    } finally { stream.close() }
  })
  it('uses one injected connection for exactly three kline and three aggTrade subscriptions', () => {
    const { stream, socket } = setup()
    try {
      expect(Socket.instances).toHaveLength(1)
      expect(new URL(socket.url).pathname).toBe('/market/stream')
      const subscriptions = new URL(socket.url).searchParams.get('streams')?.split('/')
      expect(subscriptions).toEqual(['qqqusdt@kline_5m', 'qqqusdt@aggTrade', 'btcusdt@kline_5m', 'btcusdt@aggTrade', 'ethusdt@kline_5m', 'ethusdt@aggTrade'])
      expect(stream.snapshot().quotes.btc).toEqual({ state: 'missing' })
    } finally { stream.close() }
  })

  it('accepts Buffer messages and uses new trade identity plus T, not kline traffic, for freshness', () => {
    const { stream, socket, setNow } = setup()
    try {
      socket.onmessage?.({ data: Buffer.from(JSON.stringify({ stream: 'btcusdt@aggTrade', data: trade() })) })
      expect(stream.snapshot().quotes.btc).toMatchObject({ state: 'live', price: '100.5', tradedAtMs: now, receivedAtMs: now })
      setNow(now + 16_000)
      socket.emit(trade())
      socket.emit(kline(false, now))
      expect(stream.snapshot().quotes.btc).toMatchObject({ state: 'stale', receivedAtMs: now })
      socket.emit(trade(2, now + 16_000))
      expect(stream.snapshot().quotes.btc.state).toBe('live')
      expect(stream.takeClosed()).toEqual([])
    } finally { stream.close() }
  })

  it('rejects malformed, wrong-symbol, future and inconsistent interval messages without updating state', () => {
    const { stream, socket } = setup()
    try {
      for (const bad of [{ ...trade(), s: 'DOGEUSDT' }, { ...trade(), p: '0' }, trade(2, now + 5001),
        { ...kline(), k: { ...kline().k, i: '1m' } }, { ...kline(), k: { ...kline().k, s: 'ETHUSDT' } }, kline(true, now)]) socket.emit(bad)
      socket.onmessage?.({ data: '{not json' })
      socket.onmessage?.({ data: ' '.repeat(65_537) })
      expect(stream.snapshot().quotes.btc.state).toBe('missing')
      expect(stream.takeClosed()).toEqual([])
    } finally { stream.close() }
  })

  it('retains only the latest trade/forming slot under high ingress and bounds pending closed bars', () => {
    const { stream, socket, onState } = setup()
    try {
      for (let index = 1; index <= 10_000; index++) { socket.emit(trade(index)); socket.emit(kline(false, now)) }
      expect(stream.snapshot().quoteCount).toBe(1)
      expect(stream.snapshot().formingCount).toBe(1)
      for (let index = 0; index < 129; index++) socket.emit(kline(true, open - index * 300_000))
      expect(stream.snapshot().closedCount).toBeLessThanOrEqual(128)
      expect(onState).toHaveBeenCalledWith('overflow')
      expect(stream.snapshot().state).toBe('overflow')
    } finally { stream.close() }
  })

  it('drains genuine closed bars and ignores captured callbacks after close', () => {
    const { stream, socket } = setup()
    const late = socket.onmessage
    socket.emit(kline())
    expect(stream.takeClosed()).toEqual([expect.objectContaining({ symbol: 'BTCUSDT', barOpenMs: open, barEndMs: now })])
    expect(stream.takeClosed()).toEqual([])
    stream.close(); stream.close()
    late?.({ data: JSON.stringify(trade()) })
    expect(socket.close).toHaveBeenCalledOnce()
    expect(socket.onmessage).toBeNull()
    expect(stream.snapshot().quoteCount).toBe(0)
  })
})
