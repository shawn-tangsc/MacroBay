import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { supportedChannelSql, wechatChannelSql } from '../ChannelManagementPredicates'

const WECHAT_CHANNEL_C_SQL = wechatChannelSql('c')
const RUNTIME_CHANNEL_C_SQL = supportedChannelSql('c')

/** Cursor/context state is deliberately inert until official iLink polling is frozen and independently evidenced. */
export class WechatRuntimeRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  commitIfCurrent(channelId: string, generation: number, cursor: string, now = new Date()): boolean {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) return false
    return this.database.transact(() => {
      const allowed = this.database.connection.prepare(
        `select 1 from channel_runtime_generations g join agent_channels c on c.id=g.channel_id join agent_entities a on a.id=c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active' and ${WECHAT_CHANNEL_C_SQL} and ${RUNTIME_CHANNEL_C_SQL}
           and c.migration_state='runtime-ready' and c.requested_enabled=1`
      ).get(channelId, generation)
      if (!allowed) return false
      return this.database.connection.prepare(
        `insert into channel_wechat_poll_state(channel_id,generation,next_cursor,context_ref,context_revision,updated_at) values(?,?,?,null,null,?)
         on conflict(channel_id) do update set generation=excluded.generation,
           next_cursor=case when excluded.generation<>channel_wechat_poll_state.generation then excluded.next_cursor else channel_wechat_poll_state.next_cursor end,
           context_ref=case when excluded.generation<>channel_wechat_poll_state.generation then null else channel_wechat_poll_state.context_ref end,
           context_revision=case when excluded.generation<>channel_wechat_poll_state.generation then null else channel_wechat_poll_state.context_revision end,
           updated_at=excluded.updated_at`
      ).run(channelId, generation, cursor, now.toISOString()).changes === 1
    })
  }

  auditIfCurrent(channelId: string, generation: number, code: string, now = new Date()): boolean {
    return this.database.connection.prepare(
      `insert into channel_wechat_runtime_audits(id,channel_id,code,created_at) select ?,?,?,?
       where exists (select 1 from channel_runtime_generations g join agent_channels c on c.id=g.channel_id join agent_entities a on a.id=c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active' and ${WECHAT_CHANNEL_C_SQL} and ${RUNTIME_CHANNEL_C_SQL}
           and c.migration_state='runtime-ready' and c.requested_enabled=1)`
    ).run(randomUUID(), channelId, code, now.toISOString(), channelId, generation).changes === 1
  }

  cleanupAudits(now = new Date(), limit = 500): number {
    return this.database.connection.prepare(
      `delete from channel_wechat_runtime_audits where id in (select audit.id from channel_wechat_runtime_audits audit
       where audit.created_at<? or 5000 <= (select count(*) from channel_wechat_runtime_audits newer where newer.channel_id=audit.channel_id and (newer.created_at>audit.created_at or (newer.created_at=audit.created_at and newer.id>audit.id)))
       order by audit.created_at asc,audit.id asc limit ?)`
    ).run(new Date(now.getTime() - 30 * 86_400_000).toISOString(), Math.max(1, Math.min(limit, 500))).changes as number
  }
}
