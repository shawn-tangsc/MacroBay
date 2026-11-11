import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { larkChannelSql, supportedChannelSql } from '../ChannelManagementPredicates'

const LARK_CHANNEL_C_SQL = larkChannelSql('c')
// 不能在模块加载时算死：支持判定里含进程内的「取证放行」（setChannelAcceptanceOverride），
// 算死的常量会让运行时这一侧永远判「未支持」，用户点启用必然失败。
const RUNTIME_CHANNEL_C_SQL = (): string => supportedChannelSql('c')

/** Lark runtime persistence is code-only metadata; events and provider identifiers remain encrypted C03 payload. */
export class LarkRuntimeRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  commitIfCurrent(channelId: string, generation: number, eventHash: string, now = new Date()): boolean {
    if (!eventHash || eventHash.length > 512) return false
    return this.database.transact(() => {
      const current = this.database.connection.prepare(
        `select 1 from channel_runtime_generations g join agent_channels c on c.id=g.channel_id join agent_entities a on a.id=c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active' and ${LARK_CHANNEL_C_SQL} and ${RUNTIME_CHANNEL_C_SQL()}
           and c.lifecycle_state='enabled' and c.requested_enabled=1`
      ).get(channelId, generation)
      if (!current) return false
      return this.database.connection.prepare(
        `insert into channel_lark_runtime_state(channel_id,generation,last_event_id_hash,updated_at) values(?,?,?,?)
         on conflict(channel_id) do update set generation=excluded.generation,last_event_id_hash=excluded.last_event_id_hash,updated_at=excluded.updated_at`
      ).run(channelId, generation, eventHash, now.toISOString()).changes === 1
    })
  }

  /**
   * 诊断专用：**不过授权闸门**写一行运行审计。
   *
   * `auditIfCurrent` 要求「现役代际 + enabled + requested_enabled=1」，启动失败/被踢的那一刻
   * 这些条件恰恰可能不成立——最需要证据时一条都留不下（QQ 那次就是 0 行）。
   * 只给启动诊断用；码里不含凭据、正文与 URL。
   */
  auditDiagnostic(channelId: string, code: string, now = new Date()): void {
    this.database.connection.prepare(
      'insert into channel_lark_runtime_audits(id,channel_id,code,created_at) values(?,?,?,?)'
    ).run(randomUUID(), channelId, code, now.toISOString())
  }

  auditIfCurrent(channelId: string, generation: number, code: string, now = new Date()): boolean {
    return this.database.connection.prepare(
      `insert into channel_lark_runtime_audits(id,channel_id,code,created_at) select ?,?,?,?
       where exists (select 1 from channel_runtime_generations g join agent_channels c on c.id=g.channel_id join agent_entities a on a.id=c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active' and ${LARK_CHANNEL_C_SQL} and ${RUNTIME_CHANNEL_C_SQL()}
           and c.lifecycle_state='enabled' and c.requested_enabled=1)`
    ).run(randomUUID(), channelId, code, now.toISOString(), channelId, generation).changes === 1
  }

  cleanupAudits(now = new Date(), limit = 500): number {
    return this.database.connection.prepare(
      `delete from channel_lark_runtime_audits where id in (
         select audit.id from channel_lark_runtime_audits audit
         where audit.created_at < ? or 5000 <= (
           select count(*) from channel_lark_runtime_audits newer
           where newer.channel_id=audit.channel_id and (newer.created_at > audit.created_at or (newer.created_at=audit.created_at and newer.id > audit.id))
         ) order by audit.created_at asc,audit.id asc limit ?
       )`
    ).run(new Date(now.getTime() - 30 * 86_400_000).toISOString(), Math.max(1, Math.min(limit, 500))).changes as number
  }
}
