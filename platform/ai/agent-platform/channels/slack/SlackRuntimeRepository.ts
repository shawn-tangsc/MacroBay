import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { supportedChannelSql } from '../ChannelManagementPredicates'

const RUNTIME_CHANNEL_C_SQL = supportedChannelSql('c')

/** Metadata-only Socket Mode state: event bodies, thread keys and URLs never enter SQLite. */
export class SlackRuntimeRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  commitIfCurrent(channelId: string, generation: number, eventHash: string, cursor: string | null, now = new Date()): boolean {
    if (!eventHash || eventHash.length > 512 || (cursor !== null && cursor.length > 512)) return false
    return this.database.transact(() => {
      const current = this.database.connection.prepare(
        `select 1 from channel_runtime_generations g join agent_channels c on c.id=g.channel_id join agent_entities a on a.id=c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active' and c.adapter_key='slack' and ${RUNTIME_CHANNEL_C_SQL}
           and c.lifecycle_state='enabled' and c.requested_enabled=1`
      ).get(channelId, generation)
      if (!current) return false
      return this.database.connection.prepare(
        `insert into channel_slack_runtime_state(channel_id,generation,last_event_id_hash,reconnect_cursor,updated_at) values(?,?,?,?,?)
         on conflict(channel_id) do update set generation=excluded.generation,last_event_id_hash=excluded.last_event_id_hash,
           reconnect_cursor=excluded.reconnect_cursor,updated_at=excluded.updated_at`
      ).run(channelId, generation, eventHash, cursor, now.toISOString()).changes === 1
    })
  }

  /** Bootstrap-only terminal audit after the caller has fenced this channel; never a socket callback API. */
  auditBootstrapFenced(channelId: string, code: string, now = new Date()): void {
    this.database.connection.prepare(
      'insert into channel_slack_runtime_audits(id,channel_id,code,created_at) values(?,?,?,?)'
    ).run(randomUUID(), channelId, code, now.toISOString())
  }

  /** Runtime callbacks may record a code only while their exact Slack generation remains active. */
  auditIfCurrent(channelId: string, generation: number, code: string, now = new Date()): boolean {
    return this.database.connection.prepare(
      `insert into channel_slack_runtime_audits(id,channel_id,code,created_at)
       select ?,?,?,?
       where exists (
         select 1 from channel_runtime_generations g join agent_channels c on c.id = g.channel_id
         join agent_entities a on a.id = c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active'
           and c.adapter_key='slack' and ${RUNTIME_CHANNEL_C_SQL} and c.lifecycle_state='enabled' and c.requested_enabled=1
       )`
    ).run(randomUUID(), channelId, code, now.toISOString(), channelId, generation).changes === 1
  }

  remove(channelId: string): void { this.database.connection.prepare('delete from channel_slack_runtime_state where channel_id=?').run(channelId) }

  cleanupAudits(now = new Date(), limit = 500): number {
    return this.database.connection.prepare(
      `delete from channel_slack_runtime_audits where id in (
         select audit.id from channel_slack_runtime_audits audit
         where audit.created_at < ? or 5000 <= (
           select count(*) from channel_slack_runtime_audits newer
           where newer.channel_id = audit.channel_id and (
             newer.created_at > audit.created_at or (newer.created_at = audit.created_at and newer.id > audit.id)
           )
         ) order by audit.created_at asc,audit.id asc limit ?
       )`
    ).run(new Date(now.getTime() - 30 * 86_400_000).toISOString(), Math.max(1, Math.min(limit, 500))).changes as number
  }
}
