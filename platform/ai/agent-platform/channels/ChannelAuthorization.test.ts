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

  it('keeps the reader’s enable intent when boot fences a channel that has no acceptance evidence yet', () => {
    // 用户现场：Telegram/Discord 已实现、凭据可读、上次明明启用着，重启后变成 requested_enabled=0，
    // 简报只发到剩下的那条。启动围栏只许停运行时，不许替他取消启用。
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-11-11','2026-11-11');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
        values('telegram-a','telegram','Telegram','agent-a','{}',1,'enabled','configured','2026-11-11','2026-11-11');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('telegram-a',1,'active','2026-11-11');
    `)
    // 注意：**不** seed 验收证据——这正是「已实现但还没证据」的现场。
    const management = new ChannelManagementRepository(database)

    expect(management.fenceRuntimeGenerationKeepingIntent('telegram-a', '2026-11-11T13:28:16.564Z')).toBe(true)
    expect(database.connection.prepare("select requested_enabled,lifecycle_state,credential_health from agent_channels where id='telegram-a'").get()).toEqual({
      requested_enabled: 1,
      lifecycle_state: 'ready',
      credential_health: 'configured'
    })
    // 代际作废（运行时不再被认为在跑），但下一次启动仍然认得这份意图。
    expect(database.connection.prepare("select lifecycle_state from channel_runtime_generations where channel_id='telegram-a'").get()).toEqual({ lifecycle_state: 'inactive' })
    expect(management.resumableChannelIds()).toEqual(['telegram-a'])
  })

  it('drops the lifecycle owner when boot fences a runtime, so the next enable can take it', () => {
    // 死锁现场：围栏只作废代际、不删占用行 → 下一次启用被自己那条旧锁挡住，界面只报「连接没能起来」。
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-11-11','2026-11-11');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
        values('telegram-a','telegram','Telegram','agent-a','{}',1,'enabled','configured','2026-11-11','2026-11-11');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('telegram-a',32,'active','2026-11-11');
      insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at)
        values('telegram-a','owner-stale','enable',32,'2026-11-11','2026-11-11');
    `)
    const management = new ChannelManagementRepository(database)

    management.fenceRuntimeGenerationKeepingIntent('telegram-a', '2026-11-11T13:28:16.564Z')

    expect(database.connection.prepare('select count(*) as count from channel_telegram_lifecycle_operations').get()).toEqual({ count: 0 })
    // 释放之后，下一次启用立刻拿得到占用权（不需要重启、不需要人工清库）。
    expect(management.beginLifecycleOwner('telegram-a', 'enable', 'owner-next', '2026-11-11T13:50:00.000Z')).not.toBeNull()
  })

  it('releases the lifecycle owner of a channel displaced by the single-channel invariant', async () => {
    // 现场：启用 Telegram 把 Slack/Discord 挤出后，那两条各自留着一条 purpose=enable 的占用行，
    // 于是它们**永远**再启不起来（每条频道各锁自己）。
    const database = createAgentPlatformDatabase(':memory:')
    database.connection.exec(`
      insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
        values('agent-a','custom','Agent','[]','[]','a','2026-11-11','2026-11-11');
      insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
        values('telegram-a','telegram','Telegram','agent-a','{}',1,'enabled','configured','2026-11-11','2026-11-11'),
              ('slack-a','slack','Slack','agent-a','{}',1,'enabled','configured','2026-11-11','2026-11-11');
      insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
        values('telegram-a',5,'active','2026-11-11T13:41:10.000Z'),('slack-a',3,'active','2026-11-11T13:30:01.000Z');
      insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at)
        values('telegram-a','owner-tg','enable',5,'2026-11-11','2026-11-11'),
              ('slack-a','owner-slack','enable',3,'2026-11-11','2026-11-11');
    `)
    const { reconcileSingleEnabledChannel } = await import('./singleEnabledChannel')
    const management = new ChannelManagementRepository(database)

    // Telegram 最近启用 → 留下它，Slack 被挤出。
    expect(reconcileSingleEnabledChannel(database, '2026-11-11T13:41:10.000Z').disabled.map((row) => row.id)).toEqual(['slack-a'])
    expect(database.connection.prepare("select count(*) as count from channel_telegram_lifecycle_operations where channel_id='slack-a'").get()).toEqual({ count: 0 })
    // Slack 现在是一条普通「未启用」频道：下一次启用必须拿得到占用权。
    expect(management.beginLifecycleOwner('slack-a', 'enable', 'owner-retry', '2026-11-11T13:50:00.000Z')).not.toBeNull()
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
