import { describe, expect, it, vi } from 'vitest'

import { QqGatewayHost } from './QqGatewayHost'
import type { QqRuntimeRepository } from './QqRuntimeRepository'

/**
 * QQ 网关宿主的判据：心跳从 READY 起算、断开按关闭码表收尾、**序号在管道确认之后才提交**。
 * 全部假时钟 + 假 socket，一条真连接都不开。
 */

const HELLO = '{"op":10,"d":{"heartbeat_interval":45000}}'
const ACK = '{"op":11}'
const READY = '{"op":0,"s":1,"t":"READY","d":{"session_id":"session-1"}}'

describe('qq gateway host', () => {
  it('records that the gateway became ready and which events actually arrived', async () => {
    // 临时诊断（用户现场：QQ 启用了、库里一条记录都没有）。这两行让「没连上」「连上没收到」
    // 「收到了被丢」在库里分得开：open → ready → frame-received:<event>。
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)
    expect(harness.audits()).toContain('qq-gateway-ready')

    harness.sockets[0].message('{"op":0,"s":2,"t":"C2C_MESSAGE_CREATE","d":{"id":"msg-1","content":"测试","author":{"user_openid":"user-1"}}}')
    await flush()
    expect(harness.audits()).toContain('qq-frame-received:C2C_MESSAGE_CREATE')
  })

  it('identifies on HELLO and only starts heartbeating after READY', async () => {
    const harness = await createHarness()
    expect(harness.sockets).toHaveLength(1)
    harness.sockets[0].message(HELLO)
    expect(harness.wire(0)[0]).toMatchObject({ op: 2, d: { token: 'QQBot access-token', intents: 33_554_432 } })

    // 官方：「鉴权成功之后，就需要按照周期进行心跳发送」——READY 之前不发。
    harness.clock.advance(90_000)
    expect(harness.wire(0)).toHaveLength(1)

    harness.sockets[0].message(READY)
    harness.clock.advance(45_000)
    expect(harness.wire(0).at(-1)).toEqual({ op: 1, d: 1 })
  })

  it('delivers a group @ message only after the pipeline acknowledges it', async () => {
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message('{"op":0,"s":5,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"m-1","content":"hi","group_openid":"g-1","author":{"member_openid":"member-1"}}}')
    await flush()

    expect(harness.inboundRequests[0]).toMatchObject({
      providerEventKey: 'qq:event:m-1',
      providerConversationKey: 'qq:conversation:group:g-1',
      providerUserKey: 'qq:user:member-1',
      text: 'hi'
    })
    expect(harness.order).toEqual(['receive', 'commit'])
    expect(harness.runtime.commitIfCurrent).toHaveBeenCalledWith('qq-a', 1, 5)
  })

  it('does not advance the cursor when the pipeline asks to retry', async () => {
    const harness = await createHarness({ receive: async () => ({ disposition: 'retry' }) })
    harness.sockets[0].message(HELLO)
    const before = harness.runtime.commitIfCurrent.mock.calls.length
    harness.sockets[0].message('{"op":0,"s":6,"t":"GROUP_AT_MESSAGE_CREATE","d":{"id":"m-2","content":"again","group_openid":"g-1","author":{"member_openid":"member-1"}}}')
    await flush()

    expect(harness.runtime.commitIfCurrent).toHaveBeenCalledTimes(before)
    expect(harness.audits()).toContain('qq-inbound-retry')
  })

  it('stops consuming a connection whose generation is stale', async () => {
    const harness = await createHarness({ commitSequence: () => false })
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)

    expect(harness.audits()).toContain('qq-sequence-stale')
    expect(harness.sockets[0].closed).toBe(true)
    harness.clock.advance(120_000)
    await flush()
    expect(harness.sockets).toHaveLength(1)
  })

  it('follows the close-code table: 4006 identifies again, 4914 stops', async () => {
    const expired = await createHarness()
    expired.sockets[0].message(HELLO)
    expired.sockets[0].message(READY)
    expired.sockets[0].drop(4_006)
    expect(expired.audits()).toContain('qq-gateway-close-identify')
    expired.clock.advance(1_000)
    await flush()
    expect(expired.sockets).toHaveLength(2)
    // 4006 是「session id 失效」：会话材料丢掉，下一条连接重新 IDENTIFY。
    expired.sockets[1].message(HELLO)
    expect(expired.wire(1)[0]).toMatchObject({ op: 2 })

    const blocked = await createHarness()
    blocked.sockets[0].message(HELLO)
    blocked.sockets[0].message(READY)
    blocked.sockets[0].drop(4_914)
    expect(blocked.audits()).toContain('qq-gateway-close-fatal')
    blocked.clock.advance(120_000)
    await flush()
    expect(blocked.sockets).toHaveLength(1)
  })

  it('ignores frames from a socket that already closed', async () => {
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].drop()
    const before = harness.runtime.commitIfCurrent.mock.calls.length

    harness.sockets[0].message('{"op":0,"s":9,"t":"READY","d":{"session_id":"s"}}')
    await flush()
    expect(harness.runtime.commitIfCurrent).toHaveBeenCalledTimes(before)
  })

  it('ignores frames from a socket a reconnect already replaced', async () => {
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)
    harness.sockets[0].drop(4_009) // Resume：保留会话材料，退避后重连
    harness.clock.advance(1_000)
    await flush()
    expect(harness.sockets).toHaveLength(2)
    const before = harness.runtime.commitIfCurrent.mock.calls.length

    harness.sockets[0].message('{"op":0,"s":10,"t":"READY","d":{"session_id":"s"}}')
    await flush()
    expect(harness.runtime.commitIfCurrent).toHaveBeenCalledTimes(before)
  })

  it('writes which bit of the gate drops a frame, and that the frame even arrived', async () => {
    // 现场：socket 真的开了（终端有 PLATFORM_WS_OPENED），但库里连 qq-gateway-open 都没有，
    // 分不出「帧没到」「帧到了被判掉」。这两行把两件事拆开。
    const harness = await createHarness()
    harness.sockets[0].open()
    expect(harness.diagnostics).toContain('qq-socket-open:g1')
    expect(harness.diagnostics).toContain('qq-gate:aborted=0,active=1,owner=1,socket=ok')

    harness.sockets[0].message('{"op":0,"s":2,"t":"C2C_MESSAGE_CREATE","d":{"id":"m1","content":"测试","author":{"user_openid":"u1"}}}')
    await flush()
    expect(harness.diagnostics).toContain('qq-frame-in:C2C_MESSAGE_CREATE')
  })

  it('names the failing bit instead of one boolean', async () => {
    const harness = await createHarness({ gate: { aborted: false, active: false, owner: true } })
    harness.sockets[0].open()
    expect(harness.diagnostics).toContain('qq-gate:aborted=0,active=0,owner=1,socket=ok')
    // 帧到了也照样记：判掉与没到是两件事。
    harness.sockets[0].message('not-json')
    await flush()
    expect(harness.diagnostics).toContain('qq-frame-in:unparsed')
  })

  it('says which branch a READY frame took, and whether its commit was accepted', async () => {
    // 现场：READY 到了 handle 入口，却没有 ready / invalid / dispatch 任何一条。三条路之外
    // 只剩「解析成 null 后审计又被闸门拒掉」——这一组把每一步都写出来。
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)
    await flush()

    expect(harness.diagnostics).toContain('qq-parse:dispatch:READY')
    expect(harness.diagnostics).toContain('qq-lifecycle:hit')
    expect(harness.diagnostics).toContain('qq-commit:ok')
  })

  it('traces a READY the parser rejects, including the gated audit that used to vanish', async () => {
    // QQ 的 READY 缺少 `s`（或不是非负整数）时解析返回 null：`qq-gateway-frame-invalid` 走带闸门的
    // audit，写不进去时以前什么都不留。现在会留 `qq-gated:<code>:rejected`。
    const harness = await createHarness({ auditAccepted: false })
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message('{"op":0,"t":"READY","d":{"session_id":"s"}}')
    await flush()

    expect(harness.diagnostics).toContain('qq-parse:invalid')
    expect(harness.diagnostics).toContain('qq-gated:qq-gateway-frame-invalid:rejected')
  })

  it('traces a rejected commit instead of stopping silently', async () => {
    const harness = await createHarness({ commitSequence: () => false })
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)
    await flush()

    expect(harness.diagnostics).toContain('qq-commit:rejected')
  })

  it('names the field when a message event is refused', async () => {
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)
    harness.sockets[0].message('{"op":0,"s":3,"t":"C2C_MESSAGE_CREATE","d":{"id":"msg-1","content":"测试"}}')
    await flush()
    // 没有 author：审计要能说出是哪一项，而不是一句「坏了」。
    expect(harness.audits()).toContain('qq-event-invalid:author')
  })

  it('keeps the connection after READY when the commit is accepted', async () => {
    // 回归钉：READY 之后 commit 成功时，绝不能还按「序号过期」关连接（现场就是每次握手自我关闭）。
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)
    await flush()

    expect(harness.audits()).not.toContain('qq-sequence-stale')
    expect(harness.diagnostics).toContain('qq-commit:ok')
    expect(harness.sockets[0].closed).toBe(false)
  })

  it('opens nothing without a token', async () => {
    const harness = await createHarness({ token: null })
    expect(harness.sockets).toHaveLength(0)
    expect(harness.audits()).toEqual(['qq-credential-missing'])
    // 必须把「没起来」交回调用方：否则启用会被记成成功，界面显示已启用而实际一条连接都没有。
    expect(harness.started).toBe(false)
  })
})

