import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { seedChannelAdapterSupport } from '../channelTestSupport'
import { DiscordGatewayHost } from './DiscordGatewayHost'
import { DiscordRuntimeRepository } from './DiscordRuntimeRepository'

/**
 * Discord 网关宿主的判据：**连接怎么起来、断了怎么回来、过期的序号写不进去**。
 *
 * 全部用假时钟 + 假 socket：心跳与退避重连必须能确定性重跑，一条真连接都不开。
 * 这里没有消息路由——消息类 dispatch 要到下一笔才进管道，所以此刻**一个序号都不提交**，
 * 否则游标会跨过一条没送进管道的消息，重连后再也补不回来。
 */

const HELLO = '{"op":10,"d":{"heartbeat_interval":41250}}'
const ACK = '{"op":11,"d":null}'
const READY = '{"op":0,"s":5,"t":"READY","d":{"session_id":"sess-1","resume_gateway_url":"wss://gateway.discord.gg"}}'
const TOKEN = 'discord-bot-token-secret'

describe('discord gateway host', () => {
  it('identifies on HELLO, heartbeats on the interval, and reconnects after a zombie connection', async () => {
    const harness = await createHarness()
    expect(harness.sockets).toHaveLength(1)
    expect(harness.sockets[0].sent).toEqual([])

    harness.sockets[0].message(HELLO)
    expect(harness.wire(0)[0]).toMatchObject({ op: 2, d: { token: TOKEN, intents: 33_281 } })

    harness.clock.advance(41_250)
    expect(harness.wire(0).at(-1)).toEqual({ op: 1, d: null })
    // 心跳没回 ACK：按 4000 关，记僵尸，再按 1s 退避重连。
    harness.clock.advance(41_250)
    expect(harness.sockets[0].closed).toBe(true)
    expect(harness.audits()).toContain('discord-gateway-zombie')
    harness.clock.advance(1_000)
    await flush()
    expect(harness.sockets).toHaveLength(2)
  })

  it('treats a server reconnect request as a normal reconnect, and resumes instead of identifying again', async () => {
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)
    harness.sockets[0].message('{"op":7,"d":null}')

    expect(harness.audits()).toContain('discord-gateway-reconnect')
    expect(harness.sockets[0].closed).toBe(true)
    harness.clock.advance(1_000)
    await flush()

    expect(harness.sockets).toHaveLength(2)
    harness.sockets[1].message(HELLO)
    // 有会话材料就 RESUME：token + session_id + 最后收到的 seq。
    expect(harness.wire(1)[0]).toEqual({ op: 6, d: { token: TOKEN, session_id: 'sess-1', seq: 5 } })
  })

  it('drops a sequence write from a generation that is no longer current, and stops that connection', async () => {
    const harness = await createHarness({ commitSequence: () => false })
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)

    expect(harness.audits()).toContain('discord-sequence-stale')
    expect(harness.sockets[0].closed).toBe(true)
    // 过期代际不许继续消费这条连接的帧，也不许排重连（它已经不属于当前运行时）。
    harness.clock.advance(60_000)
    await flush()
    expect(harness.sockets).toHaveLength(1)
    expect(harness.runtime.commitIfCurrent).toHaveBeenCalledWith('discord-a', 1, 5)
  })

  it('opens nothing at all without a credential', async () => {
    const harness = await createHarness({ token: null })
    expect(harness.sockets).toHaveLength(0)
    expect(harness.audits()).toEqual(['discord-credential-missing'])
  })

  it('stays down after a person stops it, and never leaks the token into its audits', async () => {
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message(READY)
    harness.host.stop()

    harness.clock.advance(120_000)
    await flush()
    expect(harness.sockets).toHaveLength(1)
    expect(JSON.stringify(harness.audits())).not.toContain(TOKEN)
  })

  it('ignores frames that arrive on a socket which already closed', async () => {
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].onclose?.({})
    const commitsBefore = harness.runtime.commitIfCurrent.mock.calls.length

    harness.sockets[0].message(READY)
    // 关掉的 socket 再说什麼都不算：不提交序号、不再发一个字节。
    expect(harness.runtime.commitIfCurrent).toHaveBeenCalledTimes(commitsBefore)
    expect(harness.wire(0)).toHaveLength(1)
  })

  it('ignores frames that arrive on a socket a reconnect already replaced', async () => {
    const harness = await createHarness()
    harness.sockets[0].message(HELLO)
    harness.sockets[0].message('{"op":7,"d":null}')
    harness.clock.advance(1_000)
    await flush()
    expect(harness.sockets).toHaveLength(2)
    const commitsBefore = harness.runtime.commitIfCurrent.mock.calls.length

    harness.sockets[0].message(READY)
    expect(harness.runtime.commitIfCurrent).toHaveBeenCalledTimes(commitsBefore)
  })

  it('records a frame it cannot read instead of guessing, and keeps the connection', async () => {
    const harness = await createHarness()
    harness.sockets[0].message('not-json')

    expect(harness.audits()).toContain('discord-gateway-frame-invalid')
    expect(harness.sockets[0].closed).toBe(false)
    expect(harness.sockets[0].sent).toEqual([])
  })
})

