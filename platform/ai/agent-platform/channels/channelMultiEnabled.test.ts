import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'
import { seedChannelAdapterSupport } from './channelTestSupport'
import type { ChannelAdapterKey } from './ChannelManagementPredicates'

/**
 * 多频道（方案 `multi-channel-push-design.md` §1b）：**「同一时间只允许一条启用」这个不变量已经拆了**。
 *
 * 四条判据，都是用户能感知的行为：
 * - 启用第二条**不再静默停用**第一条（旧规则：启用新的自动停用旧的，界面一句提示都没有）；
 * - 两条都启用 → 重启 → **两条都还在跑**（旧规则：启动对账只保留最近启用那条）；
 * - 历史库里两条 `requested_enabled=1` → 启动后仍是两条（不再对账）；
 * - 被旧规则停用过的那条（`requested_enabled=0` + `channel-single-enabled` 审计行）→ 重启后**仍是停用**
 *   ——自动打开是替读者改状态。
 *
 * 审计词 `channel-single-enabled` 的旧行保留、新行不再产生：审计记的是当时确实发生过的自动停用。
 */

type Database = ReturnType<typeof createAgentPlatformDatabase>

function seededChannel(database: Database, id: string, adapter: string, lifecycle = 'ready', requested = 0): void {
  database.connection.prepare(
    `insert or replace into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,credential_ref,credential_revision,created_at,updated_at)
     values(?,?,?,'agent-a','{}',?,?,'configured','ref-a',2,'2026-11-12','2026-11-12')`
  ).run(id, adapter, id, requested, lifecycle)
}

function harness(adapters: readonly ChannelAdapterKey[] = ['telegram', 'slack']) {
  const database = createAgentPlatformDatabase(':memory:')
  seedChannelAdapterSupport(database, adapters)
  database.connection.exec(`insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
    values('agent-a','custom','Agent','[]','[]','a','2026-11-12','2026-11-12')`)
  const repository = new ChannelManagementRepository(database)
  const runtime = { start: vi.fn(async (_channelId: string) => true), stop: vi.fn() }
  const service = new ChannelManagementService({
    repository,
    vault: { inspectSafe: async (ref: string) => ({ credentialRef: ref, revision: 2, maskedFields: {} }) } as never,
    cipher: {} as never,
    registry: new ChannelAdapterAcceptanceRegistry(),
    acceptance: { isSupported: () => true },
    handoff: new ChannelSecureHandoff(),
    runtime,
    now: () => new Date('2026-11-12T10:00:00.000Z')
  })
  return { database, repository, runtime, service }
}

const states = (database: Database): Array<{ id: string; lifecycle_state: string; requested_enabled: number }> =>
  database.connection.prepare(
    'select id, lifecycle_state, requested_enabled from agent_channels order by id'
  ).all() as Array<{ id: string; lifecycle_state: string; requested_enabled: number }>

const singleEnabledAudits = (database: Database): number =>
  (database.connection.prepare(
    "select count(*) as count from channel_management_audits where action = 'disable' and summary_json like '%single-channel-invariant%'"
  ).get() as { count: number }).count

describe('enabling a second channel no longer displaces the first', () => {
  it('keeps both channels enabled and leaves the first runtime running', async () => {
    const { database, runtime, service } = harness()
    seededChannel(database, 'channel-a', 'telegram')
    seededChannel(database, 'channel-b', 'slack')

    await expect(Promise.resolve(service.requestEnable({ id: 'channel-a', actorId: 'user-a' }))).resolves.toMatchObject({ ok: true })
    // 启用前本来就会「先停自己再起」（既有行为），所以这里记下第一次之后「被停过谁」，
    // 判据是**启用第二条不再多停一条**。
    const stopsAfterFirst = runtime.stop.mock.calls.length
    await expect(Promise.resolve(service.requestEnable({ id: 'channel-b', actorId: 'user-a' }))).resolves.toMatchObject({ ok: true })

    expect(states(database)).toEqual([
      { id: 'channel-a', lifecycle_state: 'enabled', requested_enabled: 1 },
      { id: 'channel-b', lifecycle_state: 'enabled', requested_enabled: 1 }
    ])
    // 旧那条不再被停：第二条启用之后没有任何新的 stop 打在它身上，也没有「自动停用」审计。
    const laterStops = runtime.stop.mock.calls.slice(stopsAfterFirst).map((call) => String(call[0]))
    expect(laterStops).not.toContain('channel-a')
    expect(singleEnabledAudits(database)).toBe(0)
  })
})

describe('startup restores every channel whose intent survived, not just one', () => {
  it('brings both channels back and starts both runtimes', async () => {
    const { database, runtime, service } = harness()
    // 重启前的真实状态：启动围栏把代际作废、占用行释放、状态回 `ready`，开启意图还在。
    seededChannel(database, 'channel-a', 'telegram', 'ready', 1)
    seededChannel(database, 'channel-b', 'slack', 'ready', 1)
    database.connection.exec(`
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('channel-a',3,'inactive','2026-11-12T09:00:00.000Z'),('channel-b',5,'inactive','2026-11-12T09:30:00.000Z');
    `)

    await service.resumeRequested()

    expect(states(database)).toEqual([
      { id: 'channel-a', lifecycle_state: 'enabled', requested_enabled: 1 },
      { id: 'channel-b', lifecycle_state: 'enabled', requested_enabled: 1 }
    ])
    // 两条都真的起来了：不是库里两条、运行时只跑一条。
    const started = runtime.start.mock.calls.map((call) => String(call[0]))
    expect(started.sort()).toEqual(['channel-a', 'channel-b'])
    expect(singleEnabledAudits(database)).toBe(0)
  })

  it('leaves a channel that the retired rule disabled alone, even though it has the audit row', async () => {
    const { database, runtime, service } = harness()
    seededChannel(database, 'channel-a', 'telegram', 'ready', 1)
    database.connection.exec(`insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
      values('channel-a',3,'inactive','2026-11-12T09:00:00.000Z')`)
    // 旧规则把它静默停用过：意图已清、状态是停用，审计里留着当时那一行。
    seededChannel(database, 'channel-b', 'slack', 'disabled', 0)
    database.connection.prepare(
      `insert into channel_management_audits(id,channel_id,actor_id,action,code,summary_json,created_at)
       values('audit-1','channel-b','system','disable',null,?, '2026-11-12T08:00:00.000Z')`
    ).run(JSON.stringify({ auto: 'true', reason: 'single-channel-invariant' }))

    await service.resumeRequested()

    // 不自动打开：自动替读者改状态是另一回事（提示在后面的笔里做）。
    expect(states(database)).toEqual([
      { id: 'channel-a', lifecycle_state: 'enabled', requested_enabled: 1 },
      { id: 'channel-b', lifecycle_state: 'disabled', requested_enabled: 0 }
    ])
    expect(runtime.start.mock.calls.map((call) => String(call[0]))).toEqual(['channel-a'])
    // 旧审计行原样留着（不删、不改词、不回填）。
    expect(singleEnabledAudits(database)).toBe(1)
  })
})
