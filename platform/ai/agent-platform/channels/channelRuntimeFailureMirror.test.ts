import { describe, expect, it } from 'vitest'

import { createAgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { seedChannelAdapterSupport } from './channelTestSupport'
import { recordRuntimeLifecycle } from './channelRuntimeLifecycle'
import { CHANNEL_RUNTIME_AUDIT_KEEP, CHANNEL_RUNTIME_LIFECYCLE_KEEP } from './channelRuntimeAuditRetention'
import { TelegramOffsetRepository } from './telegram/TelegramOffsetRepository'

function readyDatabase() {
  const database = createAgentPlatformDatabase(':memory:')
  seedChannelAdapterSupport(database, ['telegram'])
  database.connection.exec(`
    insert into agent_entities(id,type,name,mcps_json,disabled_tools_json,order_key,created_at,updated_at)
      values('agent-a','custom','Agent','[]','[]','a','2026-11-04','2026-11-04');
    insert into agent_channels(id,adapter_key,name,agent_id,public_config_json,requested_enabled,lifecycle_state,credential_health,created_at,updated_at)
      values('channel-a','telegram','Telegram','agent-a','{}',1,'enabled','configured','2026-11-04','2026-11-04');
    insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at)
      values('channel-a',1,'active','2026-11-04');
  `)
  return database
}

/** 诊断表里每一条失败码，面板表都必须有同一频道、同一代际、同一时刻的一条。 */
function unmirroredFailures(database: ReturnType<typeof createAgentPlatformDatabase>): number {
  const row = database.connection.prepare(
    `select count(*) as count from channel_telegram_runtime_audits t
     where not exists (
       select 1 from channel_runtime_audits r
       where r.channel_id = t.channel_id and r.code = t.code and r.created_at = t.created_at
     )`
  ).get() as { count: number }
  return row.count
}

describe('runtime failure mirror', () => {
  it('mirrors a poll failure into the table the settings panel reads', () => {
    const database = readyDatabase()
    const offsets = new TelegramOffsetRepository(database)
    const now = new Date('2026-11-04T01:00:00.000Z')

    expect(offsets.auditIfCurrent('channel-a', 1, 'telegram-conflict', now)).toBe(true)

    expect(database.connection.prepare('select code, created_at from channel_telegram_runtime_audits').all()).toEqual([
      { code: 'telegram-conflict', created_at: now.toISOString() }
    ])
    const mirrored = database.connection.prepare(
      'select code, generation, created_at from channel_runtime_audits where channel_id = ?'
    ).all('channel-a') as Array<{ code: string; generation: number | null; created_at: string }>
    expect(mirrored).toEqual([{ code: 'telegram-conflict', generation: 1, created_at: now.toISOString() }])
    expect(unmirroredFailures(database)).toBe(0)
  })

  it('mirrors a bootstrap failure that has no generation yet', () => {
    const database = readyDatabase()
    const offsets = new TelegramOffsetRepository(database)
    const now = new Date('2026-11-04T01:05:00.000Z')
    offsets.auditBootstrapFenced('channel-a', 'telegram-runtime-start-failed', now)
    expect(database.connection.prepare('select code, generation from channel_runtime_audits').all()).toEqual([
      { code: 'telegram-runtime-start-failed', generation: null }
    ])
    expect(unmirroredFailures(database)).toBe(0)
  })

  it('fails the consistency guard when a diagnostic row has no mirror row', () => {
    const database = readyDatabase()
    // 故意只写诊断表：这条守卫如果抓不到，就等于没有守卫。
    database.connection.prepare(
      "insert into channel_telegram_runtime_audits(id, channel_id, code, created_at) values ('unmirrored','channel-a','telegram-conflict','2026-11-04T01:06:00.000Z')"
    ).run()
    expect(unmirroredFailures(database)).toBe(1)
  })

  it('keeps start/stop rows when a burst of failures floods the channel', () => {
    const database = readyDatabase()
    const offsets = new TelegramOffsetRepository(database)
    const start = new Date('2026-11-04T01:07:00.000Z')
    recordRuntimeLifecycle(database, 'channel-a', 'started', 1, start)

    for (let index = 0; index < CHANNEL_RUNTIME_AUDIT_KEEP + 20; index += 1) {
      offsets.auditIfCurrent('channel-a', 1, 'telegram-poll-failed', new Date(start.getTime() + 1_000 + index))
    }

    const lifecycle = database.connection.prepare(
      "select code from channel_runtime_audits where channel_id = 'channel-a' and code like 'channel-runtime-%'"
    ).all() as Array<{ code: string }>
    // 起停行有自己的额度：失败洪峰不会把「什么时候起过」挤掉。
    expect(lifecycle).toEqual([{ code: 'channel-runtime-started' }])

    const counts = database.connection.prepare(
      `select
         (select count(*) from channel_runtime_audits where channel_id='channel-a' and code not like 'channel-runtime-%') as failures,
         (select count(*) from channel_runtime_audits where channel_id='channel-a' and code like 'channel-runtime-%') as lifecycle`
    ).get() as { failures: number; lifecycle: number }
    expect(counts.failures).toBe(CHANNEL_RUNTIME_AUDIT_KEEP)
    expect(counts.lifecycle).toBeLessThanOrEqual(CHANNEL_RUNTIME_LIFECYCLE_KEEP)
  })
})
