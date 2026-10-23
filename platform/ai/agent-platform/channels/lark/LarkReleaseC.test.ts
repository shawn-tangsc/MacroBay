import { describe, expect, it, vi } from 'vitest'

import { LarkApiClient } from './LarkApiClient'
import { decodeLarkConversation, encodeLarkConversation, splitLarkText } from './LarkContracts'
import { LarkDeliveryTransport } from './LarkDeliveryTransport'
import { LarkRuntimeRepository } from './LarkRuntimeRepository'
import { LarkLongConnectionHost } from './LarkLongConnectionHost'
import { LarkRuntimeManager } from './LarkRuntimeManager'
import { normalizeLarkEvent } from './LarkUpdateNormalizer'
import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { ChannelDeliveryTransportRouter } from '../ChannelDeliveryTransportRouter'
import { ChannelManagementRepository } from '../ChannelManagementRepository'
import { ChannelInboundRepository } from '../ChannelInboundRepository'

describe('Lark Release C contracts', () => {
  it('normalizes only bounded structured facts and never retains provider URLs', () => {
    const fact = normalizeLarkEvent({ event_id: 'evt-1', message_id: 'msg-1', chat_id: 'chat_1', user_id: 'user_1', chat_type: 'group', mentioned_bot: true, text: 'hello', attachments: [{ kind: 'image', file_key: 'file_1', mime_type: 'image/png', url: 'https://private' }] })
    expect(fact).toMatchObject({ conversationKey: 'lark:conversation:chat:chat_1', mentionedBot: true, attachments: [{ stableRef: 'lark:file:file_1' }] })
    expect(JSON.stringify(fact)).not.toContain('https://private')
    expect(normalizeLarkEvent({ event_id: 'evt', chat_id: 'bad key', user_id: 'u', chat_type: 'group' })).toBeNull()
  })

  it('decodes only Lark conversations before sending HTTP without a C03 prefix', async () => {
    const bodies: unknown[] = []
    const urls: string[] = []
    const fetch = async (url: string, init?: RequestInit) => {
      urls.push(url)
      bodies.push(JSON.parse(String(init?.body)))
      return response(bodies.length === 1 ? { code: 0, tenant_access_token: 'internal-token' } : { code: 0 })
    }
    const client = new LarkApiClient({ getPlatformFetch: () => fetch as typeof globalThis.fetch, credentials: async () => ({ appId: 'cli_12345678', appSecret: 'a'.repeat(20) }) })
    const delivery = new LarkDeliveryTransport()
    delivery.setClient('lark-a', client, { isCurrent: () => true, signal: new AbortController().signal })
    await expect(delivery.send({ channelId: 'lark-a', providerConversationKey: 'lark:conversation:chat:chat_1:thread:root_1', text: 'reply', idempotencyKey: 'opaque' })).resolves.toEqual({ kind: 'delivered' })
    await expect(delivery.send({ channelId: 'lark-a', providerConversationKey: 'lark:conversation:chat:bad key', text: 'no', idempotencyKey: 'opaque2' })).resolves.toEqual({ kind: 'failed', code: 'delivery-provider-rejected' })
    expect(bodies[1]).toEqual({ receive_id: 'chat_1', msg_type: 'text', content: '{"text":"reply"}', root_id: 'root_1' })
    expect(urls).toEqual([
      'https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal',
      'https://open.larksuite.com/open-apis/im/v1/messages?receive_id_type=chat_id'
    ])
    expect(urls.every((url) => url.startsWith('https://open.larksuite.com/open-apis/'))).toBe(true)
    expect(urls.join('\n')).not.toContain('open.feishu.cn')
    expect(JSON.stringify(bodies)).not.toContain('lark:conversation:')
  })

  it('keeps conversation codec and conservative 4k splitting bounded', () => {
    expect(encodeLarkConversation({ chatId: 'chat_1', threadId: 'root_1' })).toBe('lark:conversation:chat:chat_1:thread:root_1')
    expect(decodeLarkConversation('lark:conversation:chat:bad key')).toBeNull()
    expect(splitLarkText('x'.repeat(8_001)).map((part) => part.length)).toEqual([4_000, 4_000, 1])
  })

  it('keeps blocked Lark runtime state/audits fail-closed even for a forged active row', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-20','2026-07-20');
      insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values('lark-a','feishu','Lark','agent-a','{"domain":"lark"}',1,'runtime-ready','configured','2026-07-20','2026-07-20');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('lark-a',1,'active','2026-07-20');
    `)
    const runtime = new LarkRuntimeRepository(database)
    expect(runtime.commitIfCurrent('lark-a', 1, 'opaque-event')).toBe(false)
    expect(runtime.auditIfCurrent('lark-a', 1, 'lark-test')).toBe(false)
    expect(database.connection.prepare('select count(*) as count from channel_lark_runtime_state').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_lark_runtime_audits').get()).toEqual({ count: 0 })
    database.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='inactive' where channel_id='lark-a'").run()
    expect(runtime.commitIfCurrent('lark-a', 1, 'stale')).toBe(false)
    expect(runtime.auditIfCurrent('lark-a', 1, 'late')).toBe(false)
  })

  it.each(['{}', '{"domain":"feishu"}'])('keeps active non-Lark Feishu storage rows out of Lark runtime state: %s', (publicConfig) => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-20','2026-07-20');
      insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values('not-lark','feishu','Legacy','agent-a','${publicConfig}',1,'runtime-ready','configured','2026-07-20','2026-07-20');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('not-lark',1,'active','2026-07-20');
    `)
    const runtime = new LarkRuntimeRepository(database)
    expect(runtime.commitIfCurrent('not-lark', 1, 'opaque-event')).toBe(false)
    expect(runtime.auditIfCurrent('not-lark', 1, 'lark-test')).toBe(false)
    expect(database.connection.prepare('select count(*) as count from channel_lark_runtime_state').get()).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_lark_runtime_audits').get()).toEqual({ count: 0 })
  })

  it('fences a persisted no-evidence Lark generation without emitting a Telegram or post-fence Lark audit', () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveLark(database)
    const management = new ChannelManagementRepository(database)
    const runtime = new LarkRuntimeRepository(database)

    management.disableRuntimeGeneration('lark-a', 1, '2026-07-20T00:00:00.000Z')

    expect(runtime.auditIfCurrent('lark-a', 1, 'lark-runtime-evidence-missing')).toBe(false)
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get('lark-a')).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get('lark-a')).toEqual({ generation: 2, lifecycle_state: 'inactive' })
    expect(database.connection.prepare('select count(*) as count from channel_telegram_runtime_audits where channel_id=?').get('lark-a')).toEqual({ count: 0 })
    expect(database.connection.prepare('select count(*) as count from channel_lark_runtime_audits where channel_id=?').get('lark-a')).toEqual({ count: 0 })
  })

  it.each(['{}', '{"domain":"feishu"}'])('startup and quit fence an active isolated Feishu row while managed adapter rows remain eligible: %s', (publicConfig) => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values
        ('agent-a','custom','Agent A','[]','[]','a','2026-07-20','2026-07-20'),
        ('agent-b','custom','Agent B','[]','[]','b','2026-07-20','2026-07-20'),
        ('agent-c','custom','Agent C','[]','[]','c','2026-07-20','2026-07-20'),
        ('agent-d','custom','Agent D','[]','[]','d','2026-07-20','2026-07-20');
      insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values
        ('legacy-feishu','feishu','Legacy','agent-a','${publicConfig}',1,'runtime-ready','configured','2026-07-20','2026-07-20'),
        ('telegram-a','telegram','Telegram','agent-b','{}',1,'runtime-ready','configured','2026-07-20','2026-07-20'),
        ('slack-a','slack','Slack','agent-c','{}',1,'runtime-ready','configured','2026-07-20','2026-07-20'),
        ('lark-a','feishu','Lark','agent-d','{"domain":"lark"}',1,'runtime-ready','configured','2026-07-20','2026-07-20');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values
        ('legacy-feishu',1,'active','2026-07-20'),('telegram-a',1,'active','2026-07-20'),('slack-a',1,'active','2026-07-20'),('lark-a',1,'active','2026-07-20');
      insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at) values
        ('legacy-feishu','legacy-owner','enable',1,'2026-07-20','2026-07-20'),
        ('telegram-a','telegram-owner','enable',1,'2026-07-20','2026-07-20'),
        ('slack-a','slack-owner','enable',1,'2026-07-20','2026-07-20'),
        ('lark-a','lark-owner','enable',1,'2026-07-20','2026-07-20');
    `)
    const management = new ChannelManagementRepository(database)
    const inbound = new ChannelInboundRepository(database)

    // C03 authorization refuses the row even before startup has fenced its forged active state.
    expect(inbound.getCurrentAgentId('legacy-feishu', 1)).toBeNull()
    // Bootstrap discovery fences isolated storage rows before it returns any runtime owner.
    expect(management.activeRuntimeOwners('2026-07-20T00:00:00.000Z').map((owner) => owner.channelId).sort()).toEqual(['telegram-a'])
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get('legacy-feishu')).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get('legacy-feishu')).toEqual({ generation: 2, lifecycle_state: 'inactive' })
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get('legacy-feishu')).toEqual({ count: 0 })

    // A later quit sees no active isolated row; managed owners retain their usual shutdown fence.
    expect(management.stopAllRuntimeAndFence('2026-07-20T00:01:00.000Z')).not.toContain('legacy-feishu')
    for (const channelId of ['telegram-a', 'slack-a', 'lark-a']) {
      expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get(channelId)).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    }
  })

  it.each(['{}', '{"domain":"feishu"}'])('quit directly fences an isolated Feishu runtime owner and generation: %s', (publicConfig) => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-20','2026-07-20');
      insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values('legacy-feishu','feishu','Legacy','agent-a','${publicConfig}',1,'runtime-ready','configured','2026-07-20','2026-07-20');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('legacy-feishu',1,'active','2026-07-20');
      insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at) values('legacy-feishu','legacy-owner','enable',1,'2026-07-20','2026-07-20');
    `)
    const management = new ChannelManagementRepository(database)

    expect(management.stopAllRuntimeAndFence('2026-07-20T00:00:00.000Z')).toEqual(['legacy-feishu'])
    expect(database.connection.prepare('select requested_enabled,migration_state from agent_channels where id=?').get('legacy-feishu')).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    expect(database.connection.prepare('select generation,lifecycle_state from channel_runtime_generations where channel_id=?').get('legacy-feishu')).toEqual({ generation: 2, lifecycle_state: 'inactive' })
    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations where channel_id=?').get('legacy-feishu')).toEqual({ count: 0 })
  })

  it('does not construct HTTP or WebSocket runtime dependencies while Lark remains blocked', async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    const webSocket = vi.fn() as never
    const manager = new LarkRuntimeManager({
      inbound: {} as never, runtime: new LarkRuntimeRepository(createAgentPlatformDatabase(':memory:')),
      vault: {} as never, getPlatformFetch: () => fetch, createPlatformWebSocket: webSocket,
      delivery: new LarkDeliveryTransport(), getCredential: () => ({ ref: 'known', revision: 1 }), keyedHash: async () => 'opaque',
      ownsLifecycleOwner: () => true, isCurrentActive: () => true
    })
    await expect(manager.start('lark-a', 1, 'owner-a')).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect(webSocket).not.toHaveBeenCalled()
  })

  it('does not route an isolated Feishu storage row to Telegram or Lark delivery', async () => {
    const telegram = { send: vi.fn(), supportsIdempotency: vi.fn(() => false) }
    const lark = { send: vi.fn(), supportsIdempotency: vi.fn(() => false) }
    const router = new ChannelDeliveryTransportRouter({
      typeForChannel: () => null,
      telegram,
      slack: { send: vi.fn(), supportsIdempotency: vi.fn(() => false) },
      lark,
      qq: { send: vi.fn(), supportsIdempotency: vi.fn(() => false) },
      discord: { send: vi.fn(), supportsIdempotency: vi.fn(() => false) },
      wechat: { send: vi.fn(), supportsIdempotency: vi.fn(() => false) }
    })
    await expect(router.send({ channelId: 'legacy-feishu', providerConversationKey: 'opaque', text: 'text', idempotencyKey: 'key' }))
      .resolves.toEqual({ kind: 'failed', code: 'delivery-host-unavailable' })
    expect(telegram.send).not.toHaveBeenCalled()
    expect(lark.send).not.toHaveBeenCalled()
  })

  it('rejects a source socket replaced before durable inbound acknowledgement without committing state', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActiveLark(database)
    const socket = new FakeSocket()
    let release!: () => void
    const receive = vi.fn(async (input: { acknowledge: () => Promise<void> }) => {
      await new Promise<void>((resolve) => { release = resolve })
      await expect(input.acknowledge()).rejects.toThrow('lark-current-gate-failed')
      return { disposition: 'retry' as const }
    })
    const host = new LarkLongConnectionHost({
      channelId: 'lark-a', generation: 1, socketUrl: 'wss://fake', inbound: { receive } as never, runtime: new LarkRuntimeRepository(database),
      hashEventKey: async () => 'opaque-event', parseVerifiedEnvelope: () => ({ facts: {
        eventKey: 'lark:event:e1', conversationKey: 'lark:conversation:chat:chat_1', userKey: 'lark:user:user_1', conversationKind: 'direct', mentionedBot: true, text: 'hello'
      }, acknowledgeWire: '{"ack":"opaque"}' }),
      reconnectSocketUrl: async () => null,
      createPlatformWebSocket: class { constructor(_url: string) { return socket as never } } as never,
      isCurrent: () => true, signal: new AbortController().signal
    })
    host.start()
    socket.onmessage?.({ data: '{}' })
    await vi.waitFor(() => expect(receive).toHaveBeenCalledOnce())
    socket.onclose?.({})
    release()
    await vi.waitFor(() => expect(database.connection.prepare('select count(*) as count from channel_lark_runtime_state').get()).toEqual({ count: 0 }))
    expect(socket.sent).toEqual([])
  })
})

class FakeSocket {
  sent: string[] = []
  onopen: ((event: unknown) => void) | null = null
  onclose: ((event: unknown) => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  close(): void {}
  send(value: string): void { this.sent.push(value) }
}

function seedActiveLark(database: ReturnType<typeof createAgentPlatformDatabase>): void {
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-20','2026-07-20');
    insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values('lark-a','feishu','Lark','agent-a','{"domain":"lark"}',1,'runtime-ready','configured','2026-07-20','2026-07-20');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('lark-a',1,'active','2026-07-20');
  `)
}

function response(body: unknown): Response {
  return { ok: true, status: 200, headers: new Headers(), json: async () => body } as Response
}
