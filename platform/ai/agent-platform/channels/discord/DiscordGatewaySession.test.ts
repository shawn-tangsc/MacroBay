import { describe, expect, it } from 'vitest'

import { parseDiscordGatewayFrame } from './DiscordGatewayProtocol'
import { DiscordGatewaySession, type DiscordGatewayEnd } from './DiscordGatewaySession'

/**
 * Discord Gateway 的**连接层状态机**：HELLO 之后发 IDENTIFY 还是 RESUME、心跳按什么节奏发、
 * 哪一次断开算故障、哪一次只是服务器让重连。（官方文档：Discord Developers › Docs › Topical ›
 * Gateway，"Connecting to the Gateway / Heartbeat"、"Identify Structure"、"Resume Structure"、
 * "Invalid Session"、"Reconnect"。）
 *
 * 全部用假时钟 + 假 socket 驱动，一条真连接都不开：这里要证的是**判据**，不是「能连上」。
 */

const IDENTIFY_WIRE = {
  op: 2,
  d: { token: 'bot-token', intents: 33_281, properties: { os: 'desktop', browser: 'MacroBay', device: 'MacroBay' } }
}
const HELLO = '{"op":10,"d":{"heartbeat_interval":41250}}'
const ACK = '{"op":11,"d":null}'
const READY = '{"op":0,"s":5,"t":"READY","d":{"session_id":"sess-1","resume_gateway_url":"wss://gateway.discord.gg"}}'

describe('discord gateway session', () => {
  it('waits for HELLO, identifies, and heartbeats on the interval HELLO gave', () => {
    const harness = createHarness()
    expect(harness.sent).toEqual([]) // HELLO 之前一个字节都不许发

    harness.receive(HELLO)
    expect(harness.sent.map(parseWire)).toEqual([IDENTIFY_WIRE])

    // 第一个心跳在 interval × jitter 之后（这里 jitter=1，所以正好一个周期）。
    harness.clock.advance(41_249)
    expect(harness.sent).toHaveLength(1)
    harness.clock.advance(1)
    expect(harness.sent.map(parseWire)[1]).toEqual({ op: 1, d: null }) // 还没收到 dispatch，序号是 null
    expect(harness.session.currentPhase).toBe('identifying')

    harness.receive(ACK)
    harness.clock.advance(41_250)
    expect(harness.sent.map(parseWire)[2]).toEqual({ op: 1, d: null })
  })

  it('heartbeats carry the last sequence number, and a server-requested heartbeat answers at once', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive('{"op":0,"s":9,"t":"MESSAGE_CREATE","d":{}}')
    harness.receive('{"op":1,"d":null}') // 服务器要求立刻心跳
    expect(harness.sent.map(parseWire)[1]).toEqual({ op: 1, d: 9 })
    expect(harness.clock.pending()).toBe(1) // 定时的那一次还在，没被这条顶掉
  })

  it('closes a connection whose heartbeat was never acknowledged, with the documented zombie code', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.clock.advance(41_250) // 心跳 1
    harness.clock.advance(41_250) // 心跳 1 的 ACK 没来
    expect(harness.closed).toEqual([4_000])
    expect(harness.ends).toEqual([{ kind: 'failed', reason: 'heartbeat-timeout', closeCode: 4_000, retryAfterMs: 0 }])
    const sentBefore = harness.sent.length
    harness.clock.advance(600_000)
    expect(harness.sent).toHaveLength(sentBefore) // 结束后不再排心跳
    expect(harness.clock.pending()).toBe(0)
  })

  it('stays up as long as every heartbeat is acknowledged', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    for (let beat = 0; beat < 3; beat += 1) {
      harness.clock.advance(41_250)
      harness.receive(ACK)
    }
    expect(harness.closed).toEqual([])
    expect(harness.sent.filter((wire) => parseWire(wire).op === 1)).toHaveLength(3)
  })

  it('ends on a reconnect request, and the next connection resumes from the last sequence', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    harness.receive('{"op":7,"d":null}')
    expect(harness.ends).toEqual([{ kind: 'disconnected', reason: 'reconnect-requested', closeCode: 1_000, retryAfterMs: 0 }])
    expect(harness.session.nextPlan()).toEqual({ kind: 'resume', sessionId: 'sess-1', sequence: 5, gatewayUrl: 'wss://gateway.discord.gg' })

    // 下一条连接不重新 IDENTIFY，而是先等 HELLO 再 RESUME。
    const next = createHarness({ session: harness.session })
    next.receive(HELLO)
    expect(next.sent.map(parseWire)).toEqual([{ op: 6, d: { token: 'bot-token', session_id: 'sess-1', seq: 5 } }])
    expect(next.session.currentPhase).toBe('resuming')
  })

  it('resumes after an invalid session the gateway says is recoverable, and waits the documented 1-5s', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    harness.receive('{"op":9,"d":true}')
    expect(harness.ends).toEqual([{ kind: 'disconnected', reason: 'invalid-session-resume', closeCode: 1_000, retryAfterMs: 2_000 }])
    expect(harness.session.nextPlan()).toMatchObject({ kind: 'resume', sessionId: 'sess-1', sequence: 5 })
  })

  it('identifies again after an invalid session that may not be resumed, and forgets the old session', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    harness.receive('{"op":9,"d":false}')
    expect(harness.ends).toEqual([{ kind: 'disconnected', reason: 'invalid-session-reidentify', closeCode: 1_000, retryAfterMs: 2_000 }])
    expect(harness.session.nextPlan()).toEqual({ kind: 'identify' })

    // 关键判据：旧序号必须一起丢掉，否则下一条连接会拿一个作废的 seq 去 Resume。
    const next = createHarness({ session: harness.session })
    next.receive(HELLO)
    expect(next.sent.map(parseWire)).toEqual([IDENTIFY_WIRE])
  })

  it('resumes a connection that dies on its own, but forgets the session when it is stopped', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    harness.session.interrupt()
    expect(harness.ends).toEqual([{ kind: 'disconnected', reason: 'transport-closed', closeCode: null, retryAfterMs: 0 }])
    expect(harness.session.nextPlan()).toMatchObject({ kind: 'resume', sessionId: 'sess-1' })

    // 人停掉的不一样：下一条连接必须干净地重新 IDENTIFY。
    const next = createHarness({ session: harness.session, ends: harness.ends })
    next.receive(HELLO)
    next.session.stop()
    expect(next.ends.at(-1)).toEqual({ kind: 'stopped', reason: 'stopped', closeCode: null, retryAfterMs: 0 })
    expect(next.session.nextPlan()).toEqual({ kind: 'identify' })
  })

  it('keeps a READY without a usable session id connected, but plans a fresh identify next time', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive('{"op":0,"s":3,"t":"READY","d":{"resume_gateway_url":"https://not-a-websocket"}}')
    expect(harness.session.currentPhase).toBe('ready')
    expect(harness.session.nextPlan()).toEqual({ kind: 'identify' })
  })
})

