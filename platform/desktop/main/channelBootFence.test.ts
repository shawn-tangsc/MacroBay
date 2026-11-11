import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChannelInboundRepository } from '../../ai/agent-platform/channels/ChannelInboundRepository'
import { ChannelInboundService } from '../../ai/agent-platform/channels/ChannelInboundService'
import { setChannelAcceptanceOverride } from '../../ai/agent-platform/channels/channelAcceptanceOverride'
import { createAgentPlatformDatabase } from '../../ai/agent-platform/db/createAgentPlatformDatabase'
import { bootChannelRuntimes } from './channelBootFence'

/**
 * 启动恢复必须补上「进程内放行」。
 *
 * 现场：QQ 的 socket 真的打开了（平台层 `PLATFORM_WS_OPENED`），但库里一条审计都没有、
 * 会话 0 行——因为运行时每一道闸门都读 `supportedChannelSql`（库里六家全是 blocked），
 * 而放行只在「用户当场点启用 → 自检通过」那一跳才建立；重启恢复直接 `runtime.start`，没有任何放行，
 * 于是每一帧都被 `current(socket)` 判掉。
 */

const CHANNEL_ID = 'qq-startup-restore'
const GENERATION = 29

function seed(generation: number): ReturnType<typeof createAgentPlatformDatabase> {
  const database = createAgentPlatformDatabase(':memory:')
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-11','2026-11-11');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
      values('${CHANNEL_ID}','qq','QQ','agent-a','{}',1,'enabled','configured','2026-11-11','2026-11-11');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
      values('${CHANNEL_ID}',${generation},'active','2026-11-11');
  `)
  // 注意：**不** seed `channel_adapter_support`——库里六家全是 blocked，正是现场的状态。
  return database
}

function bootDeps(database: ReturnType<typeof createAgentPlatformDatabase>, start = vi.fn(async () => true)) {
  return {
    active: [{ channelId: CHANNEL_ID, generation: GENERATION, token: 'owner-a' }],
    readType: () => 'qq' as const,
    canEnable: () => false,
    fenceKeepingIntent: () => undefined,
    disableGeneration: () => undefined,
    auditFenced: () => undefined,
    retainAcceptance: (type: string) => { setChannelAcceptanceOverride(type) },
    start,
    now: () => '2026-11-11T15:03:06.700Z'
  }
}

function cipher() {
  return {
    encrypt: async (_channelId: string, value: Uint8Array) => ({
      ciphertext: Uint8Array.from(value, (byte) => byte ^ 0xa5),
      keyRef: 'channel-payload-key:opaque',
      keyRevision: 1
    }),
    decrypt: async () => new Uint8Array(),
    keyedHash: async (_channelId: string, value: Uint8Array) => `hash:${Buffer.from(value).toString('base64url')}`,
    rotate: async () => ({ keyRef: 'channel-payload-key:opaque', keyRevision: 1 }),
    revoke: async () => undefined
  }
}

afterEach(() => {
  // 放行是进程内状态：用例之间必须还原，否则后面所有用例都「悄悄支持了 qq」。
  setChannelAcceptanceOverride(null)
})

describe('boot restore acceptance', () => {
  it('makes the restored generation current, so its frames are no longer judged stale', async () => {
    const database = seed(GENERATION)
    const inboundRepository = new ChannelInboundRepository(database)
    const start = vi.fn(async () => true)

    // 启动前：库里是 blocked，闸门必然判假（这就是现场「socket 开了、帧全被丢」）。
    expect(inboundRepository.isCurrentActive(CHANNEL_ID, GENERATION)).toBe(false)

    await bootChannelRuntimes(bootDeps(database, start))

    // 启动恢复补上放行之后，这一代就是「现役」：宿主那四道闸门不会再把它判掉。
    expect(inboundRepository.isCurrentActive(CHANNEL_ID, GENERATION)).toBe(true)
  })

})
