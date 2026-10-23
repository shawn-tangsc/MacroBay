import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { runtimeAuthorizedChannelSql } from '../ChannelManagementPredicates'

const RUNTIME_CHANNEL_C_SQL = runtimeAuthorizedChannelSql('c')

/** Metadata-only polling cursor. It never stores a Telegram update body or token. */
export class TelegramOffsetRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  get(channelId: string): number {
    const row = this.database.connection.prepare(
      'select next_update_id from channel_telegram_offsets where channel_id = ?'
    ).get(channelId) as { next_update_id: number } | undefined
    return row?.next_update_id ?? 0
  }

  commitIfCurrent(channelId: string, generation: number, nextUpdateId: number, now = new Date()): boolean {
    if (!Number.isSafeInteger(nextUpdateId) || nextUpdateId < 0) return false
    return this.database.transact(() => {
      const current = this.database.connection.prepare(
        `select 1 from channel_runtime_generations g join agent_channels c on c.id = g.channel_id
         join agent_entities a on a.id = c.agent_id
         where g.channel_id = ? and g.generation = ? and g.lifecycle_state = 'active'
           and c.type = 'telegram' and ${RUNTIME_CHANNEL_C_SQL}
           and c.migration_state = 'runtime-ready' and c.requested_enabled = 1`
      ).get(channelId, generation)
      if (!current) return false
      const previous = this.get(channelId)
      if (nextUpdateId < previous) return false
      if (nextUpdateId === previous) return true
      return this.database.connection.prepare(
        `insert into channel_telegram_offsets(channel_id, next_update_id, updated_at) values (?, ?, ?)
         on conflict(channel_id) do update set next_update_id = excluded.next_update_id, updated_at = excluded.updated_at
         where excluded.next_update_id > channel_telegram_offsets.next_update_id`
      ).run(channelId, nextUpdateId, now.toISOString()).changes === 1
    })
  }

  remove(channelId: string): void {
    this.database.connection.prepare('delete from channel_telegram_offsets where channel_id = ?').run(channelId)
  }

  /** Bootstrap-only terminal audit after the caller has fenced this channel; poll callbacks use auditIfCurrent. */
  auditBootstrapFenced(channelId: string, code: string, now = new Date()): void {
    this.database.connection.prepare(
      'insert into channel_telegram_runtime_audits(id, channel_id, code, created_at) values (?, ?, ?, ?)'
    ).run(randomUUID(), channelId, code, now.toISOString())
  }

  /** Poll callbacks write audit metadata only while their exact Telegram runtime remains active. */
  auditIfCurrent(channelId: string, generation: number, code: string, now = new Date()): boolean {
    return this.database.connection.prepare(
      `insert into channel_telegram_runtime_audits(id,channel_id,code,created_at) select ?,?,?,?
       where exists (select 1 from channel_runtime_generations g join agent_channels c on c.id=g.channel_id join agent_entities a on a.id=c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active'
           and c.type='telegram' and ${RUNTIME_CHANNEL_C_SQL}
           and c.migration_state='runtime-ready' and c.requested_enabled=1)`
    ).run(randomUUID(), channelId, code, now.toISOString(), channelId, generation).changes === 1
  }

  /** Terminal metadata audit retention: one bounded page, never part of a poll hot path. */
  cleanupAudits(now = new Date(), limit = 500): number {
    return this.database.connection.prepare(
      `delete from channel_telegram_runtime_audits where id in (
         select id from channel_telegram_runtime_audits where created_at < ? or id in (
           select id from channel_telegram_runtime_audits order by created_at desc, id desc limit -1 offset 10000
         ) order by created_at asc, id asc limit ?
       )`
    ).run(new Date(now.getTime() - 30 * 86_400_000).toISOString(), Math.max(1, Math.min(limit, 500))).changes as number
  }
}