type Wire = { op: number; d?: unknown }

function parseWire(wire: string): Wire {
  return JSON.parse(wire) as Wire
}

class FakeClock {
  private now = 0
  private nextId = 1
  private timers: Array<{ id: number; at: number; run: () => void }> = []

  setTimer = (delayMs: number, run: () => void): unknown => {
    const id = this.nextId
    this.nextId += 1
    this.timers.push({ id, at: this.now + delayMs, run })
    return id
  }

  clearTimer = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle)
  }

  pending(): number {
    return this.timers.length
  }

  advance(ms: number): void {
    const target = this.now + ms
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= target).sort((left, right) => left.at - right.at)[0]
      if (!due) break
      this.timers = this.timers.filter((timer) => timer.id !== due.id)
      this.now = due.at
      due.run()
    }
    this.now = target
  }
}

function createHarness(options: { session?: DiscordGatewaySession; ends?: DiscordGatewayEnd[] } = {}) {
  const clock = new FakeClock()
  const sent: string[] = []
  const closed: number[] = []
  // 复用同一个会话时要接着原来的 onEnd 收：数组不换，不然「停掉」这件事记在旧账本里。
  const ends = options.ends ?? []
  const session = options.session ?? new DiscordGatewaySession({
    token: 'bot-token',
    intents: 33_281,
    clock,
    jitter: () => 1,
    onEnd: (end) => { ends.push(end) }
  })
  session.attach({ send: (wire) => { sent.push(wire) }, close: (code) => { closed.push(code) } })
  return {
    clock,
    sent,
    closed,
    ends,
    session,
    receive: (raw: string): void => {
      const frame = parseDiscordGatewayFrame(raw)
      if (!frame) throw new Error(`fixture frame is not a readable gateway frame: ${raw}`)
      session.receive(frame)
    }
  }
}
