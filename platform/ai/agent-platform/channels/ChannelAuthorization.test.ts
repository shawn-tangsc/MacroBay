import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'
import { ChannelInboundRepository } from './ChannelInboundRepository'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { seedChannelAdapterSupport } from './channelTestSupport'

describe('channel runtime authorization', () => {
  it('opens inbound and delivery only through adapter support, not an adapter name', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-10-24','2026-10-24');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
        values('slack-a','slack','Slack','agent-a','{}',1,'enabled','configured','2026-10-24','2026-10-24');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('slack-a',1,'active','2026-10-24');
      insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at)
        values('conversation-a','slack-a',x'01','ref',1,'hash-a','direct','session-a','2026-10-24','2026-10-24');
      insert into channel_delivery_targets(id,channel_id,conversation_id,enabled,created_at,updated_at)
        values('target-a','slack-a','conversation-a',1,'2026-10-24','2026-10-24');
    `)
    const inbound = new ChannelInboundRepository(database)
    const delivery = new ChannelDeliveryRepository(database)

    expect(inbound.getCurrentAgentId('slack-a', 1)).toBeNull()
    expect(inbound.isCurrentActive('slack-a', 1)).toBe(false)
    expect(delivery.listEnabledTargets('slack-a', 'agent-a')).toEqual([])

    seedChannelAdapterSupport(database, ['slack'])

    expect(inbound.getCurrentAgentId('slack-a', 1)).toBe('agent-a')
    expect(inbound.isCurrentActive('slack-a', 1)).toBe(true)
    expect(delivery.listEnabledTargets('slack-a', 'agent-a')).toEqual([{ conversationId: 'conversation-a' }])
  })

  it('preserves channel intent on quit and reports it as resumable on the next boot', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-10-24','2026-10-24');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
        values('telegram-a','telegram','Telegram','agent-a','{}',1,'enabled','configured','2026-10-24','2026-10-24');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('telegram-a',1,'active','2026-10-24');
      insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at)
        values('telegram-a','owner-a','enable',1,'2026-10-24','2026-10-24');
    `)
    seedChannelAdapterSupport(database, ['telegram'])
    const management = new ChannelManagementRepository(database)
    expect(management.fenceAllForQuit('2026-10-24T00:01:00.000Z')).toContain('telegram-a')
    expect(database.connection.prepare("select requested_enabled,lifecycle_state from agent_channels where id='telegram-a'").get()).toEqual({
      requested_enabled: 1, lifecycle_state: 'enabled'
    })
    expect(database.connection.prepare("select generation,lifecycle_state from channel_runtime_generations where channel_id='telegram-a'").get()).toEqual({
      generation: 2, lifecycle_state: 'inactive'
    })
    expect(management.resumableChannelIds()).toEqual(['telegram-a'])
  })

  it('maps the Lark storage carrier to the lark support key', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-10-24','2026-10-24');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
        values('lark-a','lark','Lark','agent-a','{"domain":"lark"}',1,'enabled','configured','2026-10-24','2026-10-24');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('lark-a',1,'active','2026-10-24');
    `)
    const inbound = new ChannelInboundRepository(database)
    expect(inbound.isCurrentActive('lark-a', 1)).toBe(false)
    seedChannelAdapterSupport(database, ['lark'])
    expect(inbound.isCurrentActive('lark-a', 1)).toBe(true)
  })
})
