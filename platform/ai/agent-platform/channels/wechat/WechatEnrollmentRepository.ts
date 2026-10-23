import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../../db/createAgentPlatformDatabase'
import { wechatChannelSql } from '../ChannelManagementPredicates'

const WECHAT_CHANNEL_C_SQL = wechatChannelSql('c')
const WECHAT_MUTABLE_C_SQL = `${WECHAT_CHANNEL_C_SQL} and c.migration_state not in ('legacy','quarantined','deleting') and not exists (select 1 from channel_management_tombstones t where t.channel_id=c.id)`

export type WechatQrEnrollmentSafeView = { operationId: string; state: 'pending' | 'expired' | 'cancelled'; expiresAt: string }

/** Main-process journal deliberately stores no QR payload, context value, token, or file path. */
export class WechatEnrollmentRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  begin(channelId: string, ttlMs = 5 * 60_000, now = new Date()): WechatQrEnrollmentSafeView | null {
    const expiresAt = new Date(now.getTime() + Math.max(1_000, Math.min(ttlMs, 15 * 60_000))).toISOString()
    const operationId = randomUUID()
    return this.database.transact(() => {
      const allowed = this.database.connection.prepare(
        `select 1 from agent_channels c join agent_entities a on a.id=c.agent_id
         where c.id=? and ${WECHAT_MUTABLE_C_SQL}`
      ).get(channelId)
      if (!allowed) return null
      this.database.connection.prepare(
        `update channel_wechat_qr_enrollments set state='cancelled',updated_at=?
         where channel_id=? and state='pending'`
      ).run(now.toISOString(), channelId)
      this.database.connection.prepare(
        `insert into channel_wechat_qr_enrollments(operation_id,channel_id,state,context_ref,context_revision,expires_at,updated_at)
         values(?,?,'pending',null,null,?,?)`
      ).run(operationId, channelId, expiresAt, now.toISOString())
      return { operationId, state: 'pending' as const, expiresAt }
    })
  }

  status(channelId: string, now = new Date()): WechatQrEnrollmentSafeView | null {
    if (!this.isStrictCarrier(channelId)) return null
    this.expire(now)
    const row = this.database.connection.prepare(
      `select e.operation_id,e.state,e.expires_at from channel_wechat_qr_enrollments e
       join agent_channels c on c.id=e.channel_id join agent_entities a on a.id=c.agent_id
       where e.channel_id=? and ${WECHAT_MUTABLE_C_SQL} order by e.updated_at desc,e.operation_id desc limit 1`
    ).get(channelId) as { operation_id: string; state: 'pending' | 'expired' | 'cancelled'; expires_at: string } | undefined
    return row ? { operationId: row.operation_id, state: row.state, expiresAt: row.expires_at } : null
  }

  cancel(channelId: string, operationId: string, now = new Date()): boolean {
    if (!this.isStrictCarrier(channelId)) return false
    return this.database.connection.prepare(
      `update channel_wechat_qr_enrollments set state='cancelled',updated_at=?
       where channel_id=? and operation_id=? and state='pending' and expires_at>?
         and exists (select 1 from agent_channels c join agent_entities a on a.id=c.agent_id
           where c.id=channel_wechat_qr_enrollments.channel_id and ${WECHAT_MUTABLE_C_SQL})`
    ).run(now.toISOString(), channelId, operationId, now.toISOString()).changes === 1
  }

  expire(now = new Date(), limit = 500): number {
    return this.database.connection.prepare(
      `update channel_wechat_qr_enrollments set state='expired',updated_at=?
       where operation_id in (
         select e.operation_id from channel_wechat_qr_enrollments e
         join agent_channels c on c.id=e.channel_id join agent_entities a on a.id=c.agent_id
         where e.state='pending' and e.expires_at<=? and ${WECHAT_MUTABLE_C_SQL}
         order by e.expires_at asc,e.operation_id asc limit ?
       )`
    ).run(now.toISOString(), now.toISOString(), Math.max(1, Math.min(limit, 500))).changes as number
  }

  /** Terminal QR journals are retained for 24 hours, then removed in bounded maintenance pages. */
  cleanupTerminal(now = new Date(), limit = 500): number {
    const cutoff = new Date(now.getTime() - 24 * 60 * 60_000).toISOString()
    return this.database.connection.prepare(
      `delete from channel_wechat_qr_enrollments where operation_id in (
         select e.operation_id from channel_wechat_qr_enrollments e
         join agent_channels c on c.id=e.channel_id join agent_entities a on a.id=c.agent_id
         where e.state in ('cancelled','expired') and e.updated_at < ? and ${WECHAT_MUTABLE_C_SQL}
         order by e.updated_at asc,e.operation_id asc limit ?
       )`
    ).run(cutoff, Math.max(1, Math.min(limit, 500))).changes as number
  }

  private isStrictCarrier(channelId: string): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from agent_channels c join agent_entities a on a.id=c.agent_id
       where c.id=? and ${WECHAT_MUTABLE_C_SQL}`
    ).get(channelId))
  }
}
