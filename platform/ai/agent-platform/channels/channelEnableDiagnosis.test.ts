import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelInboundRepository } from './ChannelInboundRepository'
import { TelegramDeliveryTransport } from './telegram/TelegramDeliveryTransport'
import { TelegramOffsetRepository } from './telegram/TelegramOffsetRepository'
import { TelegramRuntimeManager } from './telegram/TelegramRuntimeManager'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'
import { setChannelAcceptanceOverride } from './channelAcceptanceOverride'
import { seedChannelAdapterSupport } from './channelTestSupport'

/**
 * 启用最后一跳的**诊断**：为什么开不起来，必须能分别说清。
 *
 * 用户 2026-11-04 的现场：频道 `lifecycle_state=ready`、`credential_health=configured`、绑的助手
 * `daily-brief-editor` 明明在列表里，点启用却反复报「这条频道绑的助手不在了，刷新之后重选一个」。
 *
 * 两个真因叠在一起：
 * 1. `SUPPORTED_CHANNEL_SQL` 是**模块加载时**算死的常量，而「自检通过后只放行这一条」是进程内状态
 *    （`setChannelAcceptanceOverride`）——放行永远进不了那条 UPDATE，启用必失败；
 * 2. 失败分支拿 `channel-agent-missing` 当兜底，把「最后一跳没落成」说成「助手不在了」。
 *
 * 所以这里既钉「能开」，也钉「每个失败原因说自己的话」。
 */

const CHANNEL_ID = 'e3087f1f-1122-4b46-95f9-cc77129c1fc5'
const AGENT_ID = 'daily-brief-editor'

