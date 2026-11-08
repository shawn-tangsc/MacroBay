import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { autoBindDeliveryTarget } from './channelAutoTargetBinding'
import { channelConversationTitle } from './channelConversationName'
import { resolveDeliveryTarget, type ChannelTargetView } from './channelDeliveryTargetResolution'
import { seedChannelAdapterSupport } from './channelTestSupport'

/**
 * 会话归属与目标自动登记（用户 2026-11-04 的两条要求）。
 *
 * - 会话名要认得出「哪个平台、哪个人」，平台名只从目录表取；
 * - 读者没有显式绑定时，**跟这条通道说过话的对话就是目标**，不许让他去点一个界面上不存在的入口。
 */

function seed(options: { withTarget: boolean }) {
  const database = createAgentPlatformDatabase(':memory:')
  seedChannelAdapterSupport(database, ['telegram'])
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
      values('channel-a','telegram','test','agent-a','{}',1,'enabled','configured','2026-11-04','2026-11-04');
    insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at)
      values('conversation-old','channel-a',x'01','ref',1,'hash-old','direct','session-1','2026-11-04T09:00:00.000Z','2026-11-04T09:00:00.000Z');
    insert into channel_conversations(id,channel_id,conversation_key_ciphertext,conversation_key_ref,conversation_key_revision,conversation_key_hash,conversation_kind,agent_session_id,created_at,updated_at)
      values('conversation-new','channel-a',x'01','ref',1,'hash-new','direct','session-2','2026-11-04T09:10:00.000Z','2026-11-04T09:10:00.000Z');
  `)
  if (options.withTarget) {
    database.connection.exec(`
      insert into channel_delivery_targets(id,channel_id,conversation_id,enabled,created_at,updated_at)
        values('target-a','channel-a','conversation-old',1,'2026-11-04T09:00:00.000Z','2026-11-04T09:00:00.000Z');
    `)
  }
  return database
}

describe('conversation title', () => {
  it('names the platform from the directory table, with a human discriminator', () => {
    expect(channelConversationTitle({ adapter: 'telegram', language: 'zh-CN', providerConversationKey: 'telegram:chat:8814', disambiguate: false }))
      .toBe('Telegram 对话')
    expect(channelConversationTitle({
      adapter: 'telegram', language: 'zh-CN', displayLabel: '贾维斯', providerConversationKey: 'telegram:chat:8814', disambiguate: true
    })).toBe('Telegram · 贾维斯')
    // 拿不到显示名就用 id 后四位，**不用整串 id** 当名字。
    expect(channelConversationTitle({ adapter: 'telegram', language: 'zh-CN', providerConversationKey: 'telegram:chat:8814628768', disambiguate: true }))
      .toBe('Telegram · 8768')
    expect(channelConversationTitle({ adapter: 'qq', language: 'en-US', displayLabel: 'Tang', providerConversationKey: 'qq:10001', disambiguate: true }))
      .toBe('QQ · Tang')
    expect(channelConversationTitle({ adapter: 'wechat', language: 'en-US', providerConversationKey: 'wechat:wxid_x', disambiguate: false }))
      .toBe('WeChat conversation')
  })
})

describe('delivery target resolution without an explicit binding', () => {
  const view = (database: ReturnType<typeof createAgentPlatformDatabase>): ChannelTargetView => ({
    list: () => [{
      id: 'channel-a', name: 'test', type: 'telegram', agentId: 'agent-a', state: 'runtime-ready',
      credential: { status: 'configured', hasCredential: true, revision: 2, maskedFields: {} }
    } as never],
    listDeliveryTargets: () => ({
      channels: [{ id: 'channel-a', name: 'test', deliverable: true, reason: null, target: { kind: 'bound', conversationKind: 'direct' } }] as never
    }),
    listConversations: ({ limit = 50 }) => (database.connection.prepare(
      `select c.id as id, c.conversation_kind as kind, c.agent_session_id as agent_session_id,
              c.session_title as session_title, coalesce(t.enabled,0) as target_enabled, c.created_at as created_at
       from channel_conversations c left join channel_delivery_targets t on t.conversation_id = c.id and t.channel_id = c.channel_id
       where c.channel_id = 'channel-a' order by c.created_at desc limit ?`
    ).all(limit) as Array<{ id: string; kind: 'direct'; agent_session_id: string | null; session_title: string | null; target_enabled: number; created_at: string }>).map((row) => ({
      id: row.id, kind: row.kind, hasBoundSession: Boolean(row.agent_session_id), targetEnabled: Boolean(row.target_enabled),
      sessionTitle: row.session_title, createdAt: row.created_at
    }))
  })

  it('refuses to guess among several conversations: the same rule for push and for the test message', () => {
    // 兜底（按「最近活跃」挑一条）**已删除**（技术方案 §1）：测试消息和真实推送同一条规则，
    // 猜出来的成功会把「真实推不出去」显示成「测试通过」。
    const database = seed({ withTarget: false })
    expect(resolveDeliveryTarget(view(database), 'channel-a')).toMatchObject({ ok: false, reason: 'no-target' })
  })

  it('uses the explicit binding when there is one', () => {
    const database = seed({ withTarget: true })
    expect(resolveDeliveryTarget(view(database), 'channel-a'))
      .toMatchObject({ ok: true, conversationId: 'conversation-old', source: 'bound' })
  })
})

describe('automatic target binding', () => {
  it('binds the first conversation that talks to the channel and audits it', () => {
    const database = seed({ withTarget: false })
    expect(autoBindDeliveryTarget(database, { channelId: 'channel-a', conversationId: 'conversation-new' })).toBe(true)
    expect(database.connection.prepare('select conversation_id, enabled from channel_delivery_targets').all()).toEqual([
      { conversation_id: 'conversation-new', enabled: 1 }
    ])
    const audit = database.connection.prepare(
      "select actor_id, action, summary_json from channel_management_audits where action = 'target-set'"
    ).get() as { actor_id: string; summary_json: string }
    expect(audit.actor_id).toBe('channel-auto-bind')
    expect(JSON.parse(audit.summary_json)).toEqual({ auto: 'true' })
  })

  it('never overrides a target the reader already set', () => {
    const database = seed({ withTarget: true })
    expect(autoBindDeliveryTarget(database, { channelId: 'channel-a', conversationId: 'conversation-new' })).toBe(false)
    expect(database.connection.prepare('select conversation_id from channel_delivery_targets').all()).toEqual([
      { conversation_id: 'conversation-old' }
    ])
  })
})
