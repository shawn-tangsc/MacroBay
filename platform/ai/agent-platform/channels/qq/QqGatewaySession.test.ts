import { describe, expect, it } from 'vitest'

import { parseQqGatewayFrame } from './QqGatewayProtocol'
import { QqGatewaySession, type QqGatewayEnd } from './QqGatewaySession'

/**
 * QQ 机器人网关的**连接层状态机**。与 Discord 的两处差别（官方文档「WebSocket 方式」）：
 * - 心跳在「鉴权成功之后」才按周期发（HELLO 只给周期），所以 READY / RESUMED 之前不排心跳；
 * - 断开之后该 Resume 还是重新 Identify，由**关闭码**表决定，不是一帧布尔值。
 *
 * 假时钟 + 假 socket，一条真连接都不开。
 */

const QIDENTIFY = {
  op: 2,
  d: {
    token: 'QQBot access-token',
    intents: 33_554_432,
    shard: [0, 1],
    properties: { $os: 'desktop', $browser: 'MacroBay', $device: 'MacroBay' }
  }
}
const HELLO = '{"op":10,"d":{"heartbeat_interval":45000}}'
const ACK = '{"op":11}'
const READY = '{"op":0,"s":1,"t":"READY","d":{"session_id":"session-1"}}'

describe('qq gateway session', () => {
  it('identifies on HELLO but only starts heartbeating once authentication succeeded', () => {
    const harness = createHarness()
    expect(harness.sent).toEqual([]) // HELLO 之前一个字节都不许发

    harness.receive(HELLO)
    expect(harness.sent.map(parseWire)).toEqual([QIDENTIFY])

    // 官方原文是「鉴权成功之后，就需要按照周期进行心跳发送」：READY 之前不发。
    harness.clock.advance(135_000)
    expect(harness.sent).toHaveLength(1)

    harness.receive(READY)
    expect(harness.session.currentPhase).toBe('ready')
    harness.clock.advance(44_999)
    expect(harness.sent).toHaveLength(1)
    harness.clock.advance(1)
    expect(harness.sent.map(parseWire)[1]).toEqual({ op: 1, d: 1 })
  })

  it('heartbeats carry the last sequence number, and a server-requested heartbeat answers at once', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    harness.receive('{"op":0,"s":251,"t":"GROUP_AT_MESSAGE_CREATE","d":{}}')
    harness.receive('{"op":1,"d":null}') // 服务端要求立刻心跳
    expect(harness.sent.map(parseWire).at(-1)).toEqual({ op: 1, d: 251 })
  })

  it('treats a heartbeat that was never acknowledged as a dead connection, and resumes next time', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    harness.clock.advance(45_000) // 心跳 1
    harness.clock.advance(45_000) // 心跳 1 的 ACK 没来
    expect(harness.ends).toEqual([{ kind: 'failed', reason: 'heartbeat-timeout', closeCode: null, disposition: 'resume' }])
    expect(harness.session.nextPlan()).toMatchObject({ kind: 'resume', sessionId: 'session-1', sequence: 1 })
    const sentBefore = harness.sent.length
    harness.clock.advance(600_000)
    expect(harness.sent).toHaveLength(sentBefore)
  })

  it('stays up as long as every heartbeat is acknowledged', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    for (let beat = 0; beat < 3; beat += 1) {
      harness.clock.advance(45_000)
      harness.receive(ACK)
    }
    expect(harness.ends).toEqual([])
    expect(harness.sent.filter((wire) => parseWire(wire).op === 1)).toHaveLength(3)
  })

  it('resumes after a reconnect request, carrying the stored session id and sequence', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    harness.receive('{"op":0,"s":77,"t":"GROUP_AT_MESSAGE_CREATE","d":{}}')
    harness.receive('{"op":7}')
    expect(harness.ends).toEqual([{ kind: 'disconnected', reason: 'reconnect-requested', closeCode: null, disposition: 'resume' }])

    const next = createHarness({ session: harness.session, ends: harness.ends })
    next.receive(HELLO)
    expect(next.sent.map(parseWire)).toEqual([{ op: 6, d: { token: 'QQBot access-token', session_id: 'session-1', seq: 77 } }])
  })

  it('follows the close-code table: 4009 resumes, 4006 identifies again, 4914 is fatal', () => {
    const resumable = createHarness()
    resumable.receive(HELLO)
    resumable.receive(READY)
    resumable.session.interrupt(4_009)
    expect(resumable.ends).toEqual([{ kind: 'disconnected', reason: 'close-code', closeCode: 4_009, disposition: 'resume' }])
    expect(resumable.session.nextPlan()).toMatchObject({ kind: 'resume', sessionId: 'session-1' })

    // 4006「无效的 session id，无法继续 resume，请 identify」：会话材料必须一起丢掉。
    const expired = createHarness()
    expired.receive(HELLO)
    expired.receive(READY)
    expired.session.interrupt(4_006)
    expect(expired.ends).toEqual([{ kind: 'failed', reason: 'close-code', closeCode: 4_006, disposition: 'identify' }])
    expect(expired.session.nextPlan()).toEqual({ kind: 'identify' })

    // 4914「机器人已下架，只允许连接沙箱环境」：别再连，去处理环境。
    const blocked = createHarness()
    blocked.receive(HELLO)
    blocked.receive(READY)
    blocked.session.interrupt(4_914)
    expect(blocked.ends).toEqual([{ kind: 'failed', reason: 'close-code', closeCode: 4_914, disposition: 'fatal' }])
  })

  it('can resume after an invalid session only when the gateway says so', () => {
    const recoverable = createHarness()
    recoverable.receive(HELLO)
    recoverable.receive(READY)
    recoverable.receive('{"op":9,"d":true}')
    expect(recoverable.ends).toEqual([{ kind: 'failed', reason: 'invalid-session', closeCode: null, disposition: 'resume' }])
    expect(recoverable.session.nextPlan()).toMatchObject({ kind: 'resume', sessionId: 'session-1' })

    // 官方只写「identify 或 resume 参数有错时返回」：没明确说可恢复的，一律当必须重新 Identify。
    const rejected = createHarness()
    rejected.receive(HELLO)
    rejected.receive(READY)
    rejected.receive('{"op":9}')
    expect(rejected.ends).toEqual([{ kind: 'failed', reason: 'invalid-session', closeCode: null, disposition: 'identify' }])
    expect(rejected.session.nextPlan()).toEqual({ kind: 'identify' })
  })

  it('forgets the session when it is stopped by a person', () => {
    const harness = createHarness()
    harness.receive(HELLO)
    harness.receive(READY)
    harness.session.stop()
    expect(harness.ends.at(-1)).toEqual({ kind: 'stopped', reason: 'stopped', closeCode: null, disposition: 'identify' })
    expect(harness.session.nextPlan()).toEqual({ kind: 'identify' })
    expect(() => harness.session.attach({ send: () => {}, close: () => {} })).toThrow('qq-gateway-session-stopped')
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

function createHarness(options: { session?: QqGatewaySession; ends?: QqGatewayEnd[] } = {}) {
  const clock = new FakeClock()
  const sent: string[] = []
  const closed: number[] = []
  const ends = options.ends ?? []
  const session = options.session ?? new QqGatewaySession({
    token: 'QQBot access-token',
    intents: 33_554_432,
    clock,
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
      const frame = parseQqGatewayFrame(raw)
      if (!frame) throw new Error(`fixture frame is not a readable gateway frame: ${raw}`)
      session.receive(frame)
    }
  }
}
