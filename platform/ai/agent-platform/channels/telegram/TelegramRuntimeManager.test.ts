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
    // 失败必须带原因：vault 读不到是凭据那一档，不许被上层说成「网络连不通」。
    await expect(manager.start('channel-a', 1, 'owner-a')).resolves.toMatchObject({
      ok: false, reason: 'telegram-provider-rejected'
    })
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
    // 停止时握手被打断：重要的是「有原因」而不是「一句什么都对的兜底话」。
    const aborted = await pending
    expect(aborted).toMatchObject({ ok: false })
    expect(aborted.ok === false && aborted.reason.length > 0).toBe(true)
    expect(signal?.aborted).toBe(true)
  })

  it('fences all active generations after aborting lifetime controllers', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const manager = createManager(database, async () => null)
    manager.stopAllAndFence(() => {
      database.connection.prepare("update agent_channels set requested_enabled=0,lifecycle_state='disabled' where id='channel-a'").run()
      database.connection.prepare("update channel_runtime_generations set generation=2,lifecycle_state='inactive' where channel_id='channel-a'").run()
    })
    expect(database.connection.prepare("select requested_enabled,lifecycle_state from agent_channels where id='channel-a'").get()).toEqual({ requested_enabled: 0, lifecycle_state: 'disabled' })
    expect(new ChannelInboundRepository(database).isCurrentActive('channel-a', 1)).toBe(false)
  })

  it('refuses a missing, mismatched or stale durable owner before getMe can start', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    const manager = createManager(database, async () => 'token', fetch)
    // 三个检查各自一个码：这三处都报「启动失败」，就等于什么都没说。
    await expect(manager.start('channel-a', 1, '')).resolves.toEqual({ ok: false, reason: 'channel-runtime-owner-missing' })
    await expect(manager.start('channel-a', 2, 'owner-a')).resolves.toEqual({ ok: false, reason: 'channel-runtime-owner-missing' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names the stale generation check separately from the owner checks', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    // owner 还对得上，但代际已不活跃（频道被停用）：一个网络请求都不该发。
    database.connection.prepare("update agent_channels set lifecycle_state='disabled', requested_enabled=0 where id='channel-a'").run()
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    const manager = createManager(database, async () => 'token', fetch)
    await expect(manager.start('channel-a', 1, 'owner-a')).resolves.toEqual({
      ok: false, reason: 'channel-runtime-generation-stale'
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names the owner-lost check when the permit disappears between the two checks', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const fetch = vi.fn() as unknown as typeof globalThis.fetch
    let checks = 0
    const manager = new TelegramRuntimeManager({
      inbound: new ChannelInboundRepository(database), inboundService: {} as never, offsets: new TelegramOffsetRepository(database),
      vault: { get: async () => ({ bot_token: 'token' }) } as never, getPlatformFetch: () => fetch,
      delivery: new TelegramDeliveryTransport(), getCredential: () => ({ ref: 'known', revision: 1 }),
      // 第一次检查还成立，第二次（stop 之后）已经丢了许可。
      ownsLifecycleOwner: () => { checks += 1; return checks === 1 }
    })
    await expect(manager.start('channel-a', 1, 'owner-a')).resolves.toEqual({
      ok: false, reason: 'channel-runtime-owner-lost'
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('leaves a runtime audit row when the poller loses its entitlement instead of exiting silently', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => (String(url).includes('/getMe') ? { ok: true, result: { username: 'bot' } } : { ok: true, result: [] })
    })) as unknown as typeof globalThis.fetch
    const exits: string[] = []
    let valid = true
    const manager = new TelegramRuntimeManager({
      inbound: new ChannelInboundRepository(database), inboundService: {} as never, offsets: new TelegramOffsetRepository(database),
      vault: { get: async () => ({ bot_token: 'token' }) } as never, getPlatformFetch: () => fetch,
      delivery: new TelegramDeliveryTransport(), getCredential: () => ({ ref: 'known', revision: 1 }),
      ownsLifecycleOwner: () => valid,
      recordExit: (_channelId, _generation, code) => exits.push(code)
    })
    await expect(manager.start('channel-a', 1, 'owner-a')).resolves.toEqual({ ok: true })
    // 启动成功之后才失去资格（例如被停用/换代），宿主下一拍必须退出并留痕。
    valid = false
    // 等的是「退出留痕这件事发生了」，不是等 20 毫秒：固定时长在慢机器上假红，
    // 在快机器上会把「没退出」暴露成后面那条 stop 里的另一个症状。上限只兜底。
    await vi.waitFor(() => expect(exits).toEqual(['channel-stale-generation']), { timeout: 2_000, interval: 10 })
    manager.stop('channel-a')
  })

  it('reports the handshake failure reason instead of a generic network sentence', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const failures: Array<{ channelId: string; generation: number; reason: string }> = []
    // 409：另一个进程正拿着这个 bot。它和「网络不通」是两件完全不同的事。
    const fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      headers: new Headers(),
      json: async () => ({ ok: false, error_code: 409, description: 'Conflict' })
    })) as unknown as typeof globalThis.fetch
    const withRecorder = new TelegramRuntimeManager({
      inbound: new ChannelInboundRepository(database), inboundService: {} as never, offsets: new TelegramOffsetRepository(database),
      vault: { get: async () => ({ bot_token: 'token' }) } as never, getPlatformFetch: () => fetch,
      delivery: new TelegramDeliveryTransport(), getCredential: () => ({ ref: 'known', revision: 1 }),
      ownsLifecycleOwner: (_channelId, token, generation) => token === 'owner-a' && generation === 1,
      recordFailure: (channelId, generation, reason) => failures.push({ channelId, generation, reason })
    })
    await expect(withRecorder.start('channel-a', 1, 'owner-a')).resolves.toEqual({ ok: false, reason: 'telegram-conflict' })
    expect(failures).toEqual([{ channelId: 'channel-a', generation: 1, reason: 'telegram-conflict' }])
  })

  it('records one started and one stopped, and never repeats a stop', async () => {
    const database = createAgentPlatformDatabase(':memory:')
    seedActive(database)
    const recorded: Array<{ channelId: string; generation: number; state: string }> = []
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => (String(url).includes('/getMe')
        ? { ok: true, result: { username: 'bot' } }
        : { ok: true, result: [] })
    })) as unknown as typeof globalThis.fetch
    const manager = createManager(database, async () => 'token', fetch, (channelId, generation, state) => recorded.push({ channelId, generation, state }))

    await expect(manager.start('channel-a', 1, 'owner-a')).resolves.toEqual({ ok: true })
    expect(recorded).toEqual([{ channelId: 'channel-a', generation: 1, state: 'started' }])

    manager.stop('channel-a')
    expect(recorded).toEqual([
      { channelId: 'channel-a', generation: 1, state: 'started' },
      { channelId: 'channel-a', generation: 1, state: 'stopped' }
    ])

    // 重复停不是状态变化：不再写第二条。
    manager.stop('channel-a')
    expect(recorded).toHaveLength(2)
  })
})

