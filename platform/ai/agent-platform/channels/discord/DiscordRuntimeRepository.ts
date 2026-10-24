import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { discordChannelSql, supportedChannelSql } from '../ChannelManagementPredicates'

const DISCORD_CHANNEL_C_SQL = discordChannelSql('c')
const RUNTIME_CHANNEL_C_SQL = supportedChannelSql('c')

/** State transition only; authorization remains inside DiscordRuntimeRepository.commitIfCurrent. */
export function discordGatewayStateUpsertSql(): string {
  return `insert into channel_discord_gateway_state(channel_id,generation,last_sequence,session_ref,session_revision,updated_at) values(?,?,?,null,null,?)
    on conflict(channel_id) do update set generation=excluded.generation,
      last_sequence=case
        when excluded.generation <> channel_discord_gateway_state.generation then excluded.last_sequence
        when excluded.last_sequence > channel_discord_gateway_state.last_sequence then excluded.last_sequence
        else channel_discord_gateway_state.last_sequence
      end,
      session_ref=case when excluded.generation <> channel_discord_gateway_state.generation then null else channel_discord_gateway_state.session_ref end,
      session_revision=case when excluded.generation <> channel_discord_gateway_state.generation then null else channel_discord_gateway_state.session_revision end,
      updated_at=excluded.updated_at`
}

/** Discord runtime persistence contains bounded sequence metadata and stable codes only. */
export class DiscordRuntimeRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  commitIfCurrent(channelId: string, generation: number, sequence: number, now = new Date()): boolean {
    if (!Number.isSafeInteger(sequence) || sequence < 0) return false
    return this.database.transact(() => {
      const current = this.database.connection.prepare(
        `select 1 from channel_runtime_generations g join agent_channels c on c.id=g.channel_id join agent_entities a on a.id=c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active' and ${DISCORD_CHANNEL_C_SQL} and ${RUNTIME_CHANNEL_C_SQL}
           and c.migration_state='runtime-ready' and c.requested_enabled=1`
      ).get(channelId, generation)
      if (!current) return false
      return this.database.connection.prepare(discordGatewayStateUpsertSql()).run(channelId, generation, sequence, now.toISOString()).changes === 1
    })
  }

  auditIfCurrent(channelId: string, generation: number, code: string, now = new Date()): boolean {
    return this.database.connection.prepare(
      `insert into channel_discord_runtime_audits(id,channel_id,code,created_at) select ?,?,?,?
       where exists (select 1 from channel_runtime_generations g join agent_channels c on c.id=g.channel_id join agent_entities a on a.id=c.agent_id
         where g.channel_id=? and g.generation=? and g.lifecycle_state='active' and ${DISCORD_CHANNEL_C_SQL} and ${RUNTIME_CHANNEL_C_SQL}
           and c.migration_state='runtime-ready' and c.requested_enabled=1)`
    ).run(randomUUID(), channelId, code, now.toISOString(), channelId, generation).changes === 1
  }

  cleanupAudits(now = new Date(), limit = 500): number {
    return this.database.connection.prepare(
      `delete from channel_discord_runtime_audits where id in (
         select audit.id from channel_discord_runtime_audits audit
         where audit.created_at < ? or 5000 <= (
           select count(*) from channel_discord_runtime_audits newer
           where newer.channel_id=audit.channel_id and (newer.created_at > audit.created_at or (newer.created_at=audit.created_at and newer.id > audit.id))
         ) order by audit.created_at asc,audit.id asc limit ?
       )`
    ).run(new Date(now.getTime() - 30 * 86_400_000).toISOString(), Math.max(1, Math.min(limit, 500))).changes as number
  }
}
