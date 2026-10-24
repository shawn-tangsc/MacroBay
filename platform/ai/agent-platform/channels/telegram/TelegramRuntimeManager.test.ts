import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { ChannelInboundRepository } from '../ChannelInboundRepository'
import { TelegramDeliveryTransport } from './TelegramDeliveryTransport'
import { TelegramOffsetRepository } from './TelegramOffsetRepository'
import { TelegramRuntimeManager } from './TelegramRuntimeManager'
import { seedChannelAdapterSupport } from '../channelTestSupport'

describe('TelegramRuntimeManager', () => {
  it('contains Vault/getMe failures and leaves no client or host lifetime behind', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const manager = createManager(database, async () => { throw new Error('vault unavailable') })
    await expect(manager.start('channel-a', 1, 'owner-a')).resolves.toBe(false)
    manager.stopAllAndFence(() => {})
  })

  it('aborts a handshake that is stopped before fetch resolves', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    let signal: AbortSignal | undefined
    const fetch = vi.fn((_url: string, options?: RequestInit) => new Promise<Response>((resolve) => {
      signal = options?.signal ?? undefined
      signal?.addEventListener('abort', () => resolve({ ok: false, status: 499, json: async () => ({ ok: false }) } as Response))
    })) as unknown as typeof globalThis.fetch
    const manager = createManager(database, async () => 'token', fetch)
    const pending = manager.start('channel-a', 1, 'owner-a')
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce())
    manager.stop('channel-a')
    await expect(pending).resolves.toBe(false)
    expect(signal?.aborted).toBe(true)
  })

  it('fences all active generations after aborting lifetime controllers', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const manager = createManager(database, async () => null)
    manager.stopAllAndFence(() => {
      database.connection.prepare("update agent_channels set requested_enabled=0,migration_state='disabled' where id='channel-a'").run()
      database.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='inactive' where channel_id='channel-a'").run()
    })
    expect(database.connection.prepare("select requested_enabled,migration_state from agent_channels where id='channel-a'").get()).toEqual({ requested_enabled: 0, migration_state: 'disabled' })
    expect(new ChannelInboundRepository(database).isCurrentActive('channel-a', 1)).toBe(false)
  })

  it('refuses a missing, mismatched or stale durable owner before getMe can start', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    const manager = createManager(database, async () => 'token', fetch)
    await expect(manager.start('channel-a', 1, '')).resolves.toBe(false)
    await expect(manager.start('channel-a', 2, 'owner-a')).resolves.toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

function createManager(database: ReturnType<typeof createAgentPlatformDatabase>, token: () => Promise<string | null>, fetch: typeof globalThis.fetch = vi.fn() as never): TelegramRuntimeManager {
  return new TelegramRuntimeManager({
    inbound: new ChannelInboundRepository(database), inboundService: {} as never, offsets: new TelegramOffsetRepository(database),
    vault: { get: async () => ({ bot_token: await token() }) } as never, getPlatformFetch: () => fetch,
    delivery: new TelegramDeliveryTransport(), getCredential: () => ({ ref: 'known', revision: 1 }),
    ownsLifecycleOwner: (_channelId, token, generation) => token === 'owner-a' && generation === 1
  })
}

function seedActive(database: ReturnType<typeof createAgentPlatformDatabase>): void {
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-19','2026-07-19');
    insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values('channel-a','telegram','Telegram','agent-a','{}',1,'runtime-ready','configured','2026-07-19','2026-07-19');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('channel-a',1,'active','2026-07-19');
  `)
  seedChannelAdapterSupport(database, ['telegram'])
}
