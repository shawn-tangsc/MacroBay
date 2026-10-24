import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { SlackDeliveryTransport } from './SlackDeliveryTransport'
import { SlackRuntimeManager } from './SlackRuntimeManager'
import { SlackRuntimeRepository } from './SlackRuntimeRepository'
import { SlackSocketModeHost } from './SlackSocketModeHost'
import { seedChannelAdapterSupport } from '../channelTestSupport'

describe('Slack Socket Mode runtime', () => {
  it('persists only opaque runtime state across a file SQLite restart and fences stale generations', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'slack-runtime-'))
    const path = join(directory, 'channels.sqlite')
    try {
      const first = createAgentPlatformDatabase(path)
      seedActiveSlack(first)
      const runtime = new SlackRuntimeRepository(first)
      expect(runtime.commitIfCurrent('slack-a', 1, 'opaque-event-hash', null)).toBe(true)
      first.connection.close()

      const restarted = createAgentPlatformDatabase(path)
      expect(restarted.connection.prepare('select generation,last_event_id_hash,reconnect_cursor from channel_slack_runtime_state where channel_id=?').get('slack-a')).toEqual({
        generation: 1, last_event_id_hash: 'opaque-event-hash', reconnect_cursor: null
      })
      restarted.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='inactive' where channel_id='slack-a'").run()
      expect(new SlackRuntimeRepository(restarted).commitIfCurrent('slack-a', 1, 'next-opaque-hash', null)).toBe(false)
      restarted.connection.close()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('uses injected platform fetch and WebSocket only after its exact owner/generation gate', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const fetch = vi.fn(async (url: string) => response(url.endsWith('apps.connections.open')
      ? { ok: true, url: 'wss://socket.example.test' }
      : { ok: true, user_id: 'B1' })) as unknown as typeof globalThis.fetch
    const sockets: FakeSocket[] = []
    const manager = new SlackRuntimeManager({
      inbound: {} as never, runtime: new SlackRuntimeRepository(database), vault: { get: async () => ({ bot_token: 'xoxb-valid-token-123', app_token: 'xapp-valid-token-123' }) } as never,
      getPlatformFetch: () => fetch, createPlatformWebSocket: class { constructor(_url: string) { const socket = new FakeSocket(); sockets.push(socket); return socket as never } } as never,
      delivery: new SlackDeliveryTransport(), getCredential: () => ({ ref: 'known-ref', revision: 1 }), keyedHash: async () => 'opaque',
      ownsLifecycleOwner: (id, token, generation) => id === 'slack-a' && token === 'owner-a' && generation === 1,
      isCurrentActive: (id, generation) => id === 'slack-a' && generation === 1
    })

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    await expect(manager.start('slack-a', 1, 'owner-a')).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      'https://slack.com/api/apps.connections.open', 'https://slack.com/api/auth.test'
    ]))
    expect(sockets).toHaveLength(1)
    manager.stop('slack-a', 'owner-a')
    expect(sockets[0]?.closed).toBe(true)

    await expect(manager.start('slack-a', 1, 'wrong-owner')).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('aborts an in-flight Slack handshake before a stale socket can be created', async () => {
    let signal: AbortSignal | undefined
    const fetch = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((resolve) => {
      signal = options?.signal ?? undefined
      signal?.addEventListener('abort', () => resolve(response({ ok: false })), { once: true })
    })) as unknown as typeof globalThis.fetch
    const manager = new SlackRuntimeManager({
      inbound: {} as never, runtime: new SlackRuntimeRepository(createAgentPlatformDatabase(':memory:')),
      vault: { get: async () => ({ bot_token: 'xoxb-valid-token-123', app_token: 'xapp-valid-token-123' }) } as never,
      getPlatformFetch: () => fetch, createPlatformWebSocket: FakeSocket as never, delivery: new SlackDeliveryTransport(),
      getCredential: () => ({ ref: 'known-ref', revision: 1 }), keyedHash: async () => 'opaque',
      ownsLifecycleOwner: () => true, isCurrentActive: () => true
    })

    const pending = manager.start('slack-a', 1, 'owner-a')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())
    manager.stop('slack-a', 'owner-a')
    await expect(pending).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
  })

  it('acknowledges a Socket Mode envelope only after inbound durability and the SQLite current gate', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const socket = new FakeSocket()
    const receive = vi.fn(async (input: { acknowledge: () => Promise<void> }) => {
      await input.acknowledge()
      return { disposition: 'acknowledged' as const }
    })
    const host = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket.example.test', botUserId: 'B1',
      inbound: { receive } as never, runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque-event-hash',
      createPlatformWebSocket: class { constructor(_url: string) { return socket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => null
    })
    host.start()
    socket.onmessage?.({ data: JSON.stringify({ envelope_id: 'envelope-1', type: 'events_api', payload: { event_id: 'event-1', event: {
      type: 'message', channel: 'C1', user: 'U1', channel_type: 'im', text: 'hello'
    } } }) })
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    expect(socket.sent).toEqual(['{"envelope_id":"envelope-1"}'])
    expect(database.connection.prepare('select last_event_id_hash from channel_slack_runtime_state where channel_id=?').get('slack-a')).toEqual({ last_event_id_hash: 'opaque-event-hash' })
  })

  it('does not acknowledge or advance runtime state when the channel is fenced before ack', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const socket = new FakeSocket()
    const receive = vi.fn(async (input: { acknowledge: () => Promise<void> }) => {
      database.connection.prepare("update channel_runtime_generations set lifecycle_state='inactive',generation=2 where channel_id='slack-a'").run()
      await expect(input.acknowledge()).rejects.toThrow('slack-current-gate-failed')
      return { disposition: 'retry' as const }
    })
    const host = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket.example.test', botUserId: 'B1',
      inbound: { receive } as never, runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque-event-hash',
      createPlatformWebSocket: class { constructor(_url: string) { return socket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => null
    })
    host.start()
    socket.onmessage?.({ data: JSON.stringify({ envelope_id: 'envelope-1', type: 'events_api', payload: { event_id: 'event-1', event: {
      type: 'message', channel: 'C1', user: 'U1', channel_type: 'im', text: 'hello'
    } } }) })
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    expect(socket.sent).toEqual([])
    expect(database.connection.prepare('select count(*) as count from channel_slack_runtime_state').get()).toEqual({ count: 0 })
  })

  it('does not acknowledge an envelope on a replacement socket after its durable callback resumes', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const sockets: FakeSocket[] = []
    let releaseInbound!: () => void
    const receive = vi.fn(async (input: { acknowledge: () => Promise<void> }) => {
      await new Promise<void>((resolve) => { releaseInbound = resolve })
      await input.acknowledge()
      return { disposition: 'retry' as const }
    })
    let reconnects = 0
    let reconnectCallback: (() => void) | undefined
    const host = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket-a', botUserId: 'B1',
      inbound: { receive } as never, runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque-event-hash',
      createPlatformWebSocket: class { constructor(_url: string) { const socket = new FakeSocket(); sockets.push(socket); return socket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal,
      reconnectSocketUrl: async () => (++reconnects === 1 ? 'wss://socket-b' : null),
      timers: { setTimeout: (callback: () => void) => { reconnectCallback = callback; return 1 as never }, clearTimeout: () => {} } as never
    })
    host.start()
    sockets[0]?.onmessage?.({ data: message('envelope-a') })
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    sockets[0]?.onclose?.({})
    reconnectCallback?.()
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    releaseInbound()
    await vi.waitFor(() => expect(database.connection.prepare('select count(*) as count from channel_slack_runtime_state').get()).toEqual({ count: 0 }))
    expect(sockets[0]?.sent).toEqual([])
    expect(sockets[1]?.sent).toEqual([])

    const replay = vi.fn(async (input: { acknowledge: () => Promise<void> }) => {
      await input.acknowledge()
      return { disposition: 'acknowledged' as const }
    })
    // A correctly owned connection can process the same envelope on a new host/generation.
    const retrySocket = new FakeSocket()
    const retryHost = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket-c', botUserId: 'B1',
      inbound: { receive: replay } as never, runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque-event-hash',
      createPlatformWebSocket: class { constructor(_url: string) { return retrySocket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => null
    })
    retryHost.start()
    retrySocket.onmessage?.({ data: message('envelope-a') })
    await vi.waitFor(() => expect(retrySocket.sent).toEqual(['{"envelope_id":"envelope-a"}']))
  })

  it('does not advance state or send an ACK when the source socket closes without a replacement', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const socket = new FakeSocket()
    let releaseInbound!: () => void
    const receive = vi.fn(async (input: { acknowledge: () => Promise<void> }) => {
      await new Promise<void>((resolve) => { releaseInbound = resolve })
      await input.acknowledge()
      return { disposition: 'retry' as const }
    })
    const host = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket-a', botUserId: 'B1',
      inbound: { receive } as never, runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque-event-hash',
      createPlatformWebSocket: class { constructor(_url: string) { return socket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => null,
      timers: { setTimeout: () => 1 as never, clearTimeout: () => {} } as never
    })
    host.start()
    socket.onmessage?.({ data: message('envelope-a') })
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    socket.onclose?.({})
    releaseInbound()
    await vi.waitFor(() => expect(database.connection.prepare('select count(*) as count from channel_slack_runtime_state').get()).toEqual({ count: 0 }))
    expect(socket.sent).toEqual([])
  })

  it('bounds reconnects when REST URL retrieval succeeds but every socket closes before open', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const sockets: FakeSocket[] = []
    const callbacks: Array<() => void> = []
    let urlRequests = 0
    const host = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket-0', botUserId: 'B1', inbound: {} as never,
      runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque',
      createPlatformWebSocket: class { constructor(_url: string) { const socket = new FakeSocket(); sockets.push(socket); return socket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => `wss://socket-${++urlRequests}`,
      timers: { setTimeout: (callback: () => void) => { callbacks.push(callback); return callbacks.length as never }, clearTimeout: () => {} } as never
    })
    host.start()
    for (let attempt = 0; attempt < 5; attempt += 1) {
      sockets.at(-1)?.onclose?.({})
      callbacks.shift()?.()
      await vi.waitFor(() => expect(urlRequests).toBe(attempt + 1))
    }
    sockets.at(-1)?.onclose?.({})
    expect(callbacks).toEqual([])
    expect(urlRequests).toBe(5)
  })

  it('resets reconnect budget only after the exact replacement socket opens', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const sockets: FakeSocket[] = []
    const callbacks: Array<() => void> = []
    const delays: number[] = []
    let urlRequests = 0
    const host = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket-0', botUserId: 'B1', inbound: {} as never,
      runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque',
      createPlatformWebSocket: class { constructor(_url: string) { const socket = new FakeSocket(); sockets.push(socket); return socket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => `wss://socket-${++urlRequests}`,
      timers: { setTimeout: (callback: () => void, delay: number) => { callbacks.push(callback); delays.push(delay); return callbacks.length as never }, clearTimeout: () => {} } as never
    })
    host.start()
    sockets[0]?.onclose?.({}); callbacks.shift()?.()
    await vi.waitFor(() => expect(urlRequests).toBe(1))
    sockets[1]?.onclose?.({}); callbacks.shift()?.()
    await vi.waitFor(() => expect(urlRequests).toBe(2))

    sockets[2]?.onopen?.({})
    sockets[2]?.onclose?.({}); callbacks.shift()?.()
    await vi.waitFor(() => expect(urlRequests).toBe(3))
    // The post-open close begins at 1s again, proving it reset rather than retaining attempt two.
    expect(delays).toEqual([1_000, 2_000, 1_000])
  })

  it('drops late socket errors after delete, while an exact current socket writes one audit', () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const socket = new FakeSocket()
    const host = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket-a', botUserId: 'B1', inbound: {} as never,
      runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque',
      createPlatformWebSocket: class { constructor(_url: string) { return socket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => null
    })
    host.start()
    socket.onerror?.({})
    expect(database.connection.prepare('select count(*) as count from channel_slack_runtime_audits').get()).toEqual({ count: 1 })

    host.close()
    database.connection.exec(`
      delete from channel_slack_runtime_audits where channel_id='slack-a';
      delete from channel_runtime_generations where channel_id='slack-a';
      delete from agent_channels where id='slack-a';
    `)
    socket.onerror?.({})
    expect(database.connection.prepare('select count(*) as count from channel_slack_runtime_audits').get()).toEqual({ count: 0 })
  })

  it('rejects a stopped generation A error while exact active generation B records one audit', () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveSlack(database)
    const socketA = new FakeSocket()
    const hostA = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 1, socketUrl: 'wss://socket-a', botUserId: 'B1', inbound: {} as never,
      runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque',
      createPlatformWebSocket: class { constructor(_url: string) { return socketA as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => null
    })
    hostA.start()
    hostA.close()
    database.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='active' where channel_id='slack-a'").run()
    const socketB = new FakeSocket()
    const hostB = new SlackSocketModeHost({
      channelId: 'slack-a', generation: 2, socketUrl: 'wss://socket-b', botUserId: 'B1', inbound: {} as never,
      runtime: new SlackRuntimeRepository(database), hashEventKey: async () => 'opaque',
      createPlatformWebSocket: class { constructor(_url: string) { return socketB as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal, reconnectSocketUrl: async () => null
    })
    hostB.start()
    socketA.onerror?.({})
    socketB.onerror?.({})
    expect(database.connection.prepare('select channel_id,code from channel_slack_runtime_audits').all()).toEqual([
      { channel_id: 'slack-a', code: 'slack-socket-error' }
    ])
  })

  it('cleans the 5,000 audit cap independently for each channel', () => {
    const database = createAgentPlatformDatabase(':memory:')
    for (let index = 0; index < 5_002; index += 1) {
      database.connection.prepare('insert into channel_slack_runtime_audits(id,channel_id,code,created_at) values(?,?,?,?)').run(
        `audit-a-${String(index).padStart(5, '0')}`, 'channel-a', 'code', '2026-07-20T00:00:00.000Z'
      )
    }
    for (let index = 0; index < 10; index += 1) {
      database.connection.prepare('insert into channel_slack_runtime_audits(id,channel_id,code,created_at) values(?,?,?,?)').run(
        `audit-b-${index}`, 'channel-b', 'code', '2026-07-20T00:00:00.000Z'
      )
    }
    expect(new SlackRuntimeRepository(database).cleanupAudits(new Date('2026-07-20T00:00:00.000Z'))).toBe(2)
    expect(database.connection.prepare("select count(*) as count from channel_slack_runtime_audits where channel_id='channel-a'").get()).toEqual({ count: 5_000 })
    expect(database.connection.prepare("select count(*) as count from channel_slack_runtime_audits where channel_id='channel-b'").get()).toEqual({ count: 10 })
  })
})

class FakeSocket {
  closed = false
  sent: string[] = []
  onopen: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  close(): void { this.closed = true }
  send(value: string): void { this.sent.push(value) }
}

function response(body: unknown): Response {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body } as Response
}

function message(envelopeId: string): string {
  return JSON.stringify({ envelope_id: envelopeId, type: 'events_api', payload: { event_id: `event-${envelopeId}`, event: {
    type: 'message', channel: 'C1', user: 'U1', channel_type: 'im', text: 'hello'
  } } })
}

function seedActiveSlack(database: ReturnType<typeof createAgentPlatformDatabase>): void {
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-20','2026-07-20');
    insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values('slack-a','slack','Slack','agent-a','{}',1,'runtime-ready','configured','2026-07-20','2026-07-20');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('slack-a',1,'active','2026-07-20');
  `)
  seedChannelAdapterSupport(database, ['slack'])
}
