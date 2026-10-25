import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { ChannelManagementRepository } from '../ChannelManagementRepository'
import { ChannelManagementService } from '../ChannelManagementService'
import { ChannelDeliveryRepository } from '../ChannelDeliveryRepository'
import { assertDiscordSecret } from '../ChannelManagementContracts'
import { ChannelInboundRepository } from '../ChannelInboundRepository'
import { ChannelAdapterAcceptanceRegistry } from '../ChannelAdapterAcceptanceRegistry'
import { ChannelSecureHandoff } from '../ChannelSecureHandoff'
import { DiscordApiClient } from './DiscordApiClient'
import { decodeDiscordConversation, encodeDiscordConversation, splitDiscordText } from './DiscordContracts'
import { seedChannelAdapterSupport } from '../channelTestSupport'
import { DiscordDeliveryTransport } from './DiscordDeliveryTransport'
import { DiscordRuntimeManager } from './DiscordRuntimeManager'
import { discordGatewayStateUpsertSql, DiscordRuntimeRepository } from './DiscordRuntimeRepository'
import { normalizeDiscordEvent } from './DiscordUpdateNormalizer'
import { DiscordGatewayHost } from './DiscordGatewayHost'

describe('Discord Release E contracts', () => {
  it('creates Discord only as blocked metadata with a bot-token-only credential schema', () => {
    const database = databaseForDiscord()
    const service = new ChannelManagementService({ repository: new ChannelManagementRepository(database), vault: {} as never, cipher: {} as never, registry: new ChannelAdapterAcceptanceRegistry(), handoff: new ChannelSecureHandoff() })
    const created = service.create({ type: 'discord', name: 'Discord', agentId: 'agent-a', actorId: 'user-a' })
    expect(created).toMatchObject({ ok: true, channel: { type: 'discord', requestedEnabled: false, credential: { hasCredential: false } } })
    expect(service.requestEnable({ id: created.channel!.id, actorId: 'user-a' })).toMatchObject({ ok: false, code: 'adapter-not-supported' })
    expect(database.connection.prepare('select public_config_json,requested_enabled from agent_channels where id=?').get(created.channel!.id)).toEqual({ public_config_json: '{}', requested_enabled: 0 })
    expect(() => assertDiscordSecret({ bot_token: 'a'.repeat(24) })).not.toThrow()
    expect(() => assertDiscordSecret({ bot_token: 'short' })).toThrow('channel-input-invalid')
    expect(() => assertDiscordSecret({ bot_token: 'a'.repeat(24), client_secret: 'forbidden' })).toThrow('channel-input-invalid')
  })

  it('normalizes bounded Discord provider facts without URLs and decodes conversation before injected HTTP', async () => {
    const normalized = normalizeDiscordEvent({ id: 'event_1', author_id: 'user_1', conversation_id: 'guild_1', kind: 'guild', content: 'hello', url: 'https://private', attachments: [{ id: 'file_1', kind: 'image', mime_type: 'image/png', url: 'https://private' }] })
    expect(normalized).toMatchObject({ eventKey: 'discord:event:event_1', conversationKey: 'discord:conversation:guild:guild_1', attachments: [{ stableRef: 'discord:file:file_1' }] })
    expect(JSON.stringify(normalized)).not.toContain('https://private')
    expect(normalizeDiscordEvent({ id: 'bad key', author_id: 'user', conversation_id: 'guild', kind: 'guild' })).toBeNull()
    expect(encodeDiscordConversation({ kind: 'guild', id: 'channel_1' })).toBe('discord:conversation:guild:channel_1')
    expect(decodeDiscordConversation('discord:conversation:guild:bad key')).toBeNull()
    expect(splitDiscordText('x'.repeat(4_001)).map((part) => part.length)).toEqual([2_000, 2_000, 1])

    const urls: string[] = []; const bodies: unknown[] = []
    const fetch = async (url: string, init?: RequestInit) => { urls.push(url); bodies.push(JSON.parse(String(init?.body))); return response() }
    const client = new DiscordApiClient({ getPlatformFetch: () => fetch as typeof globalThis.fetch, token: async () => 'internal-token' })
    const delivery = new DiscordDeliveryTransport(); delivery.setClient('discord-a', client, { isCurrent: () => true, signal: new AbortController().signal })
    await expect(delivery.send({ channelId: 'discord-a', providerConversationKey: 'discord:conversation:guild:guild_1', text: 'reply', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'delivered' })
    await expect(delivery.send({ channelId: 'discord-a', providerConversationKey: 'discord:conversation:guild:bad key', text: 'no', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'failed', code: 'delivery-provider-rejected' })
    expect(urls).toEqual(['https://discord.com/api/v10/channels/guild_1/messages'])
    expect(bodies).toEqual([{ content: 'reply' }])
    expect(JSON.stringify(bodies)).not.toContain('discord:conversation:')
  })

  it.each(['system', 'custom', 'none'])('uses the explicitly injected %s platform fetch path', async (_mode) => {
    const fetch = vi.fn(async () => response()) as unknown as typeof globalThis.fetch
    const client = new DiscordApiClient({ getPlatformFetch: () => fetch, token: async () => 'internal-token' })
    await expect(client.sendText({ kind: 'direct', id: 'user_1' }, 'text')).resolves.toBe('delivered')
    expect(fetch).toHaveBeenCalledWith('https://discord.com/api/v10/channels/user_1/messages', expect.objectContaining({ method: 'POST' }))
  })

  it('keeps blocked Discord runtime state/audits fail-closed even for a forged active row', () => {
    const database = databaseForDiscord()
    seedActiveDiscord(database)
    const runtime = new DiscordRuntimeRepository(database)
    expect(new ChannelInboundRepository(database).getCurrentAgentId('discord-a', 1)).toBeNull()
    expect(runtime.commitIfCurrent('discord-a', 1, 4)).toBe(false)
    expect(runtime.auditIfCurrent('discord-a', 1, 'discord-test')).toBe(false)
    expect(database.connection.prepare('select count(*) as count from channel_discord_gateway_state').get()).toEqual({ count: 0 })
    database.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='inactive' where channel_id='discord-a'").run()
    expect(runtime.commitIfCurrent('discord-a', 1, 5)).toBe(false)
    expect(runtime.auditIfCurrent('discord-a', 1, 'stale')).toBe(false)
  })

  it('denies forged Discord C03 delivery claims and conversation cipher reads before ledger writes', () => {
    const database = databaseForDiscord(); seedActiveDiscord(database)
    database.connection.exec(`
      insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at)
        values('discord-conversation','discord-a',x'00','payload-ref',1,'opaque','direct','session-a','2026-07-20','2026-07-20');
      insert into channel_delivery_targets(id,channel_id,conversation_id,enabled,created_at,updated_at)
        values('discord-target','discord-a','discord-conversation',1,'2026-07-20','2026-07-20');
    `)
    const delivery = new ChannelDeliveryRepository(database)
    expect(delivery.getConversationKeyCipher('discord-conversation')).toBeNull()
    expect(delivery.claim({ channelId: 'discord-a', agentId: 'agent-a', conversationId: 'discord-conversation', source: 'task-result', sourceId: 'run-a', requireTarget: true, now: new Date('2026-07-20') })).toBeNull()
    expect(database.connection.prepare("select count(*) as count from channel_delivery_attempts where channel_id='discord-a'").get()).toEqual({ count: 0 })
    expect(database.connection.prepare("select count(*) as count from channel_delivery_audits where channel_id='discord-a'").get()).toEqual({ count: 0 })
  })

  it('resets sequence and Vault session metadata when a new generation commits', () => {
    const database = databaseForDiscord()
    database.connection.prepare(
      "insert into channel_discord_gateway_state(channel_id,generation,last_sequence,session_ref,session_revision,updated_at) values('discord-a',1,100,'discord-session-old',7,'2026-07-20')"
    ).run()

    // Exercise the non-authorizing UPSERT state transition directly; repository authorization stays immutable.
    commitGatewayState(database, 'discord-a', 2, 1)
    expect(database.connection.prepare('select generation,last_sequence,session_ref,session_revision from channel_discord_gateway_state where channel_id=?').get('discord-a')).toEqual({ generation: 2, last_sequence: 1, session_ref: null, session_revision: null })
    commitGatewayState(database, 'discord-a', 2, 0)
    expect(database.connection.prepare('select last_sequence from channel_discord_gateway_state where channel_id=?').get('discord-a')).toEqual({ last_sequence: 1 })
  })

  it('startup and quit fence a forged Discord owner without affecting managed Telegram', () => {
    const database = databaseForDiscord(); seedActiveDiscord(database)
    seedChannelAdapterSupport(database, ['telegram'])
    database.connection.exec("insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at) values('telegram-a','telegram','Telegram','agent-a','{}',1,'enabled','configured','2026-07-20','2026-07-20'); insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('telegram-a',1,'active','2026-07-20'); insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at) values('discord-a','discord-owner','enable',1,'2026-07-20','2026-07-20'),('telegram-a','telegram-owner','enable',1,'2026-07-20','2026-07-20')")
    const management = new ChannelManagementRepository(database)
    expect(management.activeRuntimeOwners('2026-07-20T00:00:00.000Z')).toEqual([{ channelId: 'telegram-a', generation: 1, token: 'telegram-owner' }])
    expect(database.connection.prepare('select requested_enabled,lifecycle_state from agent_channels where id=?').get('discord-a')).toEqual({ requested_enabled: 0, lifecycle_state: 'disabled' })
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get('discord-a')).toEqual({ generation: 2, lifecycle_state: 'inactive' })
    expect(management.stopAllRuntimeAndFence('2026-07-20T00:01:00.000Z')).toContain('telegram-a')
  })

  it.each(['closed', 'replaced'] as const)('does not commit or acknowledge a %s source socket during durable inbound work', async (mode) => {
    const source = new FakeSocket(); const replacement = new FakeSocket(); let created = 0; let release!: () => void
    const runtime = { commitIfCurrent: vi.fn(() => true), auditIfCurrent: vi.fn(() => true) }
    const receive = vi.fn(async (input: { acknowledge: () => Promise<void> }) => {
      await new Promise<void>((resolve) => { release = resolve })
      await expect(input.acknowledge()).rejects.toThrow('discord-current-gate-failed')
      return { disposition: 'retry' as const }
    })
    const host = new DiscordGatewayHost({ channelId: 'discord-a', generation: 1, gatewayUrl: 'wss://fake', inbound: { receive } as never, runtime: runtime as never, parseVerifiedDispatch: () => ({ sequence: 9, facts: { eventKey: 'discord:event:e1', conversationKey: 'discord:conversation:direct:user_1', userKey: 'discord:user:user_1', conversationKind: 'direct', mentionedBot: true, text: 'hello' }, acknowledgeWire: '{"ack":9}' }), createPlatformWebSocket: class { constructor(_url: string) { return (++created === 1 ? source : replacement) as never } } as never, isCurrent: () => true, signal: new AbortController().signal })
    host.start(); source.onmessage?.({ data: '{}' }); await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    if (mode === 'closed') source.onclose?.({})
    else host.start()
    release(); await vi.waitFor(() => expect(runtime.commitIfCurrent).not.toHaveBeenCalled())
    expect(source.sent).toEqual([]); expect(replacement.sent).toEqual([])
  })

  it('purges Discord runtime rows in the established delete isolation transaction', async () => {
    const database = databaseForDiscord(); const repository = new ChannelManagementRepository(database)
    expect(repository.create({ id: 'discord-delete', type: 'discord', name: 'Discord', agentId: 'agent-a', now: '2026-07-20' })).toBe(true)
    database.connection.exec("insert into channel_discord_gateway_state(channel_id,generation,last_sequence,updated_at) values('discord-delete',1,7,'2026-07-20'); insert into channel_discord_runtime_audits(id,channel_id,code,created_at) values('discord-audit','discord-delete','discord-test','2026-07-20')")
    expect(repository.beginDelete('discord-delete', 'discord-delete-operation', '2026-07-20')).not.toBeNull()
    expect(database.connection.prepare('select count(*) as count from channel_discord_gateway_state where channel_id=?').get('discord-delete')).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_discord_runtime_audits where channel_id=?').get('discord-delete')).toEqual({ count: 0 })
  })

  it('does not construct injected HTTP or Gateway dependencies while Discord remains blocked', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch; const webSocket = vi.fn() as never
    const manager = new DiscordRuntimeManager({ inbound: {} as never, runtime: new DiscordRuntimeRepository(createAgentPlatformDatabase(':memory:')), vault: {} as never, getPlatformFetch: () => fetch, createPlatformWebSocket: webSocket, delivery: new DiscordDeliveryTransport(), getCredential: () => ({ ref: 'known', revision: 1 }), ownsLifecycleOwner: () => true, isCurrentActive: () => true })
    await expect(manager.start('discord-a', 1, 'owner-a')).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled(); expect(webSocket).not.toHaveBeenCalled()
  })
})

function databaseForDiscord() { const database = createAgentPlatformDatabase(':memory:'); database.connection.exec("insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-20','2026-07-20')"); return database }
function commitGatewayState(database: ReturnType<typeof createAgentPlatformDatabase>, channelId: string, generation: number, sequence: number) {
  return database.connection.prepare(discordGatewayStateUpsertSql()).run(channelId, generation, sequence, '2026-07-20').changes
}
function seedActiveDiscord(database: ReturnType<typeof createAgentPlatformDatabase>) { database.connection.exec("insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at) values('discord-a','discord','Discord','agent-a','{}',1,'enabled','configured','2026-07-20','2026-07-20'); insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('discord-a',1,'active','2026-07-20')") }
function response(): Response { return { ok: true, status: 200, headers: new Headers(), json: async () => ({}) } as Response }
class FakeSocket { sent: string[] = []; onopen: ((event: unknown) => void) | null = null; onclose: ((event: unknown) => void) | null = null; onerror: ((event: unknown) => void) | null = null; onmessage: ((event: { data: unknown }) => void) | null = null; close(): void {}; send(value: string): void { this.sent.push(value) } }