function createManager(
  database: ReturnType<typeof createAgentPlatformDatabase>,
  token: () => Promise<string | null>,
  fetch: typeof globalThis.fetch = vi.fn() as never,
  recordLifecycle?: (channelId: string, generation: number, state: 'started' | 'stopped') => void
): TelegramRuntimeManager {
  return new TelegramRuntimeManager({
    inbound: new ChannelInboundRepository(database), inboundService: {} as never, offsets: new TelegramOffsetRepository(database),
    vault: { get: async () => ({ bot_token: await token() }) } as never, getPlatformFetch: () => fetch,
    delivery: new TelegramDeliveryTransport(), getCredential: () => ({ ref: 'known', revision: 1 }),
    ownsLifecycleOwner: (_channelId, token, generation) => token === 'owner-a' && generation === 1,
    ...(recordLifecycle ? { recordLifecycle } : {})
  })
}

function seedActive(database: ReturnType<typeof createAgentPlatformDatabase>): void {
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at) values('agent-a','custom','Agent','[]','[]','a','2026-07-19','2026-07-19');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at) values('channel-a','telegram','Telegram','agent-a','{}',1,'enabled','configured','2026-07-19','2026-07-19');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('channel-a',1,'active','2026-07-19');
  `)
  seedChannelAdapterSupport(database, ['telegram'])
}
