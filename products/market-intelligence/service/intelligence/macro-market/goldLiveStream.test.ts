import { describe, expect, it, vi } from 'vitest'
import { createGoldLiveStream, type GoldLiveStreamState } from './goldLiveStream'
import { goldLiveHeartbeat, goldLivePolicy, type GoldLiveFailureCode } from './goldLivePolicy'
import {
  fakeSocketFactory, goldRealPrice, goldRealPriceFrame, goldRealPriceFrameAtMs, goldTick, testClock
} from './goldLiveTestKit'

/** The tick the provider really sends has a seconds timestamp: 1647950462 → 2022-03-22T11:21:02Z. */
const tickAt = 1647950462_000
const interval = goldLivePolicy.heartbeat.intervalMs

function harness(startMs = tickAt + 1_000) {
  const clock = testClock(startMs)
  const sockets = fakeSocketFactory()
  const states: { state: GoldLiveStreamState; failureCode?: GoldLiveFailureCode }[] = []
  const stream = createGoldLiveStream({
    platformWebSocket: sockets.constructor, apiKey: 'test-key', now: clock.now, scheduler: clock.scheduler,
    onState: (state, failureCode) => states.push({ state, ...(failureCode ? { failureCode } : {}) })
  })
  return { clock, sockets, states, stream }
}