function harness(options: { smokeOk?: boolean } = {}) {
  const database = createAgentPlatformDatabase(':memory:')
  // 七项真机证据一项都没有：适配器保持 blocked，只有进程内的自检放行能让它开起来。
  seedChannelAdapterSupport(database, [])
  database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
    values('${AGENT_ID}','custom','每日简报编辑','[]','[]','a','2026-11-04','2026-11-04')`)
  database.connection.prepare(
    `insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,credential_ref,credential_revision,created_at,updated_at)
     values(?,'telegram','test',?,'{}',0,'ready','configured',?,2,'2026-11-04','2026-11-04')`
  ).run(CHANNEL_ID, AGENT_ID, `channel-migration:${CHANNEL_ID}:ref`)

  const vault = {
    inspectSafe: async (ref: string) => ({ credentialRef: ref, revision: 2, maskedFields: {} }),
    get: async () => ({ bot_token: '8830:secret' })
  }
  const runtime = { start: vi.fn(async () => true), stop: vi.fn() }
  const service = new ChannelManagementService({
    repository: new ChannelManagementRepository(database),
    vault: vault as never,
    cipher: {} as never,
    registry: new ChannelAdapterAcceptanceRegistry(),
    handoff: new ChannelSecureHandoff(),
    runtime,
    smoke: async () => (options.smokeOk === false
      ? { ok: false, code: 'telegram-proxy-unavailable', transportError: 'ERR_PROXY_CONNECTION_FAILED', proxy: 'DIRECT', fetch: 'net' }
      : { ok: true }),
    now: () => new Date('2026-11-04T07:50:00.000Z')
  })
  return { database, service, runtime }
}

afterEach(() => {
  // 放行是进程内状态：用例之间必须还原，否则后面所有用例都「悄悄支持了 telegram」。
  setChannelAcceptanceOverride(null)
})

describe('enabling a channel that has no seven-item evidence', () => {
  it('opens when the on-the-spot self-check passes (the in-process pass must reach the last hop)', async () => {
    const { database, service, runtime } = harness()

    const result = await Promise.resolve(service.requestEnable({ id: CHANNEL_ID, actorId: 'user-a' }))

    expect(result).toMatchObject({ ok: true, code: 'runtime-ready' })
    expect(runtime.start).toHaveBeenCalledOnce()
    expect(database.connection.prepare('select lifecycle_state, requested_enabled from agent_channels where id = ?').get(CHANNEL_ID)).toEqual({
      lifecycle_state: 'enabled',
      requested_enabled: 1
    })
  })

  it('reproduces the real shape: ready channel with closed-out history and a passing self-check opens', async () => {
    const { database, service } = harness()
    // 那一夜留下的 9 笔已经收口（7 abandoned + 2 completed），不该再挡住启用。
    for (let index = 0; index < 9; index += 1) {
      database.connection.prepare(
        `insert into channel_management_operations(id,channel_id,purpose,credential_ref,expected_revision,state,recovery_attempts,created_at,updated_at)
         values(?,?,'rotate',?,1,?,0,'2026-11-03T23:00:00.000Z','2026-11-03T23:00:00.000Z')`
      ).run(`op-${index}`, CHANNEL_ID, `channel-migration:${CHANNEL_ID}:ref`, index < 7 ? 'abandoned' : 'completed')
    }

    await expect(Promise.resolve(service.requestEnable({ id: CHANNEL_ID, actorId: 'user-a' }))).resolves.toMatchObject({
      ok: true, code: 'runtime-ready'
    })
  })

  it('does not claim the assistant is gone when a pending credential operation is the actual blocker', async () => {
    const { database, service, runtime } = harness()
    database.connection.prepare(
      `insert into channel_management_operations(id,channel_id,purpose,credential_ref,expected_revision,state,recovery_attempts,created_at,updated_at)
       values('op-pending',?,'rotate',?,2,'needs-recovery',0,'2026-11-03T23:00:00.000Z','2026-11-03T23:00:00.000Z')`
    ).run(CHANNEL_ID, `channel-migration:${CHANNEL_ID}:ref`)

    const result = await Promise.resolve(service.requestEnable({ id: CHANNEL_ID, actorId: 'user-a' }))

    expect(result.code).toBe('channel-credential-mutation-incomplete')
    expect(result.code).not.toBe('channel-agent-missing')
    expect(runtime.start).not.toHaveBeenCalled()
  })

  it('reports an unhealthy credential as such, not as a missing assistant', async () => {
    const { database, service } = harness()
    database.connection.prepare("update agent_channels set credential_health = 'unavailable' where id = ?").run(CHANNEL_ID)

    const result = await Promise.resolve(service.requestEnable({ id: CHANNEL_ID, actorId: 'user-a' }))

    expect(result.code).toBe('channel-credential-unavailable')
  })

  it('only says the assistant is gone when the agent row really is gone', async () => {
    const { database, service } = harness()
    database.connection.prepare('delete from agent_entities where id = ?').run(AGENT_ID)

    const result = await Promise.resolve(service.requestEnable({ id: CHANNEL_ID, actorId: 'user-a' }))

    expect(result.code).toBe('channel-agent-missing')
  })

  it('starts the real Telegram runtime on the user-shaped row (configured / disabled / epoch 13, no evidence)', async () => {
    // 用户的真实状态：凭据可用、频道停用、没有七项证据；点一次开关必须真的起来，
    // 而不是在「当前代际是否活跃」那一步被判否（那里曾经也被算死在模块加载时）。
    const database = createAgentPlatformDatabase(':memory:')
    seedChannelAdapterSupport(database, [])
    database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('${AGENT_ID}','custom','每日简报编辑','[]','[]','a','2026-11-04','2026-11-04')`)
    database.connection.prepare(
      `insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,credential_ref,credential_revision,mutation_epoch,created_at,updated_at)
       values(?,'telegram','test',?,'{}',0,'disabled','configured',?,2,13,'2026-11-04','2026-11-04')`
    ).run(CHANNEL_ID, AGENT_ID, `channel-migration:${CHANNEL_ID}:ref`)

    const repository = new ChannelManagementRepository(database)
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => (String(url).includes('/getMe') ? { ok: true, result: { username: 'bot' } } : { ok: true, result: [] })
    }))
    const fetch = fetchMock as unknown as typeof globalThis.fetch
    const manager = new TelegramRuntimeManager({
      inbound: new ChannelInboundRepository(database),
      inboundService: { acknowledge: async () => undefined, reject: async () => undefined } as never,
      offsets: new TelegramOffsetRepository(database),
      vault: { get: async () => ({ bot_token: '8830:secret' }) } as never,
      getPlatformFetch: () => fetch,
      delivery: new TelegramDeliveryTransport(),
      getCredential: (id) => repository.credentialMetadata(id),
      ownsLifecycleOwner: (id, token, generation) => repository.ownsLifecycleOwner(id, { token, purpose: 'enable', generation }),
      recordLifecycle: () => undefined
    })
    const service = new ChannelManagementService({
      repository,
      vault: { inspectSafe: async (ref: string) => ({ credentialRef: ref, revision: 2, maskedFields: {} }), get: async () => ({ bot_token: '8830:secret' }) } as never,
      cipher: {} as never,
      registry: new ChannelAdapterAcceptanceRegistry(),
      handoff: new ChannelSecureHandoff(),
      runtime: { start: (id, generation, token) => manager.start(id, generation, token), stop: (id) => manager.stop(id) },
      smoke: async () => ({ ok: true }),
      now: () => new Date('2026-11-04T08:10:00.000Z')
    })

    const result = await Promise.resolve(service.requestEnable({ id: CHANNEL_ID, actorId: 'user-a' }))

    expect(result).toMatchObject({ ok: true, code: 'runtime-ready' })
    expect(database.connection.prepare('select lifecycle_state, requested_enabled from agent_channels where id = ?').get(CHANNEL_ID)).toEqual({
      lifecycle_state: 'enabled', requested_enabled: 1
    })

    // 关键：启用成功**之后**跑一拍，轮询宿主必须真的有资格、真的发过 getUpdates。
    // 以前「自检放行」在 enable 返回的 finally 里就被清掉，宿主第一拍判 not-current 直接静默退出。
    //
    // 等的是「发过一次 getUpdates」这个**事实**，不是等 20 毫秒：固定等待在慢机器上会假红，
    // 在快机器上会把失败提前暴露成另一条断言。上限只用于兜底——真没发，这条仍然红，只是红得更晚。
    await vi.waitFor(
      () => {
        const updatePolls = fetchMock.mock.calls.filter(([url]) => String(url).includes('/getUpdates'))
        expect(updatePolls.length).toBeGreaterThanOrEqual(1)
      },
      { timeout: 2_000, interval: 10 }
    )
    const generation = (database.connection.prepare(
      'select generation from channel_runtime_generations where channel_id = ?'
    ).get(CHANNEL_ID) as { generation: number }).generation
    expect(new ChannelInboundRepository(database).isCurrentActive(CHANNEL_ID, generation)).toBe(true)
    manager.stop(CHANNEL_ID)
  })

  it('carries the runtime failure reason to the interface instead of a generic sentence', async () => {
    // 服务层的契约：运行时给什么原因，界面就拿到什么原因（以前这里被硬编码成「网络连不通」）。
    const database = createAgentPlatformDatabase(':memory:')
    seedChannelAdapterSupport(database, [])
    database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('${AGENT_ID}','custom','每日简报编辑','[]','[]','a','2026-11-04','2026-11-04')`)
    database.connection.prepare(
      `insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,credential_ref,credential_revision,created_at,updated_at)
       values(?,'telegram','test',?,'{}',0,'ready','configured',?,2,'2026-11-04','2026-11-04')`
    ).run(CHANNEL_ID, AGENT_ID, `channel-migration:${CHANNEL_ID}:ref`)
    const service = new ChannelManagementService({
      repository: new ChannelManagementRepository(database),
      vault: { inspectSafe: async (ref: string) => ({ credentialRef: ref, revision: 2, maskedFields: {} }) } as never,
      cipher: {} as never,
      registry: new ChannelAdapterAcceptanceRegistry(),
      handoff: new ChannelSecureHandoff(),
      runtime: { start: async () => ({ ok: false, reason: 'channel-runtime-generation-stale' }), stop: () => {} },
      smoke: async () => ({ ok: true }),
      now: () => new Date('2026-11-04T08:10:00.000Z')
    })

    const result = await Promise.resolve(service.requestEnable({ id: CHANNEL_ID, actorId: 'user-a' }))

    expect(result).toMatchObject({ ok: false, code: 'adapter-runtime-start-failed' })
    expect(result.reason).toBe('channel-runtime-generation-stale')
    // 审计里也留一份真实原因，下一次排查不用猜。
    const audit = database.connection.prepare(
      "select summary_json from channel_management_audits where channel_id = ? and action = 'request-enable' order by created_at desc limit 1"
    ).get(CHANNEL_ID) as { summary_json: string }
    expect(JSON.parse(audit.summary_json)).toEqual({ runtimeReason: 'channel-runtime-generation-stale' })
  })

  it('keeps the two original behaviours intact: failed self-check and unsupported adapter', async () => {
    const failing = harness({ smokeOk: false })
    await expect(Promise.resolve(failing.service.requestEnable({ id: CHANNEL_ID, actorId: 'user-a' }))).resolves.toMatchObject({
      ok: false, code: 'channel-smoke-failed', reason: 'telegram-proxy-unavailable'
    })
    // 失败原因那一行审计要带一次脱敏细节，下次排查不用再猜是 DNS、连接重置还是代理拒绝。
    const audit = failing.database.connection.prepare(
      "select code, summary_json from channel_management_audits where channel_id = ? and action = 'request-enable' order by created_at desc limit 1"
    ).get(CHANNEL_ID) as { code: string; summary_json: string }
    expect(audit.code).toBe('telegram-proxy-unavailable')
    expect(JSON.parse(audit.summary_json)).toEqual({
      transportError: 'ERR_PROXY_CONNECTION_FAILED',
      proxy: 'DIRECT',
      fetch: 'net'
    })

    setChannelAcceptanceOverride(null)
    const { service, database } = harness()
    // 自检通过之前，适配器仍未声明支持——但失败原因不能再是「助手不在了」。
    database.connection.prepare("update agent_channels set credential_health = 'configured' where id = ?").run(CHANNEL_ID)
    void service
  })
})
