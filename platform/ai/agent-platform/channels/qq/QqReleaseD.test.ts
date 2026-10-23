import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { ChannelManagementRepository } from '../ChannelManagementRepository'
import { ChannelManagementService } from '../ChannelManagementService'
import { assertQqSecret } from '../ChannelManagementContracts'
import { ChannelInboundRepository } from '../ChannelInboundRepository'
import { ChannelAdapterAcceptanceRegistry } from '../ChannelAdapterAcceptanceRegistry'
import { ChannelSecureHandoff } from '../ChannelSecureHandoff'
import { QqApiClient } from './QqApiClient'
import { decodeQqConversation, encodeQqConversation, splitQqText } from './QqContracts'
import { QqDeliveryTransport } from './QqDeliveryTransport'
import { QqRuntimeManager } from './QqRuntimeManager'
import { qqGatewayStateUpsertSql, QqRuntimeRepository } from './QqRuntimeRepository'
import { normalizeQqEvent } from './QqUpdateNormalizer'
import { QqGatewayHost } from './QqGatewayHost'

describe('QQ Release D contracts', () => {
  it('creates QQ only as blocked metadata with strict app credential schemas', () => {
    const database = databaseForQq()
    const service = new ChannelManagementService({ repository: new ChannelManagementRepository(database), vault: {} as never, cipher: {} as never, registry: new ChannelAdapterAcceptanceRegistry(), handoff: new ChannelSecureHandoff() })
    const created = service.create({ type: 'qq', name: 'QQ', agentId: 'agent-a', actorId: 'user-a' })
    expect(created).toMatchObject({ ok: true, channel: { type: 'qq', requestedEnabled: false, credential: { hasCredential: false } } })
    expect(service.requestEnable({ id: created.channel!.id, actorId: 'user-a' })).toMatchObject({ ok: false, code: 'adapter-not-supported' })
    expect(database.connection.prepare('select public_config_json,requested_enabled from agent_channels where id=?').get(created.channel!.id)).toEqual({ public_config_json: '{}', requested_enabled: 0 })
    expect(() => assertQqSecret({ app_id: 'app_12345678', client_secret: 'a'.repeat(20) })).not.toThrow()
    expect(() => assertQqSecret({ app_id: 'short', client_secret: 'a'.repeat(20) })).toThrow('channel-input-invalid')
    expect(() => assertQqSecret({ app_id: 'app_12345678', client_secret: 'a'.repeat(20), token: 'forbidden' })).toThrow('channel-input-invalid')
  })

  it('normalizes bounded QQ provider facts without URLs and decodes conversation before injected HTTP', async () => {
    const normalized = normalizeQqEvent({ id: 'event_1', author_id: 'user_1', conversation_id: 'group_1', kind: 'group', content: 'hello', url: 'https://private', attachments: [{ id: 'file_1', kind: 'image', mime_type: 'image/png', url: 'https://private' }] })
    expect(normalized).toMatchObject({ eventKey: 'qq:event:event_1', conversationKey: 'qq:conversation:group:group_1', attachments: [{ stableRef: 'qq:file:file_1' }] })
    expect(JSON.stringify(normalized)).not.toContain('https://private')
    expect(normalizeQqEvent({ id: 'bad key', author_id: 'user', conversation_id: 'group', kind: 'group' })).toBeNull()
    expect(encodeQqConversation({ kind: 'channel', id: 'channel_1' })).toBe('qq:conversation:channel:channel_1')
    expect(decodeQqConversation('qq:conversation:group:bad key')).toBeNull()
    expect(splitQqText('x'.repeat(8_001)).map((part) => part.length)).toEqual([4_000, 4_000, 1])

    const urls: string[] = []; const bodies: unknown[] = []
    const fetch = async (url: string, init?: RequestInit) => { urls.push(url); bodies.push(JSON.parse(String(init?.body))); return response() }
    const client = new QqApiClient({ getPlatformFetch: () => fetch as typeof globalThis.fetch, token: async () => 'internal-token' })
    const delivery = new QqDeliveryTransport(); delivery.setClient('qq-a', client, { isCurrent: () => true, signal: new AbortController().signal })
    await expect(delivery.send({ channelId: 'qq-a', providerConversationKey: 'qq:conversation:group:group_1', text: 'reply', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'delivered' })
    await expect(delivery.send({ channelId: 'qq-a', providerConversationKey: 'qq:conversation:group:bad key', text: 'no', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'failed', code: 'delivery-provider-rejected' })
    expect(urls).toEqual(['https://api.sgroup.qq.com/v2/groups/group_1/messages'])
    expect(bodies).toEqual([{ content: 'reply' }])
    expect(JSON.stringify(bodies)).not.toContain('qq:conversation:')
  })

  it.each(['system', 'custom', 'none'])('uses the explicitly injected %s platform fetch path', async (_mode) => {
    const fetch = vi.fn(async () => response()) as unknown as typeof globalThis.fetch
    const client = new QqApiClient({ getPlatformFetch: () => fetch, token: async () => 'internal-token' })
    await expect(client.sendText({ kind: 'direct', id: 'user_1' }, 'text')).resolves.toBe('delivered')
    expect(fetch).toHaveBeenCalledWith('https://api.sgroup.qq.com/v2/users/user_1/messages', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps blocked QQ runtime state/audits fail-closed even for a forged active row', () => {
    const database = databaseForQq()
    seedActiveQq(database)
    const runtime = new QqRuntimeRepository(database)
    expect(new ChannelInboundRepository(database).getCurrentAgentId('qq-a', 1)).toBeNull()
    expect(runtime.commitIfCurrent('qq-a', 1, 4)).toBe(false)
    expect(runtime.auditIfCurrent('qq-a', 1, 'qq-test')).toBe(false)
    expect(database.connection.prepare('select count(*) as count from channel_qq_gateway_state').get()).toEqual({ count: 0 })
    database.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='inactive' where channel_id='qq-a'").run()
    expect(runtime.commitIfCurrent('qq-a', 1, 5)).toBe(false)
    expect(runtime.auditIfCurrent('qq-a', 1, 'stale')).toBe(false)
  })

  it('resets sequence and Vault session metadata when a new generation commits', () => {
    const database = databaseForQq()
    database.connection.prepare(
      "insert into channel_qq_gateway_state(channel_id,generation,last_sequence,session_ref,session_revision,updated_at) values('qq-a',1,100,'qq-session-old',7,'2026-07-20')"
    ).run()

    // Exercise the non-authorizing UPSERT state transition directly; repository authorization stays immutable.
    commitGatewayState(database, 'qq-a', 2, 1)
    expect(database.connection.prepare('select generation,last_sequence,session_ref,session_revision from channel_qq_gateway_state where channel_id=?').get('qq-a')).toEqual({ generation: 2, last_sequence: 1, session_ref: null, session_revision: null })
    commitGatewayState(database, 'qq-a', 2, 0)
    expect(database.connection.prepare('select last_sequence from channel_qq_gateway_state where channel_id=?').get('qq-a')).toEqual({ last_sequence: 1 })
  })

  it('startup and quit fence a forged QQ owner without affecting managed Telegram', () => {
    const database = databaseForQq(); seedActiveQq(database)
    database.connection.exec("insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values('telegram-a','telegram','Telegram','agent-a','{}',1,'runtime-ready','configured','2026-07-20','2026-07-20'); insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('telegram-a',1,'active','2026-07-20'); insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at) values('qq-a','qq-owner','enable',1,'2026-07-20','2026-07-20'),('telegram-a','telegram-owner','enable',1,'2026-07-20','2026-07-20')")
    const management = new ChannelManagementRepository(database)
    expect(management.activeRuntimeOwners('2026-07-20T00:00:00.000Z')).toEqual([{ channelId: 'telegram-a', generation: 1, token: 'telegram-owner' }])
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get('qq-a')).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get('qq-a')).toEqual({ generation: 2, lifecycle_state: 'inactive' })
    expect(management.stopAllRuntimeAndFence('2026-07-20T00:01:00.000Z')).toContain('telegram-a')
  })

  it.each(['closed', 'replaced'] as const)('does not commit or acknowledge a %s source socket during durable inbound work', async (mode) => {
    const source = new FakeSocket(); const replacement = new FakeSocket(); let created = 0; let release!: () => void
    const runtime = { commitIfCurrent: vi.fn(() => true), auditIfCurrent: vi.fn(() => true) }
    const receive = vi.fn(async (input: { acknowledge: () => Promise<void> }) => {
      await new Promise<void>((resolve) => { release = resolve })
      await expect(input.acknowledge()).rejects.toThrow('qq-current-gate-failed')
      return { disposition: 'retry' as const }
    })
    const host = new QqGatewayHost({ channelId: 'qq-a', generation: 1, gatewayUrl: 'wss://fake', inbound: { receive } as never, runtime: runtime as never, parseVerifiedDispatch: () => ({ sequence: 9, facts: { eventKey: 'qq:event:e1', conversationKey: 'qq:conversation:direct:user_1', userKey: 'qq:user:user_1', conversationKind: 'direct', mentionedBot: true, text: 'hello' }, acknowledgeWire: '{"ack":9}' }), createPlatformWebSocket: class { constructor(_url: string) { return (++created === 1 ? source : replacement) as never } } as never, isCurrent: () => true, signal: new AbortController().signal })
    host.start(); source.onmessage?.({ data: '{}' }); await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    if (mode === 'closed') source.onclose?.({})
    else host.start()
    release(); await vi.waitFor(() => expect(runtime.commitIfCurrent).not.toHaveBeenCalled())
    expect(source.sent).toEqual([]); expect(replacement.sent).toEqual([])
  })

  it('purges QQ runtime rows in the established delete isolation transaction', async () => {
    const database = databaseForQq(); const repository = new ChannelManagementRepository(database)
    expect(repository.create({ id: 'qq-delete', type: 'qq', name: 'QQ', agentId: 'agent-a', now: '2026-07-20' })).toBe(true)
    database.connection.exec("insert into channel_qq_gateway_state(channel_id,generation,last_sequence,updated_at) values('qq-delete',1,7,'2026-07-20'); insert into channel_qq_runtime_audits(id,channel_id,code,created_at) values('qq-audit','qq-delete','qq-test','2026-07-20')")
    expect(repository.beginDelete('qq-delete', 'qq-delete-operation', '2026-07-20')).not.toBeNull()
    expect(database.connection.prepare('select count(*) as count from channel_qq_gateway_state where channel_id=?').get('qq-delete')).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_qq_runtime_audits where channel_id=?').get('qq-delete')).toEqual({ count: 0 })
  })

  it('does not construct injected HTTP or Gateway dependencies while QQ remains blocked', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch; const webSocket = vi.fn() as never
    const manager = new QqRuntimeManager({ inbound: {} as never, runtime: new QqRuntimeRepository(createAgentPlatformDatabase(':memory:')), vault: {} as never, getPlatformFetch: () => fetch, createPlatformWebSocket: webSocket, delivery: new QqDeliveryTransport(), getCredential: () => ({ ref: 'known', revision: 1 }), ownsLifecycleOwner: () => true, isCurrentActive: () => true })
    await expect(manager.start('qq-a', 1, 'owner-a')).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled(); expect(webSocket).not.toHaveBeenCalled()
  })
})

function databaseForQq() { const database = createAgentPlatformDatabase(':memory:'); database.connection.exec("insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-20','2026-07-20')"); return database }
function commitGatewayState(database: ReturnType<typeof createAgentPlatformDatabase>, channelId: string, generation: number, sequence: number) {
  return database.connection.prepare(qqGatewayStateUpsertSql()).run(channelId, generation, sequence, '2026-07-20').changes
}
function seedActiveQq(database: ReturnType<typeof createAgentPlatformDatabase>) { database.connection.exec("insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values('qq-a','qq','QQ','agent-a','{}',1,'runtime-ready','configured','2026-07-20','2026-07-20'); insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('qq-a',1,'active','2026-07-20')") }
function response(): Response { return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) } as Response }
class FakeSocket { sent: string[] = []; onopen: ((event: unknown) => void) | null = null; onclose: ((event: unknown) => void) | null = null; onerror: ((event: unknown) => void) | null = null; onmessage: ((event: { data: unknown }) => void) | null = null; close(): void {}; send(value: string): void { this.sent.push(value) } }
