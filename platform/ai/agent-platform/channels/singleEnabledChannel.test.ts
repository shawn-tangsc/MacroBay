import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'
import { seedChannelAdapterSupport } from './channelTestSupport'
import { reconcileSingleEnabledChannel } from './singleEnabledChannel'

/**
 * 单频道不变量（契约 v2.20 §5.3）：同一时间只允许一条频道启用。
 *
 * 为什么需要：投递一律取「唯一启用的频道」。以前允许同时启用多条，投递侧只能在「有 N 条同时启用」
 * 时停下来报错——那是把我们自己放进去的状态变成读者的麻烦，而且「不发送」等于把通知弄丢。
 * 现在的规则是**启用新的自动停用旧的**，读者不用手动关、也不用确认。
 */

function seededChannel(
  database: ReturnType<typeof createAgentPlatformDatabase>,
  id: string,
  lifecycle = 'ready'
): void {
  database.connection.prepare(
    `insert or replace into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,credential_ref,credential_revision,created_at,updated_at)
     values(?,'telegram',?,'agent-a','{}',?,?,'configured','ref-a',2,'2026-11-04','2026-11-04')`
  ).run(id, id, lifecycle === 'enabled' ? 1 : 0, lifecycle)
}

function harness(options: { withReconcile?: boolean } = {}) {
  const database = createAgentPlatformDatabase(':memory:')
  seedChannelAdapterSupport(database, ['telegram'])
  database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
    values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04')`)
  const repository = new ChannelManagementRepository(database)
  const runtime = { start: vi.fn(async () => true), stop: vi.fn() }
  const service = new ChannelManagementService({
    repository,
    vault: { inspectSafe: async (ref: string) => ({ credentialRef: ref, revision: 2, maskedFields: {} }) } as never,
    cipher: {} as never,
    registry: new ChannelAdapterAcceptanceRegistry(),
    acceptance: { isSupported: () => true },
    handoff: new ChannelSecureHandoff(),
    runtime,
    ...(options.withReconcile
      ? { singleEnabledChannel: (now: string) => reconcileSingleEnabledChannel(database, now) }
      : {}),
    now: () => new Date('2026-11-04T10:00:00.000Z')
  })
  return { database, repository, runtime, service }
}

describe('single enabled channel invariant', () => {
  it('disables the previous channel when a new one is enabled, and stops its runtime', async () => {
    const { database, runtime, service } = harness()
    seededChannel(database, 'channel-a')
    seededChannel(database, 'channel-b')

    await expect(Promise.resolve(service.requestEnable({ id: 'channel-a', actorId: 'user-a' }))).resolves.toMatchObject({ ok: true })
    await expect(Promise.resolve(service.requestEnable({ id: 'channel-b', actorId: 'user-a' }))).resolves.toMatchObject({ ok: true })

    const rows = database.connection.prepare(
      "select id, lifecycle_state from agent_channels where lifecycle_state = 'enabled' order by id"
    ).all()
    expect(rows).toEqual([{ id: 'channel-b', lifecycle_state: 'enabled' }])
    // 旧那条的运行时必须真的停掉，不能只是库里改成停用。
    expect(runtime.stop).toHaveBeenCalledWith('channel-a')
    const audit = database.connection.prepare(
      "select channel_id, action, summary_json from channel_management_audits where channel_id = 'channel-a' and action = 'disable'"
    ).get() as { channel_id: string; action: string; summary_json: string }
    expect(JSON.parse(audit.summary_json)).toEqual({ auto: 'true', reason: 'single-channel-invariant' })
  })

  it('never disables the channel being enabled twice (idempotent repeat)', async () => {
    const { database, runtime, service } = harness()
    seededChannel(database, 'channel-a')

    await expect(Promise.resolve(service.requestEnable({ id: 'channel-a', actorId: 'user-a' }))).resolves.toMatchObject({ ok: true })
    await expect(Promise.resolve(service.requestEnable({ id: 'channel-a', actorId: 'user-a' }))).resolves.toMatchObject({ ok: true })

    expect(database.connection.prepare(
      'select lifecycle_state from agent_channels where id = ?'
    ).get('channel-a')).toEqual({ lifecycle_state: 'enabled' })
    // 启动前本来就会 stop 一次再 start（既有行为）；这里要断言的是**没有被不变量停掉**：
    // 没有 disable 审计、状态仍是启用。
    expect(database.connection.prepare(
      "select count(*) as count from channel_management_audits where channel_id = 'channel-a' and action = 'disable'"
    ).get()).toEqual({ count: 0 })
  })

  it('reconciles legacy rows on startup: keeps the most recently activated, disables the rest', () => {
    const { database, runtime, service } = harness({ withReconcile: true })
    seededChannel(database, 'channel-old', 'enabled')
    seededChannel(database, 'channel-new', 'enabled')
    database.connection.exec(`
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('channel-old',3,'active','2026-11-04T09:00:00.000Z');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values('channel-new',5,'active','2026-11-04T09:30:00.000Z');
    `)

    const result = service.reconcileSingleEnabledChannel()

    expect(result).toEqual({ keptChannelId: 'channel-new', disabledChannelIds: ['channel-old'] })
    expect(database.connection.prepare(
      "select id from agent_channels where lifecycle_state = 'enabled'"
    ).all()).toEqual([{ id: 'channel-new' }])
    expect(runtime.stop).toHaveBeenCalledWith('channel-old')
    // 一行审计说明「发现多条，已保留 X、其余自动停用」。
    const audit = database.connection.prepare(
      "select channel_id, summary_json from channel_management_audits where summary_json like '%single-channel-invariant%' and channel_id = 'channel-new'"
    ).get() as { channel_id: string; summary_json: string }
    expect(JSON.parse(audit.summary_json)).toMatchObject({ auto: 'true', reason: 'single-channel-invariant', disabled: '1' })
  })

  it('leaves a single enabled channel alone on startup', () => {
    const { database, runtime, service } = harness({ withReconcile: true })
    seededChannel(database, 'channel-only', 'enabled')

    expect(service.reconcileSingleEnabledChannel()).toEqual({ keptChannelId: 'channel-only', disabledChannelIds: [] })
    expect(runtime.stop).not.toHaveBeenCalled()
  })
})
