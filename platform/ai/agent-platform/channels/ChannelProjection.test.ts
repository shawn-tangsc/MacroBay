import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { ChannelInboundRepository } from './ChannelInboundRepository'
import { seedChannelAdapterSupport } from './channelTestSupport'

describe('channel adapter projection', () => {
  it('projects carrier types and lifecycle values without rewriting legacy rows', () => {
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-10-24','2026-10-24');
      insert into agent_channels(id,type,name,agent_id,public_config_json,requested_enabled,migration_state,credential_health,created_at,updated_at) values
        ('telegram-a','telegram','Telegram','agent-a','{}',1,'runtime-ready','configured','2026-10-24','2026-10-24'),
        ('lark-a','feishu','Lark','agent-a','{"domain":"lark"}',1,'runtime-ready','configured','2026-10-24','2026-10-24'),
        ('legacy-feishu','feishu','Legacy','agent-a','{}',1,'runtime-ready','configured','2026-10-24','2026-10-24');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values
        ('telegram-a',1,'active','2026-10-24'),('lark-a',1,'active','2026-10-24');
    `)

    expect(database.connection.prepare(
      "select id,adapter_key,lifecycle_state from agent_channels order by id"
    ).all()).toEqual([
      { id: 'lark-a', adapter_key: 'lark', lifecycle_state: 'enabled' },
      { id: 'legacy-feishu', adapter_key: 'lark', lifecycle_state: 'enabled' },
      { id: 'telegram-a', adapter_key: 'telegram', lifecycle_state: 'enabled' }
    ])

    seedChannelAdapterSupport(database, ['telegram', 'lark'])
    const inbound = new ChannelInboundRepository(database)
    expect(inbound.isCurrentActive('telegram-a', 1)).toBe(true)
    expect(inbound.isCurrentActive('lark-a', 1)).toBe(true)
    // The isolated Feishu carrier must never become runnable through the lark projection.
    expect(inbound.isCurrentActive('legacy-feishu', 1)).toBe(false)
  })
})
