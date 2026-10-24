import { createHash, randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { supportedChannelSql } from './ChannelManagementPredicates'
import type { ChannelDeliveryAttemptView, ChannelDeliverySource, ChannelDeliveryStatus, ChannelDeliveryAuditView } from './ChannelDeliveryContracts'
import type { ChannelExecutionClaim } from './ChannelInboundContracts'

const SUPPORTED_CHANNEL_C_SQL = supportedChannelSql('c')

export type DeliveryAttempt = {
  id: string
  channelId: string
  agentId: string
  conversationId: string
  source: ChannelDeliverySource
  sourceHash: string
  idempotencyKey: string
  status: ChannelDeliveryStatus
}

// This opaque owner is deliberately separate from inbound execution ownership.
export type ChannelDeliverySendOwner = {
  attemptId: string
  token: string
  revision: number
  leaseExpiresAt: string
}

export class ChannelDeliveryRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  claim(input: ClaimInput): DeliveryAttempt | null {
    return this.database.transact(() => {
      if (!this.isAuthorized(input)) return null
      const sourceHash = hash(input.sourceId)
      const existing = this.database.connection.prepare(
        `select id, channel_id, agent_id, conversation_id, source_type, source_hash, idempotency_key, status
         from channel_delivery_attempts where channel_id = ? and conversation_id = ? and source_type = ? and source_hash = ?`
      ).get(input.channelId, input.conversationId, input.source, sourceHash) as AttemptRow | undefined
      if (existing) return mapAttempt(existing)
      const attempt: DeliveryAttempt = {
        id: randomUUID(), channelId: input.channelId, agentId: input.agentId, conversationId: input.conversationId,
        source: input.source, sourceHash, idempotencyKey: `channel-delivery:${randomUUID()}`, status: 'pending'
      }
      this.database.connection.prepare(
        `insert into channel_delivery_attempts (id, channel_id, agent_id, conversation_id, source_type, source_hash, source_id, idempotency_key, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      ).run(attempt.id, attempt.channelId, attempt.agentId, attempt.conversationId, attempt.source, attempt.sourceHash, input.sourceId, attempt.idempotencyKey, input.now.toISOString(), input.now.toISOString())
      return attempt
    })
  }

  // This is the final transport admission. It rechecks every authorization condition in the
  // same transaction that consumes the pending/unknown attempt and assigns a send lease.
  beginSend(input: { attempt: DeliveryAttempt; retryUnknown: boolean; executionClaim?: ChannelExecutionClaim; now: Date; leaseMs?: number }): ChannelDeliverySendOwner | null {
    return this.database.transact(() => {
      // An interrupted owner can only become retryable as an explicit unknown outcome.
      // It is never silently considered delivered or returned to a second sender.
      this.database.connection.prepare(
        `update channel_delivery_attempts set status = 'unknown-after-send', send_owner_token = null, send_owner_generation = null,
           send_lease_expires_at = null, stable_error_code = 'delivery-send-lease-expired', updated_at = ?, completed_at = ?
         where id = ? and status = 'sending' and send_lease_expires_at <= ?`
      ).run(input.now.toISOString(), input.now.toISOString(), input.attempt.id, input.now.toISOString())
      const current = this.database.connection.prepare(
        `select status, send_revision from channel_delivery_attempts where id = ?`
      ).get(input.attempt.id) as { status: ChannelDeliveryStatus; send_revision: number } | undefined
      if (!current || !canOwn(current.status, input.retryUnknown)) return null
      if (!this.isAuthorized({ ...input.attempt, sourceId: '', requireTarget: input.attempt.source !== 'inbound-reply', executionClaim: input.executionClaim, now: input.now })) return null
      const token = randomUUID()
      const leaseExpiresAt = new Date(input.now.getTime() + (input.leaseMs ?? 60_000)).toISOString()
      const revision = current.send_revision + 1
      const changed = this.database.connection.prepare(
        `update channel_delivery_attempts
         set status = 'sending', send_owner_token = ?, send_owner_generation = ?, send_lease_expires_at = ?, send_revision = ?,
             attempt_count = attempt_count + 1, stable_error_code = null, updated_at = ?, completed_at = null
         where id = ? and status = ? and send_revision = ?`
      ).run(token, input.executionClaim?.generation ?? null, leaseExpiresAt, revision, input.now.toISOString(), input.attempt.id, current.status, current.send_revision).changes
      return changed === 1 ? { attemptId: input.attempt.id, token, revision, leaseExpiresAt } : null
    })
  }

  setRetryPayload(input: {
    attemptId: string
    ciphertext: Uint8Array
    keyRef: string
    keyRevision: number
  }): void {
    this.database.connection.prepare(
      `update channel_delivery_attempts
       set retry_payload_ciphertext = ?, retry_payload_key_ref = ?, retry_payload_key_revision = ?
       where id = ? and status in ('pending', 'sending')`
    ).run(input.ciphertext, input.keyRef, input.keyRevision, input.attemptId)
  }

  listDueRetries(now = new Date(), limit = 20): Array<{
    attemptId: string
    channelId: string
    agentId: string
    conversationId: string
    source: ChannelDeliverySource
    sourceId: string
    ciphertext: Uint8Array
    keyRef: string
    keyRevision: number
  }> {
    const rows = this.database.connection.prepare(
      `select id, channel_id, agent_id, conversation_id, source_type, source_id,
              retry_payload_ciphertext, retry_payload_key_ref, retry_payload_key_revision
       from channel_delivery_attempts
       where status = 'pending' and next_attempt_at is not null and next_attempt_at <= ?
         and source_type <> 'inbound-reply' and source_id is not null
         and retry_payload_ciphertext is not null and retry_payload_key_ref is not null
         and retry_payload_key_revision is not null
       order by next_attempt_at asc, id asc limit ?`
    ).all(now.toISOString(), Math.max(1, Math.min(limit, 100))) as Array<{
      id: string; channel_id: string; agent_id: string; conversation_id: string
      source_type: ChannelDeliverySource; source_id: string
      retry_payload_ciphertext: Uint8Array; retry_payload_key_ref: string; retry_payload_key_revision: number
    }>
    return rows.map((row) => ({
      attemptId: row.id,
      channelId: row.channel_id,
      agentId: row.agent_id,
      conversationId: row.conversation_id,
      source: row.source_type,
      sourceId: row.source_id,
      ciphertext: row.retry_payload_ciphertext,
      keyRef: row.retry_payload_key_ref,
      keyRevision: row.retry_payload_key_revision
    }))
  }

  // An old sender cannot overwrite a newer owner. A lifecycle fence after transport begins
  // preserves an unknown outcome instead of asserting delivery.
  finish(input: { owner: ChannelDeliverySendOwner; status: Exclude<ChannelDeliveryStatus, 'pending' | 'sending'>; errorCode: string | null; retryable?: boolean; executionClaim?: ChannelExecutionClaim; now: Date }): boolean {
    return this.database.transact(() => {
      const row = this.database.connection.prepare(
        `select id, channel_id, agent_id, conversation_id, source_type, attempt_count from channel_delivery_attempts
         where id = ? and status = 'sending' and send_owner_token = ? and send_revision = ? and send_lease_expires_at = ? and send_lease_expires_at > ?`
      ).get(input.owner.attemptId, input.owner.token, input.owner.revision, input.owner.leaseExpiresAt, input.now.toISOString()) as OwnedRow | undefined
      if (!row) return false
      const authorized = this.isAuthorized({
        channelId: row.channel_id, agentId: row.agent_id, conversationId: row.conversation_id, source: row.source_type,
        sourceId: '', requireTarget: row.source_type !== 'inbound-reply', executionClaim: input.executionClaim, now: input.now
      })
      const failed = authorized ? input.status : 'unknown-after-send'
      const code = authorized ? input.errorCode : 'delivery-lifecycle-fenced'
      const retryAt = failed === 'failed' && input.retryable && row.attempt_count < 5
        ? new Date(input.now.getTime() + deliveryBackoffMs(row.attempt_count)).toISOString()
        : null
      const status = retryAt ? 'pending' : failed
      const changed = this.database.connection.prepare(
        `update channel_delivery_attempts set status = ?, stable_error_code = ?, send_owner_token = null,
           send_owner_generation = null, send_lease_expires_at = null, updated_at = ?, completed_at = ?,
           next_attempt_at = ?
         where id = ? and status = 'sending' and send_owner_token = ? and send_revision = ? and send_lease_expires_at = ?`
      ).run(status, code, input.now.toISOString(), retryAt ? null : input.now.toISOString(), retryAt,
        input.owner.attemptId, input.owner.token, input.owner.revision, input.owner.leaseExpiresAt).changes
      if (changed === 1) {
        if (!retryAt) this.clearRetryPayloadInTransaction(input.owner.attemptId)
        this.audit(row.channel_id, input.owner.attemptId, `channel-delivery-${status}`, input.now)
      }
      return changed === 1
    })
  }

  markRetryTerminal(attemptId: string, code: string, now = new Date()): void {
    this.database.connection.prepare(
      `update channel_delivery_attempts set status = 'failed', stable_error_code = ?, next_attempt_at = null,
         retry_payload_ciphertext = null, retry_payload_key_ref = null, retry_payload_key_revision = null,
         completed_at = ?, updated_at = ? where id = ? and status = 'pending'`
    ).run(code, now.toISOString(), now.toISOString(), attemptId)
  }

  private clearRetryPayloadInTransaction(attemptId: string): void {
    this.database.connection.prepare(
      `update channel_delivery_attempts set retry_payload_ciphertext = null, retry_payload_key_ref = null,
         retry_payload_key_revision = null where id = ?`
    ).run(attemptId)
  }

  // Recheck a durable owner immediately before crossing the transport boundary. This cannot
  // reassign ownership; it only rejects a sender fenced after beginSend.
  admitSend(input: { attempt: DeliveryAttempt; owner: ChannelDeliverySendOwner; executionClaim?: ChannelExecutionClaim; now: Date }): boolean {
    return this.database.transact(() => Boolean(this.database.connection.prepare(
      `select 1 from channel_delivery_attempts d where d.id = ? and d.status = 'sending' and d.send_owner_token = ?
       and d.send_revision = ? and d.send_lease_expires_at = ? and d.send_lease_expires_at > ?
       and exists (select 1 from channel_conversations v join agent_channels c on c.id = v.channel_id
         join channel_runtime_generations g on g.channel_id = c.id and g.lifecycle_state = 'active' join agent_entities a on a.id = c.agent_id
         where v.id = d.conversation_id and v.channel_id = d.channel_id and c.agent_id = d.agent_id
           and ${SUPPORTED_CHANNEL_C_SQL} and c.migration_state = 'runtime-ready' and c.requested_enabled = 1
           and (d.source_type = 'inbound-reply' or exists (select 1 from channel_delivery_targets t where t.channel_id = v.channel_id and t.conversation_id = v.id and t.enabled = 1))
           and (? is null or exists (select 1 from channel_inbound_work_items w join channel_receipts r on r.id = w.receipt_id
             where w.id = ? and w.receipt_id = ? and w.channel_id = v.channel_id and w.conversation_id = v.id and w.dispatch_id = ?
               and w.status = 'dispatching' and w.lease_token = ? and w.lease_expires_at = ? and w.lease_expires_at > ? and r.generation = ? and r.generation = g.generation)))`
    ).get(input.owner.attemptId, input.owner.token, input.owner.revision, input.owner.leaseExpiresAt, input.now.toISOString(),
      input.executionClaim?.workItemId ?? null, input.executionClaim?.workItemId ?? '', input.executionClaim?.receiptId ?? '', input.executionClaim?.dispatchId ?? '', input.executionClaim?.leaseToken ?? '', input.executionClaim?.leaseExpiresAt ?? '', input.now.toISOString(), input.executionClaim?.generation ?? -1)))
  }

  finishSkipped(attempt: DeliveryAttempt, code: string, now: Date): boolean {
    return this.database.transact(() => {
      const changed = this.database.connection.prepare(
        `update channel_delivery_attempts set status = 'skipped', stable_error_code = ?, updated_at = ?, completed_at = ?
         where id = ? and status = 'pending'`
      ).run(code, now.toISOString(), now.toISOString(), attempt.id).changes
      if (changed === 1) this.audit(attempt.channelId, attempt.id, 'channel-delivery-skipped', now)
      return changed === 1
    })
  }

  getConversationKeyCipher(conversationId: string): { channelId: string; ciphertext: Uint8Array; keyRef: string; keyRevision: number } | null {
    const row = this.database.connection.prepare(
      `select v.channel_id, v.conversation_key_ciphertext, v.conversation_key_ref, v.conversation_key_revision
       from channel_conversations v join agent_channels c on c.id = v.channel_id
       where v.id = ? and ${SUPPORTED_CHANNEL_C_SQL}`
    ).get(conversationId) as ConversationCipherRow | undefined
    return row ? { channelId: row.channel_id, ciphertext: row.conversation_key_ciphertext, keyRef: row.conversation_key_ref, keyRevision: row.conversation_key_revision } : null
  }

  listEnabledTargets(channelId: string, agentId: string): Array<{ conversationId: string }> {
    const rows = this.database.connection.prepare(
      `select t.conversation_id from channel_delivery_targets t join channel_conversations v on v.id = t.conversation_id and v.channel_id = t.channel_id
       join agent_channels c on c.id = t.channel_id join agent_entities a on a.id = c.agent_id
       join channel_runtime_generations g on g.channel_id = c.id and g.lifecycle_state = 'active'
       where t.channel_id = ? and t.enabled = 1 and c.agent_id = ? and ${SUPPORTED_CHANNEL_C_SQL}
         and c.migration_state = 'runtime-ready' and c.requested_enabled = 1
       order by t.updated_at asc, t.id asc`
    ).all(channelId, agentId) as Array<{ conversation_id: string }>
    return rows.map((row) => ({ conversationId: row.conversation_id }))
  }

  hasEnabledTarget(channelId: string, agentId: string): boolean {
    return this.listEnabledTargets(channelId, agentId).length > 0
  }

  listAttempts(input: { channelId: string; agentId: string; limit?: number; offset?: number }): { attempts: ChannelDeliveryAttemptView[]; total: number } {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100)); const offset = Math.max(0, input.offset ?? 0)
    const rows = this.database.connection.prepare(
      `select id, channel_id, agent_id, conversation_id, source_type, status, stable_error_code, created_at, updated_at, completed_at
       from channel_delivery_attempts where channel_id = ? and agent_id = ? order by created_at desc, id desc limit ? offset ?`
    ).all(input.channelId, input.agentId, limit, offset) as AttemptViewRow[]
    const total = (this.database.connection.prepare('select count(*) as count from channel_delivery_attempts where channel_id = ? and agent_id = ?').get(input.channelId, input.agentId) as { count: number }).count
    return { attempts: rows.map(mapView), total }
  }

  listAudits(input: { channelId: string; limit?: number; offset?: number }): { audits: ChannelDeliveryAuditView[]; total: number } {
    const limit = Math.max(1, Math.min(input.limit ?? 50, 100)); const offset = Math.max(0, input.offset ?? 0)
    const rows = this.database.connection.prepare('select id, channel_id, attempt_id, code, created_at from channel_delivery_audits where channel_id = ? order by created_at desc, id desc limit ? offset ?').all(input.channelId, limit, offset) as AuditRow[]
    const total = (this.database.connection.prepare('select count(*) as count from channel_delivery_audits where channel_id = ?').get(input.channelId) as { count: number }).count
    return { audits: rows.map((row) => ({ id: row.id, channelId: row.channel_id, attemptId: row.attempt_id, code: row.code, createdAt: row.created_at })), total }
  }

  listTaskAttempts(input: { agentId: string; runLogId: string; limit: number; offset: number }): { attempts: Array<{ id: string; channelId: string; status: ChannelDeliveryStatus; errorCode: string | null; createdAt: string; completedAt: string | null }>; total: number } {
    const hashes = taskHashes(input.runLogId)
    const where = `d.agent_id = ? and d.source_type = 'task-result' and d.source_hash in (?, ?, ?)`
    const rows = this.database.connection.prepare(`select d.id, d.channel_id, d.status, d.stable_error_code, d.created_at, d.completed_at from channel_delivery_attempts d join agent_channels c on c.id = d.channel_id join agent_entities a on a.id = c.agent_id where ${SUPPORTED_CHANNEL_C_SQL} and ${where} order by d.created_at desc, d.id desc limit ? offset ?`).all(input.agentId, ...hashes, Math.max(1, Math.min(input.limit, 100)), Math.max(0, input.offset)) as TaskAttemptRow[]
    const total = (this.database.connection.prepare(`select count(*) as count from channel_delivery_attempts d join agent_channels c on c.id = d.channel_id join agent_entities a on a.id = c.agent_id where ${SUPPORTED_CHANNEL_C_SQL} and ${where}`).get(input.agentId, ...hashes) as { count: number }).count
    return { attempts: rows.map((row) => ({ id: row.id, channelId: row.channel_id, status: row.status, errorCode: row.stable_error_code, createdAt: row.created_at, completedAt: row.completed_at })), total }
  }

  getTaskAttempt(input: { agentId: string; runLogId: string; attemptId: string }): DeliveryAttempt | null {
    const row = this.database.connection.prepare(
      `select d.id, d.channel_id, d.agent_id, d.conversation_id, d.source_type, d.source_hash, d.idempotency_key, d.status
       from channel_delivery_attempts d join agent_channels c on c.id = d.channel_id join agent_entities a on a.id = c.agent_id
       where ${SUPPORTED_CHANNEL_C_SQL} and d.id = ? and d.agent_id = ? and d.source_type = 'task-result' and d.source_hash in (?, ?, ?)`
    ).get(input.attemptId, input.agentId, ...taskHashes(input.runLogId)) as AttemptRow | undefined
    return row ? mapAttempt(row) : null
  }

  cleanupPage(channelId: string, now = new Date(), limit = 500): { attempts: number; audits: number } {
    const batch = Math.max(1, Math.min(limit, 500)); const cutoff = new Date(now.getTime() - 30 * 86_400_000).toISOString()
    const attempts = this.database.connection.prepare(`delete from channel_delivery_attempts where id in (select id from channel_delivery_attempts where channel_id = ? and status in ('delivered','failed','unknown-after-send','skipped') and (completed_at < ? or id in (select id from channel_delivery_attempts where channel_id = ? and status in ('delivered','failed','unknown-after-send','skipped') order by completed_at desc, id desc limit -1 offset 10000)) order by completed_at asc, id asc limit ?)`).run(channelId, cutoff, channelId, batch).changes as number
    const audits = this.database.connection.prepare(`delete from channel_delivery_audits where id in (select id from channel_delivery_audits where channel_id = ? and (created_at < ? or id in (select id from channel_delivery_audits where channel_id = ? order by created_at desc, id desc limit -1 offset 5000)) order by created_at asc, id asc limit ? )`).run(channelId, cutoff, channelId, batch).changes as number
    return { attempts, audits }
  }

  cleanupChannelsPage(cursor: string | null, now = new Date(), limit = 500): { nextCursor: string | null } {
    const rows = this.database.connection.prepare(
      `select channel_id from (
         select channel_id from channel_delivery_attempts union select channel_id from channel_delivery_audits
       ) where (? is null or channel_id > ?) order by channel_id asc limit ?`
    ).all(cursor, cursor, Math.max(1, Math.min(limit, 500))) as Array<{ channel_id: string }>
    for (const row of rows) this.cleanupPage(row.channel_id, now, 500)
    return { nextCursor: rows.length === 0 || rows.length < Math.min(limit, 500) ? null : rows.at(-1)!.channel_id }
  }

  private isAuthorized(input: ClaimInput): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from channel_conversations v join agent_channels c on c.id = v.channel_id
       join channel_runtime_generations g on g.channel_id = c.id and g.lifecycle_state = 'active'
       join agent_entities a on a.id = c.agent_id
       where v.id = ? and v.channel_id = ? and c.agent_id = ? and ${SUPPORTED_CHANNEL_C_SQL}
         and c.migration_state = 'runtime-ready' and c.requested_enabled = 1
         and (? = 0 or exists (select 1 from channel_delivery_targets t where t.channel_id = v.channel_id and t.conversation_id = v.id and t.enabled = 1))
         and (? is null or exists (select 1 from channel_inbound_work_items w join channel_receipts r on r.id = w.receipt_id
           where w.id = ? and w.receipt_id = ? and w.channel_id = v.channel_id and w.conversation_id = v.id and w.dispatch_id = ?
             and w.status = 'dispatching' and w.lease_token = ? and w.lease_expires_at = ? and w.lease_expires_at > ? and r.generation = ? and r.generation = g.generation))`
    ).get(input.conversationId, input.channelId, input.agentId, input.requireTarget ? 1 : 0, input.executionClaim?.workItemId ?? null,
      input.executionClaim?.workItemId ?? '', input.executionClaim?.receiptId ?? '', input.executionClaim?.dispatchId ?? '', input.executionClaim?.leaseToken ?? '', input.executionClaim?.leaseExpiresAt ?? '', input.now.toISOString(), input.executionClaim?.generation ?? -1))
  }

  private audit(channelId: string, attemptId: string | null, code: string, now: Date): void {
    this.database.connection.prepare('insert into channel_delivery_audits (id, channel_id, attempt_id, code, created_at) values (?, ?, ?, ?, ?)').run(randomUUID(), channelId, attemptId, code, now.toISOString())
  }
}

type ClaimInput = { channelId: string; agentId: string; conversationId: string; source: ChannelDeliverySource; sourceId: string; requireTarget: boolean; executionClaim?: ChannelExecutionClaim; now: Date }
type AttemptRow = { id: string; channel_id: string; agent_id: string; conversation_id: string; source_type: ChannelDeliverySource; source_hash: string; idempotency_key: string; status: ChannelDeliveryStatus }
type OwnedRow = { id: string; channel_id: string; agent_id: string; conversation_id: string; source_type: ChannelDeliverySource; attempt_count: number }
type ConversationCipherRow = { channel_id: string; conversation_key_ciphertext: Uint8Array; conversation_key_ref: string; conversation_key_revision: number }
type AttemptViewRow = AttemptRow & { stable_error_code: string | null; created_at: string; updated_at: string; completed_at: string | null }
type TaskAttemptRow = { id: string; channel_id: string; status: ChannelDeliveryStatus; stable_error_code: string | null; created_at: string; completed_at: string | null }
type AuditRow = { id: string; channel_id: string; attempt_id: string | null; code: string; created_at: string }

function canOwn(status: ChannelDeliveryStatus, retryUnknown: boolean): boolean { return status === 'pending' || (retryUnknown && status === 'unknown-after-send') }
function deliveryBackoffMs(attemptCount: number): number {
  return [5_000, 30_000, 120_000, 600_000, 1_800_000][Math.max(0, Math.min(attemptCount - 1, 4))] ?? 1_800_000
}
function hash(value: string): string { return createHash('sha256').update(value).digest('base64url') }
function taskHashes(runLogId: string): [string, string, string] { return ['completed', 'failed', 'cancelled'].map((status) => hash(`${runLogId}:${status}`)) as [string, string, string] }
function mapAttempt(row: AttemptRow): DeliveryAttempt { return { id: row.id, channelId: row.channel_id, agentId: row.agent_id, conversationId: row.conversation_id, source: row.source_type, sourceHash: row.source_hash, idempotencyKey: row.idempotency_key, status: row.status } }
function mapView(row: AttemptViewRow): ChannelDeliveryAttemptView { return { id: row.id, channelId: row.channel_id, agentId: row.agent_id, conversationId: row.conversation_id, source: row.source_type, status: row.status, errorCode: row.stable_error_code, createdAt: row.created_at, updatedAt: row.updated_at, completedAt: row.completed_at } }
