import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { ChannelManagementService } from './ChannelManagementService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'

/**
 * 「这条通道能不能当推送目标」的判据（用户 2026-11-04 的教训）。
 *
 * 以前第一档是「适配器 supported」——于是 `channel_adapter_support.telegram = blocked` 时，
 * 一条**已经在跑、凭据可用、目标已绑**的通道在通知页里显示「适配器不支持」，手机推送永远选不到它。
 * 这跟启用那条是同一个病：**内部验收（七项真机证据）被当成了用户能不能用的门槛**。
 *
 * 现在的判据只有三档：凭据 → 是否在运行 → 目标绑没绑；`supported` 只决定「对外是否声明支持」。
 */

function seed(options: { lifecycle: string; credentialHealth: string; withTarget: boolean }) {
  const database = createAgentPlatformDatabase(':memory:')
  // 六行全 blocked：一条真机证据都没有。
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,credential_ref,credential_revision,created_at,updated_at)
      values('channel-a','telegram','test','agent-a','{}',1,'${options.lifecycle}','${options.credentialHealth}','ref-a',2,'2026-11-04','2026-11-04');
    insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at)
      values('conversation-a','channel-a',x'01','ref',1,'hash','direct','session-a','2026-11-04','2026-11-04');
  `)
  if (options.withTarget) {
    database.connection.exec(`
      insert into channel_delivery_targets(id,channel_id,conversation_id,enabled,created_at,updated_at)
        values('target-a','channel-a','conversation-a',1,'2026-11-04','2026-11-04');
    `)
  }
  const service = new ChannelManagementService({
    repository: new ChannelManagementRepository(database),
    vault: {} as never,
    cipher: {} as never,
    registry: new ChannelAdapterAcceptanceRegistry(),
    handoff: new ChannelSecureHandoff(),
    now: () => new Date('2026-11-04T09:30:00.000Z')
  })
  return service
}

describe('delivery target availability without any acceptance evidence', () => {
  it('is available when the channel is running, the credential is usable and a target is bound', () => {
    const service = seed({ lifecycle: 'enabled', credentialHealth: 'configured', withTarget: true })

    expect(service.listDeliveryTargets().channels).toEqual([
      { id: 'channel-a', name: 'test', deliverable: true, reason: null, target: { kind: 'bound', conversationKind: 'direct' } }
    ])
  })

  it('names the three real blockers instead of blaming the adapter', () => {
    expect(seed({ lifecycle: 'disabled', credentialHealth: 'configured', withTarget: true }).listDeliveryTargets().channels[0]).toMatchObject({
      deliverable: false, reason: 'not-enabled'
    })
    expect(seed({ lifecycle: 'enabled', credentialHealth: 'configured', withTarget: false }).listDeliveryTargets().channels[0]).toMatchObject({
      deliverable: false, reason: 'no-enabled-target'
    })
    expect(seed({ lifecycle: 'enabled', credentialHealth: 'unavailable', withTarget: true }).listDeliveryTargets().channels[0]).toMatchObject({
      deliverable: false, reason: 'credential-missing'
    })
  })

  it('never reports adapter-not-supported for a blocked adapter any more', () => {
    // 六行 blocked 的库里，任何一条通道都不该再因为「适配器没通过真机验收」被挡在投递之外。
    const reasons = [
      seed({ lifecycle: 'enabled', credentialHealth: 'configured', withTarget: true }),
      seed({ lifecycle: 'disabled', credentialHealth: 'configured', withTarget: false })
    ].map((service) => service.listDeliveryTargets().channels[0].reason)
    expect(reasons).not.toContain('adapter-not-supported')
  })
})