describe('the gold live stream', () => {
  it('opens the documented endpoint and sends the subscription only once the socket is open', () => {
    const { sockets, stream, states } = harness()
    // The key rides in the query string and nowhere else; the message body names no credential.
    expect(sockets.socket().url).toBe('wss://ws.twelvedata.com/v1/quotes/price?apikey=test-key')
    expect(sockets.socket().sent).toEqual([])
    sockets.socket().open()
    expect(sockets.socket().sent).toEqual([goldLiveSubscriptionBody()])
    expect(states).toEqual([])
    stream.close()
  })

  it('subscribes to gold only, on one connection', () => {
    const { sockets, stream } = harness()
    sockets.socket().open()
    expect(sockets.created).toHaveLength(1)
    const body = JSON.parse(sockets.socket().sent[0]) as { action: string; params: { symbols: string } }
    expect(body.action).toBe('subscribe')
    expect(body.params.symbols).toBe('XAU/USD')
    for (const symbol of ['EUR/USD', 'USD/CNY', 'USD/CNH', 'USDT/USD']) expect(sockets.socket().sent[0]).not.toContain(symbol)
    stream.close()
  })

  it('keeps the latest tick and reports the socket live, with the price as the provider wrote it', () => {
    const { sockets, stream } = harness()
    sockets.socket().open()
    sockets.socket().message(goldTick())
    expect(stream.snapshot()).toEqual({ state: 'live', tick: { price: '1925.18', atMs: tickAt } })
    // A second tick replaces the first: only the latest state is ever held.
    sockets.socket().message(goldTick({ price: 1925.44, timestamp: 1647950463 }))
    expect(stream.snapshot().tick).toEqual({ price: '1925.44', atMs: tickAt + 1_000 })
    expect(stream.snapshot().state).toBe('live')
    stream.close()
  })

  /**
   * The regression this file exists for. A price frame names the figure as a JSON *number*, so a
   * parser that decides "is this a price?" by asking "is this a string?" refuses every frame the
   * provider sends — silently, because a malformed tick is dropped by design. This is the exact
   * frame a real key produced, so what is asserted here is what the socket really receives.
   */
  it('parses the price frame the provider really sends: a JSON number and a seconds timestamp', () => {
    const { sockets, stream } = harness(goldRealPriceFrameAtMs + 1_000)
    sockets.socket().open()
    sockets.socket().message(goldRealPriceFrame)
    expect(stream.snapshot()).toEqual({
      state: 'live',
      tick: { price: goldRealPrice, atMs: goldRealPriceFrameAtMs }
    })
    // Still the wire's shape: the number crossed the parser and comes out a decimal string.
    expect(typeof stream.snapshot().tick?.price).toBe('string')
    stream.close()
  })

  it('admits the same figure as a number and as a decimal string, and normalises both to one string', () => {
    const { sockets, stream } = harness()
    sockets.socket().open()
    // The socket's shape: a JSON number.
    sockets.socket().message(goldTick({ price: 4144.04708 }))
    expect(stream.snapshot().tick).toEqual({ price: '4144.04708', atMs: tickAt })
    // The REST endpoints' shape for the same figure. Both are the price, not two prices.
    sockets.socket().message(goldTick({ price: '4144.04708' }))
    expect(stream.snapshot().tick).toEqual({ price: '4144.04708', atMs: tickAt })
    // A whole number is still a decimal, with or without a fraction part.
    sockets.socket().message(goldTick({ price: 1900 }))
    expect(stream.snapshot().tick).toEqual({ price: '1900', atMs: tickAt })
    stream.close()
  })

  it('ignores every frame that is not a gold price: other symbols, malformed prices, bad stamps', () => {
    const { sockets, stream } = harness()
    sockets.socket().open()
    const before = stream.snapshot()
    for (const data of [
      'not json', '[]', 'null',
      goldTick({ symbol: 'BTC/USD' }),
      goldTick({ price: 'not-a-number' }),
      goldTick({ price: '0' }),
      goldTick({ price: '-1' }),
      goldTick({ price: '1'.repeat(goldLivePolicy.maxPriceLength + 1) }),
      goldTick({ price: Number.NaN }),
      // The same refusals stated as numbers: rejecting a string that says "0" is not enough if the
      // provider's own numeric shape slips through, and accepting numbers must not mean accepting
      // a zero, a negative, an infinity or an object that merely looks like a price.
      goldTick({ price: 0 }),
      goldTick({ price: -1 }),
      goldTick({ price: Number.POSITIVE_INFINITY }),
      goldTick({ price: Number.NEGATIVE_INFINITY }),
      goldTick({ price: '1.9e3' }),
      goldTick({ price: ' 1925.18' }),
      goldTick({ price: true }),
      goldTick({ price: {} }),
      goldTick({ price: [] }),
      goldTick({ price: null }),
      // A frame with no price at all: the one shape a contract change must never turn into a tick.
      JSON.stringify({ event: 'price', symbol: 'XAU/USD', timestamp: 1647950462 }),
      goldTick({ timestamp: -1 }),
      JSON.stringify({ event: 'heartbeat' }),
      JSON.stringify({ event: 'price', symbol: 'XAU/USD' })
    ]) sockets.socket().message(data)
    // Not one of them was accepted: the stream neither invents a price nor takes the connection down.
    expect(stream.snapshot()).toEqual(before)
    expect(stream.snapshot().tick).toBeUndefined()
    // A buffer frame is not the string shape the platform adapter produces.
    sockets.socket().message(Buffer.from(goldTick()))
    expect(stream.snapshot().tick).toBeUndefined()
    stream.close()
  })

  it('clamps a stamp ahead of the local clock and accepts a late one', () => {
    const { clock, sockets, stream } = harness()
    sockets.socket().open()
    const now = clock.now()
    // The provider's clock may run ahead of ours. A tick can never look fresher than its arrival.
    sockets.socket().message(goldTick({ timestamp: (now + 60_000) / 1_000 }))
    expect(stream.snapshot().tick).toEqual({ price: '1925.18', atMs: now })
    // A late tick is late, not invalid: the freshness rule, not a tolerance window, decides its badge.
    sockets.socket().message(goldTick({ timestamp: (now - 20_000) / 1_000, price: 1900 }))
    expect(stream.snapshot()).toMatchObject({ state: 'live', tick: { atMs: now - 20_000, price: '1900' } })
    stream.close()
  })

  it('drops an oversized frame without parsing it', () => {
    const { sockets, stream } = harness()
    sockets.socket().open()
    sockets.socket().message(`{"event":"price","symbol":"XAU/USD","price":1,"pad":"${'x'.repeat(goldLivePolicy.maxMessageBytes)}"}`)
    expect(stream.snapshot().tick).toBeUndefined()
    expect(stream.snapshot().state).toBe('connecting')
    stream.close()
  })

  it('recomputes freshness on every read: a quiet socket is delayed, a new tick revives it', async () => {
    const { clock, sockets, stream } = harness()
    sockets.socket().open()
    sockets.socket().message(goldTick())
    expect(stream.snapshot().state).toBe('live')
    // The socket is still open; the price simply stopped arriving. That is exactly what 延迟 means.
    await clock.advance(tickAt + goldLivePolicy.freshnessMs + 1)
    expect(stream.snapshot().state).toBe('stale')
    // The stale tick is still reported — it is the last known price, labelled as delayed.
    expect(stream.snapshot().tick).toEqual({ price: '1925.18', atMs: tickAt })
    const arrival = clock.now()
    sockets.socket().message(goldTick({ price: 1930, timestamp: (arrival + 1_000) / 1_000 }))
    expect(stream.snapshot()).toEqual({ state: 'live', tick: { price: '1930', atMs: arrival } })
    stream.close()
  })

  it('turns a refused subscription into a named failure rather than a quiet stream', () => {
    const { sockets, stream, states } = harness()
    sockets.socket().open()
    sockets.socket().message(JSON.stringify({ event: 'subscribe-status', status: 'error', code: 403, message: 'plan restricted' }))
    expect(stream.snapshot()).toMatchObject({ state: 'unavailable', failureCode: 'credential-rejected' })
    sockets.socket().message(goldTick())
    // Once unavailable the stream stops admitting ticks: a refused subscription is not partial truth.
    expect(stream.snapshot().tick).toBeUndefined()
    expect(states.at(-1)).toEqual({ state: 'unavailable', failureCode: 'credential-rejected' })
    stream.close()
  })

  it.each([
    [{ event: 'subscribe-status', status: 'error', code: 'plan-restricted' }, 'plan-restricted'],
    [{ event: 'subscribe-status', status: 'error', code: 'invalid-api-key' }, 'credential-rejected']
  ] as const)('maps the refused acknowledgement %o to its own failure code', (frame, expected) => {
    const { sockets, stream } = harness()
    sockets.socket().open()
    sockets.socket().message(JSON.stringify(frame))
    expect(stream.snapshot()).toMatchObject({ state: 'unavailable', failureCode: expected })
    stream.close()
  })

  it('reports an error frame and a close as failures, and stops after close', () => {
    const errored = harness()
    errored.sockets.socket().open()
    // The provider names a rate limit by word or by HTTP status; both are the same failure here.
    errored.sockets.socket().message(JSON.stringify({ code: 429, message: 'too many requests', status: 'error' }))
    expect(errored.stream.snapshot().failureCode).toBe('rate-limited')
    errored.stream.close()
    expect(errored.sockets.socket().closed).toBe(1)
    expect(errored.stream.snapshot()).toMatchObject({ state: 'unavailable' })

    const words = harness()
    words.sockets.socket().open()
    words.sockets.socket().message(JSON.stringify({ code: 'rate-limited', message: 'too many requests', status: 'error' }))
    expect(words.stream.snapshot().failureCode).toBe('rate-limited')
    words.stream.close()

    const unreadable = harness()
    unreadable.sockets.socket().open()
    unreadable.sockets.socket().message(JSON.stringify({ code: 'something-new', message: 'who knows', status: 'error' }))
    expect(unreadable.stream.snapshot().failureCode).toBe('response-invalid')
    unreadable.stream.close()

    const closed = harness()
    closed.sockets.socket().open()
    closed.sockets.socket().message(goldTick())
    closed.sockets.socket().dead()
    expect(closed.stream.snapshot()).toMatchObject({ state: 'unavailable', failureCode: 'transport-unavailable' })
    expect(closed.states.at(-1)?.state).toBe('unavailable')
  })

  it('reports a transport error as unavailable and tolerates a transport that throws on close', () => {
    const { sockets, stream, states } = harness()
    sockets.socket().fail()
    expect(states.at(-1)?.failureCode).toBe('transport-unavailable')
    sockets.socket().close = () => { throw new Error('already gone') }
    expect(() => stream.close()).not.toThrow()
    expect(stream.snapshot().state).toBe('unavailable')
  })

  it('survives an observer that throws, and refuses to build without a socket factory', () => {
    const sockets = fakeSocketFactory()
    const onState = vi.fn(() => { throw new Error('observer exploded') })
    const stream = createGoldLiveStream({ platformWebSocket: sockets.constructor, apiKey: 'k', now: () => tickAt, onState })
    sockets.socket().open()
    sockets.socket().message(goldTick())
    expect(onState).toHaveBeenCalled()
    expect(stream.snapshot().state).toBe('live')
    stream.close()
    expect(() => createGoldLiveStream({ platformWebSocket: undefined as never, apiKey: 'k', now: () => tickAt, onState: () => undefined }))
      .toThrow('dependency-unavailable')
  })

  it('never sends anywhere else, and sends exactly one subscription', () => {
    const { sockets, stream } = harness()
    sockets.socket().open()
    sockets.socket().message(goldTick())
    sockets.socket().message(goldTick({ price: 1926 }))
    expect(sockets.socket().sent).toHaveLength(1)
    expect(sockets.socket().sent[0]).toBe(goldLiveSubscriptionBody())
    stream.close()
  })
})