describe('discord gateway sequence persistence', () => {
  it('refuses a write from an old generation, so a reconnect can never roll the cursor back', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-11-10','2026-11-10');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
        values('discord-a','discord','Discord','agent-a','{}',1,'enabled','configured','2026-11-10','2026-11-10');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('discord-a',2,'active','2026-11-10');
    `)
    seedChannelAdapterSupport(database, ['discord'])
    const runtime = new DiscordRuntimeRepository(database)

    // 代际 1 已经是过去式：它的序号一个都不许落，否则重连会从一个更小的 seq 继续。
    expect(runtime.commitIfCurrent('discord-a', 1, 900)).toBe(false)
    expect(database.connection.prepare('select count(*) as count from channel_discord_gateway_state').get()).toEqual({ count: 0 })

    expect(runtime.commitIfCurrent('discord-a', 2, 900)).toBe(true)
    expect(database.connection.prepare('select generation,last_sequence from channel_discord_gateway_state where channel_id=?').get('discord-a'))
      .toEqual({ generation: 2, last_sequence: 900 })
    // 同代际里更小的序号也不许把游标推回去。
    expect(runtime.commitIfCurrent('discord-a', 2, 12)).toBe(true)
    expect(database.connection.prepare('select last_sequence from channel_discord_gateway_state where channel_id=?').get('discord-a'))
      .toEqual({ last_sequence: 900 })
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

  message(raw: string): void {
    this.onmessage?.({ data: raw })
  }
}

async function createHarness(options: { token?: string | null; commitSequence?: () => boolean } = {}) {
  const clock = new FakeClock()
  const sockets: FakeSocket[] = []
  const auditCodes: string[] = []
  const runtime = {
    commitIfCurrent: vi.fn(options.commitSequence ?? (() => true)),
    auditIfCurrent: vi.fn((_channelId: string, _generation: number, code: string) => {
      auditCodes.push(code)
      return true
    })
  }
  const host = new DiscordGatewayHost({
    channelId: 'discord-a',
    generation: 1,
    gatewayUrl: 'wss://gateway.discord.gg',
    token: async () => (options.token === null ? null : (options.token ?? TOKEN)),
    intents: 33_281,
    runtime: runtime as unknown as DiscordRuntimeRepository,
    createPlatformWebSocket: class {
      constructor(_url: string) {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as never
      }
    } as never,
    isCurrent: () => true,
    signal: new AbortController().signal,
    timers: { setTimeout: clock.setTimeout as unknown as typeof setTimeout, clearTimeout: clock.clearTimeout as unknown as typeof clearTimeout },
    jitter: () => 1
  })
  await host.start()
  await flush()
  return {
    host,
    clock,
    sockets,
    runtime,
    audits: () => [...auditCodes],
    wire: (index: number) => sockets[index]?.sent.map(parseWire) ?? []
  }
}
