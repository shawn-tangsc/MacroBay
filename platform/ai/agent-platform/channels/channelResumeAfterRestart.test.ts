import { describe, expect, it, vi } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'
import { seedChannelAdapterSupport } from './channelTestSupport'

/**
 * 重启恢复：靠「现场自检」启用的频道，重启后要自己回来（用户 2026-11-04 报的 bug）。
 *
 * 以前恢复链对 `runtime-ready` 的频道一律走 `restart()`，而 `restart()` **没有自检放行**——
 * 适配器在库里仍是 blocked，于是被「适配器不支持」直接拒；恢复链再按「确定性失败」把它停用，
 * `requested_enabled` 也清零，下一次连恢复候选都没有了。表现就是：**每次重启都要读者再点一次启用**。
 *
 * 修法：没声明支持的平台走「启用」那条路（它带自检放行）；自检没过属于瞬时失败，**保留开启意图**，
 * 下次启动再试，而不是把读者的意图清掉。
 */

function harness(options: { smokeOk: boolean }) {
  const database = createAgentPlatformDatabase(':memory:')
  // 六行全 blocked：这个用户是靠自检启用的。
  seedChannelAdapterSupport(database, [])
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,credential_ref,credential_revision,created_at,updated_at)
      values('channel-a','telegram','test','agent-a','{}',1,'enabled','configured','ref-a',2,'2026-11-04','2026-11-04');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
      values('channel-a',7,'inactive','2026-11-04T09:00:00.000Z');
  `)
  const repository = new ChannelManagementRepository(database)
  const runtime = { start: vi.fn(async () => true), stop: vi.fn() }
  const service = new ChannelManagementService({
    repository,
    vault: { inspectSafe: async (ref: string) => ({ credentialRef: ref, revision: 2, maskedFields: {} }) } as never,
    cipher: {} as never,
    registry: new ChannelAdapterAcceptanceRegistry(),
    acceptance: { isSupported: () => false },
    handoff: new ChannelSecureHandoff(),
    runtime,
    smoke: async () => (options.smokeOk ? { ok: true } : { ok: false, code: 'telegram-network-unavailable' }),
    now: () => new Date('2026-11-04T14:00:00.000Z')
  })
  return { database, runtime, service }
}

describe('resuming a channel that was enabled by the on-the-spot self-check', () => {
  it('brings it back without the reader clicking enable again', async () => {
    const { database, runtime, service } = harness({ smokeOk: true })

    await service.resumeRequested()

    expect(database.connection.prepare(
      'select lifecycle_state, requested_enabled from agent_channels where id = ?'
    ).get('channel-a')).toEqual({ lifecycle_state: 'enabled', requested_enabled: 1 })
    expect(runtime.start).toHaveBeenCalled()
    // 不许出现「恢复时把自己停用」的自伤审计。
    expect(database.connection.prepare(
      "select count(*) as count from channel_management_audits where action = 'disable'"
    ).get()).toEqual({ count: 0 })
  })

  it('keeps the intent when the self-check cannot pass at boot, instead of clearing it', async () => {
    const { database, service } = harness({ smokeOk: false })

    await service.resumeRequested()

    // 瞬时失败（网络没通）不该把读者的开启意图清掉：保留 requested_enabled，下次启动再试。
    expect(database.connection.prepare(
      'select requested_enabled from agent_channels where id = ?'
    ).get('channel-a')).toEqual({ requested_enabled: 1 })
    expect(database.connection.prepare(
      "select count(*) as count from channel_management_audits where action = 'disable'"
    ).get()).toEqual({ count: 0 })
    expect(database.connection.prepare(
      "select count(*) as count from channel_runtime_audits where code = 'channel-runtime-started'"
    ).get()).toEqual({ count: 0 })
  })
})