type Wire = { op: number; d?: unknown }

function parseWire(wire: string): Wire {
  return JSON.parse(wire) as Wire
}

async function flush(): Promise<void> {
  for (let index = 0; index < 4; index += 1) await Promise.resolve()
}

class FakeClock {
  private now = 0
  private nextId = 1
  private timers: Array<{ id: number; at: number; run: () => void }> = []

  setTimeout = (run: () => void, delayMs: number): unknown => {
    const id = this.nextId
    this.nextId += 1
    this.timers.push({ id, at: this.now + delayMs, run })
    return id
  }

  clearTimeout = (handle: unknown): void => {
    this.timers = this.timers.filter((timer) => timer.id !== handle)
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

class FakeSocket {
  sent: string[] = []
  closed = false
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null

  close(): void {
    this.closed = true
    this.onclose?.({})
  }

  send(value: string): void {
    this.sent.push(value)
  }

  onopen: (() => void) | null = null

  /** 对端/传输层报告连接打开（平台 ws 打开时会调它）。 */
  open(): void {
    this.onopen?.()
  }

  message(raw: string): void {
    this.onmessage?.({ data: raw })
  }

  drop(code?: number): void {
    this.closed = true
    this.onclose?.(code === undefined ? {} : { code })
  }
}

async function createHarness(options: {
  token?: string | null
  commitSequence?: () => boolean
  receive?: (request: Record<string, unknown>) => Promise<{ disposition: string }>
  /** 闸门诊断的三位；默认「没被挡」。 */
  gate?: { aborted: boolean; active: boolean; owner: boolean }
  /** 正常审计写不写得进去（`auditIfCurrent` 的返回）；默认 true。 */
  auditAccepted?: boolean
} = {}) {
  const clock = new FakeClock()
  const sockets: FakeSocket[] = []
  const auditCodes: string[] = []
  const diagnostics: string[] = []
  const order: string[] = []
  const inboundRequests: Array<Record<string, unknown>> = []
  const inbound = {
    receive: vi.fn(async (request: Record<string, unknown>) => {
      inboundRequests.push(request)
      order.push('receive')
      const result = options.receive ? await options.receive(request) : { disposition: 'acknowledged' }
      if (result.disposition !== 'retry') await (request.acknowledge as () => Promise<void>)()
      return result
    })
  }
  const runtime = {
    commitIfCurrent: vi.fn((..._args: unknown[]) => {
      order.push('commit')
      return options.commitSequence ? options.commitSequence() : true
    }),
    auditIfCurrent: vi.fn((_channelId: string, _generation: number, code: string) => {
      auditCodes.push(code)
      return options.auditAccepted ?? true
    }),
    // 诊断写入：不过授权闸门，测试里照样收集。
    auditDiagnostic: vi.fn((_channelId: string, code: string) => { diagnostics.push(code) })
  }
  const host = new QqGatewayHost({
    channelId: 'qq-a',
    generation: 1,
    gatewayUrl: 'wss://api.sgroup.qq.com/websocket/',
    token: async () => (options.token === null ? null : (options.token ?? 'QQBot access-token')),
    intents: 33_554_432,
    inbound: inbound as never,
    runtime: runtime as unknown as QqRuntimeRepository,
    createPlatformWebSocket: class {
      constructor(_url: string) {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as never
      }
    } as never,
    isCurrent: () => true,
    diagnoseGate: () => options.gate ?? { aborted: false, active: true, owner: true },
    signal: new AbortController().signal,
    timers: { setTimeout: clock.setTimeout as unknown as typeof setTimeout, clearTimeout: clock.clearTimeout as unknown as typeof clearTimeout }
  })
  const started = await host.start()
  await flush()
  return {
    host,
    started,
    clock,
    sockets,
    runtime,
    inbound,
    inboundRequests,
    order,
    diagnostics,
    audits: () => [...auditCodes],
    wire: (index: number) => sockets[index]?.sent.map(parseWire) ?? []
  }
}