/**
 * The provider closes a price socket that stays silent for about ten seconds, so a subscription with
 * no keepalive delivers nothing at all. Every case here is driven by the injected scheduler: the
 * clock is stepped, never slept on, and `pending()` says whether a timer is still armed.
 */
describe('the gold live keepalive', () => {
  it('sends the frozen heartbeat frame one interval after open, and nothing at all before it', async () => {
    const { clock, sockets, stream } = harness()
    const socket = sockets.socket()
    // A socket that was never opened has nothing to keep alive, so no timer is even armed for one.
    expect(clock.pending()).toEqual([])
    await clock.stepBy(interval, 5)
    expect(socket.sent).toEqual([])

    socket.open()
    expect(socket.sent).toEqual([goldLiveSubscriptionBody()])
    // Exactly one keepalive is armed, exactly one policy interval away: no wall-clock timer exists.
    expect(clock.pending()).toHaveLength(1)
    expect(clock.pending()[0].at - clock.now()).toBe(interval)
    expect(socket.heartbeats()).toEqual([])

    await clock.stepBy(interval)
    // One beat, byte-identical to the policy frame, and carrying no credential of any kind.
    expect(socket.heartbeats()).toEqual([goldLiveHeartbeat()])
    expect(socket.sent).toEqual([goldLiveSubscriptionBody(), goldLiveHeartbeat()])
    expect(JSON.parse(goldLiveHeartbeat())).toEqual({ action: 'heartbeat' })
    expect(goldLiveHeartbeat()).toBe(JSON.stringify(goldLivePolicy.heartbeat.frame))
    expect(goldLiveHeartbeat()).not.toContain('apikey')
    expect(goldLiveHeartbeat()).not.toContain('test-key')
    stream.close()
  })

  it('beats exactly once per interval for as long as the connection lives', async () => {
    const { clock, sockets, stream } = harness()
    sockets.socket().open()
    for (const expected of [1, 2, 3, 4]) {
      await clock.stepBy(interval)
      expect(sockets.socket().heartbeats()).toHaveLength(expected)
    }
    // The subscription plus four beats, and no fifth shape among them.
    expect(sockets.socket().sent).toHaveLength(5)
    stream.close()
  })

  it('arms one keepalive for the connection: a repeated open adds no second timer', async () => {
    const { clock, sockets, stream } = harness()
    sockets.socket().open()
    // A transport that re-enters `open` must not double the keepalive: one connection, one timer.
    sockets.socket().open()
    expect(clock.pending()).toHaveLength(1)
    await clock.stepBy(interval)
    expect(sockets.socket().heartbeats()).toHaveLength(1)
    stream.close()
  })

  it('stops for good the moment the provider closes the socket', async () => {
    const { clock, sockets, stream } = harness()
    sockets.socket().open()
    await clock.stepBy(interval)
    expect(sockets.socket().heartbeats()).toHaveLength(1)

    sockets.socket().dead()
    expect(stream.snapshot()).toMatchObject({ state: 'unavailable', failureCode: 'transport-unavailable' })
    // The close took the armed keepalive with it: nothing is left to fire at a closed socket.
    expect(clock.pending()).toEqual([])
    await clock.stepBy(interval, 75)
    expect(sockets.socket().sent).toHaveLength(2)
    expect(sockets.socket().heartbeats()).toHaveLength(1)
    stream.close()
  })

  it('cancels the keepalive on close, and says nothing for ten minutes afterwards', async () => {
    const { clock, sockets, stream } = harness()
    sockets.socket().open()
    await clock.stepBy(interval)
    expect(sockets.socket().heartbeats()).toHaveLength(1)

    stream.close()
    expect(clock.pending()).toEqual([])
    await clock.advance(clock.now() + 10 * 60_000)
    expect(sockets.socket().sent).toHaveLength(2)
    expect(sockets.socket().heartbeats()).toHaveLength(1)
    expect(sockets.socket().closed).toBe(1)
  })

  it('treats a keepalive that cannot be sent as a dead transport, not as a live stream', async () => {
    const { clock, sockets, stream, states } = harness()
    sockets.socket().open()
    sockets.socket().send = () => { throw new Error('socket already closed') }
    await clock.stepBy(interval)
    // The failure path is the existing one: unavailable with a named cause, never a quiet `live`.
    expect(stream.snapshot()).toMatchObject({ state: 'unavailable', failureCode: 'transport-unavailable' })
    expect(states.at(-1)).toEqual({ state: 'unavailable', failureCode: 'transport-unavailable' })
    // A failed beat is terminal for this connection: no next one is armed behind it.
    expect(clock.pending()).toEqual([])
    await clock.advance(clock.now() + 10 * 60_000)
    expect(sockets.socket().sent).toHaveLength(1)
  })
})

function goldLiveSubscriptionBody(): string {
  return JSON.stringify({ action: 'subscribe', params: { symbols: 'XAU/USD' } })
}
