import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import { supportedChannelSql } from './ChannelManagementPredicates'
import type { ChannelConversationKind } from './channelContracts'
import type { ChannelDispatchAdmission, ChannelDispatchFinalStatus, ChannelExecutionClaim } from './ChannelInboundContracts'

export type ChannelInboundAuditCode =
  | 'channel-policy-denied'
  | 'channel-mention-required'
  | 'channel-content-rejected'
  | 'channel-receipt-without-work-item'
  | 'channel-stale-generation'
  | 'channel-agent-missing'
  | 'channel-work-capacity-exhausted'
  | 'channel-lifecycle-fenced'

export type ChannelConversationRecord = {
  id: string
  channelId: string
  keyCiphertext: Uint8Array
  keyRef: string
  keyRevision: number
  keyHash: string
  kind: ChannelConversationKind
  sessionId: string | null
}

export type ChannelCandidateRecord = {
  id: string
  channelId: string
  kind: ChannelConversationKind
  userKeyCiphertext: Uint8Array
  userKeyRef: string
  userKeyRevision: number
  userKeyHash: string
  conversationKeyCiphertext: Uint8Array
  conversationKeyRef: string
  conversationKeyRevision: number
  conversationKeyHash: string
  displayLabel: string | null
  firstSeenAt: string
  lastSeenAt: string
  hitCount: number
  status: 'pending' | 'allowed' | 'ignored'
}

export type ChannelCandidateSafeView = {
  id: string
  kind: ChannelConversationKind
  displayLabel: string | null
  firstSeenAt: string
  lastSeenAt: string
  hitCount: number
  status: 'pending' | 'allowed' | 'ignored'
}

export type ChannelWorkItemRecord = {
  id: string
  receiptId: string
  channelId: string
  conversationId: string
  dispatchId: string
  ciphertext: Uint8Array
  keyRef: string
  keyRevision: number
  status: 'processing' | 'dispatching' | 'completed' | 'failed' | 'unknown-after-restart' | 'quarantined'
  leaseToken: string | null
  leaseExpiresAt: string | null
  attemptCount: number
}

type ReceiptRow = { id: string; status: string }

const SUPPORTED_CHANNEL_C_SQL = supportedChannelSql('c')

export class ChannelInboundRepository {
  private readonly database: AgentPlatformDatabase
  private readonly beforeReclaimLease: (() => void) | undefined

  constructor(database: AgentPlatformDatabase, options: { beforeReclaimLease?: () => void } = {}) {
    this.database = database
    this.beforeReclaimLease = options.beforeReclaimLease
  }

  start(channelId: string, now = new Date()): number {
    return this.database.transact(() => {
      const prior = this.database.connection.prepare('select generation from channel_runtime_generations where channel_id = ?').get(channelId) as { generation: number } | undefined
      const generation = (prior?.generation ?? 0) + 1
      this.database.connection.prepare(
        `insert into channel_runtime_generations (channel_id, generation, lifecycle_state, updated_at)
         values (?, ?, 'active', ?)
         on conflict(channel_id) do update set generation = excluded.generation, lifecycle_state = 'active', updated_at = excluded.updated_at`
      ).run(channelId, generation, now.toISOString())
      return generation
    })
  }

  fence(channelId: string, lifecycle: 'inactive' | 'deleted' = 'inactive', now = new Date()): number {
    return this.database.transact(() => {
      const row = this.database.connection.prepare('select generation from channel_runtime_generations where channel_id = ?').get(channelId) as { generation: number } | undefined
      const generation = (row?.generation ?? 0) + 1
      this.database.connection.prepare(
        `insert into channel_runtime_generations (channel_id, generation, lifecycle_state, updated_at)
         values (?, ?, ?, ?)
         on conflict(channel_id) do update set generation = excluded.generation, lifecycle_state = excluded.lifecycle_state, updated_at = excluded.updated_at`
      ).run(channelId, generation, lifecycle, now.toISOString())
      return generation
    })
  }

  getCurrentAgentId(channelId: string, generation: number): string | null {
    const row = this.database.connection.prepare(
      `select c.agent_id from channel_runtime_generations g
       join agent_channels c on c.id = g.channel_id
       join agent_entities a on a.id = c.agent_id
       where g.channel_id = ? and g.generation = ? and g.lifecycle_state = 'active'
         and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
         and c.agent_id is not null and length(trim(c.agent_id)) > 0`
    ).get(channelId, generation) as { agent_id: string } | undefined
    return row?.agent_id ?? null
  }

  getActiveAgentId(channelId: string): string | null {
    const row = this.database.connection.prepare(
      `select c.agent_id from channel_runtime_generations g
       join agent_channels c on c.id = g.channel_id
       join agent_entities a on a.id = c.agent_id
       where g.channel_id = ? and g.lifecycle_state = 'active'
         and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
         and c.agent_id is not null and length(trim(c.agent_id)) > 0`
    ).get(channelId) as { agent_id: string } | undefined
    return row?.agent_id ?? null
  }

  // The coordinator must retrieve the bound session only while it still owns this exact
  // dispatching work item. Conversation observation alone is never execution authority.
  getConversationBinding(input: { claim: ChannelExecutionClaim; conversationId: string; now?: Date }): { agentId: string; sessionId: string } | null {
    const row = this.database.connection.prepare(
      `select c.agent_id, v.agent_session_id from channel_inbound_work_items w
       join channel_receipts r on r.id = w.receipt_id
       join channel_conversations v on v.id = w.conversation_id and v.channel_id = w.channel_id
       join agent_channels c on c.id = w.channel_id
       join channel_runtime_generations g on g.channel_id = c.id and g.generation = r.generation and g.lifecycle_state = 'active'
       join agent_entities a on a.id = c.agent_id
       where w.id = ? and w.receipt_id = ? and w.channel_id = ? and w.conversation_id = ? and w.dispatch_id = ?
         and w.status = 'dispatching' and w.lease_token = ? and w.lease_expires_at = ? and w.lease_expires_at > ?
         and r.generation = ? and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
         and v.agent_session_id is not null`
    ).get(
      input.claim.workItemId, input.claim.receiptId, input.claim.channelId, input.conversationId, input.claim.dispatchId,
      input.claim.leaseToken, input.claim.leaseExpiresAt, (input.now ?? new Date()).toISOString(), input.claim.generation
    ) as { agent_id: string; agent_session_id: string } | undefined
    return row ? { agentId: row.agent_id, sessionId: row.agent_session_id } : null
  }

  isCurrentActive(channelId: string, generation: number): boolean {
    return this.getCurrentAgentId(channelId, generation) !== null
  }

  acknowledgeIfCurrent(channelId: string, generation: number): boolean {
    return this.getCurrentAgentId(channelId, generation) !== null
  }

  recordRejectedLifecycle(channelId: string, generation: number, code: 'channel-agent-missing' | 'channel-stale-generation', now = new Date()): void {
    this.database.transact(() => this.audit(channelId, generation, code, now))
  }

  getConversation(channelId: string, keyHash: string): ChannelConversationRecord | null {
    const row = this.database.connection.prepare(
      `select id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision,
              conversation_key_hash, conversation_kind, agent_session_id
       from channel_conversations where channel_id = ? and conversation_key_hash = ?`
    ).get(channelId, keyHash) as ConversationRow | undefined
    return row ? mapConversation(row) : null
  }

  existingReceiptOutcome(channelId: string, eventHash: string, now = new Date()): 'duplicate' | 'retry' | null {
    const row = this.database.connection.prepare(
      'select id, status from channel_receipts where channel_id = ? and provider_event_key_hash = ?'
    ).get(channelId, eventHash) as ReceiptRow | undefined
    if (!row) return null
    if (row.status === 'processing' && !this.hasWorkItem(row.id)) {
      this.database.transact(() => {
        this.updateReceipt(row.id, 'quarantined', now)
        const generation = this.database.connection.prepare('select generation from channel_receipts where id = ?').get(row.id) as { generation: number }
        this.audit(channelId, generation.generation, 'channel-receipt-without-work-item', now)
      })
      return 'retry'
    }
    return 'duplicate'
  }

  findInitialClaim(channelId: string, eventHash: string, now = new Date()): ChannelExecutionClaim | null {
    const row = this.database.connection.prepare(
      `select w.id, w.receipt_id, w.channel_id, w.dispatch_id, w.lease_token, w.lease_expires_at, r.generation
       from channel_receipts r join channel_inbound_work_items w on w.receipt_id = r.id
       join channel_runtime_generations g on g.channel_id = r.channel_id and g.generation = r.generation
       join agent_channels c on c.id = r.channel_id
       join agent_entities a on a.id = c.agent_id
       where r.channel_id = ? and r.provider_event_key_hash = ? and r.status = 'processing'
         and w.status = 'processing' and w.lease_token is not null and w.lease_expires_at > ?
         and g.lifecycle_state = 'active' and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1`
    ).get(channelId, eventHash, now.toISOString()) as InitialClaimRow | undefined
    return row ? {
      workItemId: row.id,
      receiptId: row.receipt_id,
      channelId: row.channel_id,
      dispatchId: row.dispatch_id,
      generation: row.generation,
      leaseToken: row.lease_token,
      leaseExpiresAt: row.lease_expires_at
    } : null
  }

  findInitialClaimByOwner(claim: ChannelExecutionClaim, now = new Date()): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from channel_inbound_work_items w join channel_receipts r on r.id = w.receipt_id
       join channel_runtime_generations g on g.channel_id = r.channel_id and g.generation = r.generation
       join agent_channels c on c.id = r.channel_id
       join agent_entities a on a.id = c.agent_id
       where w.id = ? and w.receipt_id = ? and w.channel_id = ? and w.dispatch_id = ?
         and w.status = 'processing' and w.lease_token = ? and w.lease_expires_at = ? and w.lease_expires_at > ?
         and r.generation = ? and g.lifecycle_state = 'active'
         and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1`
    ).get(
      claim.workItemId, claim.receiptId, claim.channelId, claim.dispatchId,
      claim.leaseToken, claim.leaseExpiresAt, now.toISOString(), claim.generation
    ))
  }

  reserveConversationOperation(channelId: string, keyHash: string, generation: number, agentId: string, now = new Date()): string | null {
    return this.database.transact(() => {
      if (this.getCurrentAgentId(channelId, generation) !== agentId) return null
      // A restart advances generation, so only a same-generation reservation can block it.
      this.database.connection.prepare(
        'delete from channel_conversation_session_operations where channel_id = ? and conversation_key_hash = ? and generation <> ?'
      ).run(channelId, keyHash, generation)
      const operationId = randomUUID()
      const inserted = this.database.connection.prepare(
        `insert or ignore into channel_conversation_session_operations (
          channel_id, conversation_key_hash, operation_id, generation, agent_id, created_at
        ) values (?, ?, ?, ?, ?, ?)`
      ).run(channelId, keyHash, operationId, generation, agentId, now.toISOString()).changes === 1
      return inserted ? operationId : null
    })
  }

  releaseConversationOperation(channelId: string, keyHash: string, operationId: string): void {
    this.database.connection.prepare(
      'delete from channel_conversation_session_operations where channel_id = ? and conversation_key_hash = ? and operation_id = ?'
    ).run(channelId, keyHash, operationId)
  }

  createConversation(record: ChannelConversationRecord, generation: number, agentId: string, now = new Date()): { record: ChannelConversationRecord; created: boolean } | null {
    try {
      return this.database.transact(() => {
        if (this.getCurrentAgentId(record.channelId, generation) !== agentId) return null
        this.database.connection.prepare(
          `insert into channel_conversations (
            id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision,
            conversation_key_hash, conversation_kind, agent_session_id, created_at, updated_at
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(record.id, record.channelId, record.keyCiphertext, record.keyRef, record.keyRevision, record.keyHash, record.kind, record.sessionId, now.toISOString(), now.toISOString())
        return { record, created: true }
      })
    } catch {
      const existing = this.getConversation(record.channelId, record.keyHash)
      if (!existing) throw new Error('Channel conversation persistence failed.')
      return { record: existing, created: false }
    }
  }

  deleteUnboundConversation(channelId: string, keyHash: string, sessionId: string): boolean {
    return this.database.connection.prepare(
      `delete from channel_conversations where channel_id = ? and conversation_key_hash = ? and agent_session_id = ?
       and not exists (select 1 from channel_inbound_work_items where conversation_id = channel_conversations.id)`
    ).run(channelId, keyHash, sessionId).changes === 1
  }

  reserveAdmission(channelId: string, generation: number, now = new Date()): string | null {
    return this.database.transact(() => {
      if (!this.isCurrentActive(channelId, generation)) return null
      this.database.connection.prepare(
        'delete from channel_inbound_admission_reservations where channel_id = ? and (generation <> ? or expires_at <= ?)'
      ).run(channelId, generation, now.toISOString())
      const active = this.database.connection.prepare(
        `select count(*) as count from channel_inbound_work_items where channel_id = ? and status in ('processing', 'dispatching', 'unknown-after-restart')`
      ).get(channelId) as { count: number }
      const reserved = this.database.connection.prepare(
        'select count(*) as count from channel_inbound_admission_reservations where channel_id = ? and generation = ?'
      ).get(channelId, generation) as { count: number }
      if (active.count + reserved.count >= 10_000) {
        this.audit(channelId, generation, 'channel-work-capacity-exhausted', now)
        return null
      }
      const id = randomUUID()
      this.database.connection.prepare(
        `insert into channel_inbound_admission_reservations (id, channel_id, generation, created_at, expires_at)
         values (?, ?, ?, ?, ?)`
      ).run(id, channelId, generation, now.toISOString(), new Date(now.getTime() + 120_000).toISOString())
      return id
    })
  }

  releaseAdmission(id: string): void {
    this.database.connection.prepare('delete from channel_inbound_admission_reservations where id = ?').run(id)
  }

  replaceConversationSession(channelId: string, keyHash: string, sessionId: string, generation: number, agentId: string, now = new Date()): boolean {
    return this.database.transact(() => {
      if (this.getCurrentAgentId(channelId, generation) !== agentId) return false
      return this.database.connection.prepare(
        `update channel_conversations set agent_session_id = ?, updated_at = ? where channel_id = ? and conversation_key_hash = ?`
      ).run(sessionId, now.toISOString(), channelId, keyHash).changes === 1
    })
  }

  setDeliveryTarget(channelId: string, conversationId: string, enabled: boolean, now = new Date()): boolean {
    const conversation = this.database.connection.prepare(
      'select 1 from channel_conversations where id = ? and channel_id = ?'
    ).get(conversationId, channelId)
    if (!conversation) return false
    this.database.connection.prepare(
      `insert into channel_delivery_targets (id, channel_id, conversation_id, enabled, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?)
       on conflict(channel_id, conversation_id) do update set enabled = excluded.enabled, updated_at = excluded.updated_at`
    ).run(randomUUID(), channelId, conversationId, enabled ? 1 : 0, now.toISOString(), now.toISOString())
    return true
  }

  managedChannelExists(channelId: string): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from agent_channels c where c.id = ? and ${SUPPORTED_CHANNEL_C_SQL}`
    ).get(channelId))
  }

  upsertCandidate(input: {
    channelId: string
    kind: ChannelConversationKind
    userKeyCiphertext: Uint8Array
    userKeyRef: string
    userKeyRevision: number
    userKeyHash: string
    conversationKeyCiphertext: Uint8Array
    conversationKeyRef: string
    conversationKeyRevision: number
    conversationKeyHash: string
    displayLabel?: string
    now?: Date
  }): void {
    const now = (input.now ?? new Date()).toISOString()
    this.database.connection.prepare(
      `insert into channel_inbound_candidates (
         id, channel_id, conversation_kind, user_key_ciphertext, user_key_ref, user_key_revision, user_key_hash,
         conversation_key_ciphertext, conversation_key_ref, conversation_key_revision, conversation_key_hash,
         display_label, first_seen_at, last_seen_at, hit_count, status
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'pending')
       on conflict(channel_id, conversation_kind, user_key_hash, conversation_key_hash) do update set
         last_seen_at = excluded.last_seen_at,
         hit_count = channel_inbound_candidates.hit_count + 1,
         display_label = coalesce(excluded.display_label, channel_inbound_candidates.display_label)`
    ).run(
      randomUUID(), input.channelId, input.kind, input.userKeyCiphertext, input.userKeyRef, input.userKeyRevision,
      input.userKeyHash, input.conversationKeyCiphertext, input.conversationKeyRef, input.conversationKeyRevision,
      input.conversationKeyHash, input.displayLabel ?? null, now, now
    )
  }

  listCandidates(channelId: string, limit = 100): ChannelCandidateSafeView[] {
    const rows = this.database.connection.prepare(
      `select id, conversation_kind, display_label, first_seen_at, last_seen_at, hit_count, status
       from channel_inbound_candidates
       where channel_id = ? and status = 'pending'
       order by last_seen_at desc, id asc limit ?`
    ).all(channelId, Math.max(1, Math.min(limit, 200))) as Array<{
      id: string; conversation_kind: ChannelConversationKind; display_label: string | null
      first_seen_at: string; last_seen_at: string; hit_count: number
      status: 'pending' | 'allowed' | 'ignored'
    }>
    return rows.map((row) => ({
      id: row.id,
      kind: row.conversation_kind,
      displayLabel: row.display_label,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      hitCount: row.hit_count,
      status: row.status
    }))
  }

  getCandidate(channelId: string, candidateId: string): ChannelCandidateRecord | null {
    const row = this.database.connection.prepare(
      `select * from channel_inbound_candidates where channel_id = ? and id = ?`
    ).get(channelId, candidateId) as Record<string, unknown> | undefined
    return row ? {
      id: row.id as string,
      channelId: row.channel_id as string,
      kind: row.conversation_kind as ChannelConversationKind,
      userKeyCiphertext: row.user_key_ciphertext as Uint8Array,
      userKeyRef: row.user_key_ref as string,
      userKeyRevision: row.user_key_revision as number,
      userKeyHash: row.user_key_hash as string,
      conversationKeyCiphertext: row.conversation_key_ciphertext as Uint8Array,
      conversationKeyRef: row.conversation_key_ref as string,
      conversationKeyRevision: row.conversation_key_revision as number,
      conversationKeyHash: row.conversation_key_hash as string,
      displayLabel: (row.display_label as string | null) ?? null,
      firstSeenAt: row.first_seen_at as string,
      lastSeenAt: row.last_seen_at as string,
      hitCount: row.hit_count as number,
      status: row.status as 'pending' | 'allowed' | 'ignored'
    } : null
  }

  /** Allows a candidate without ever decrypting its provider keys. */
  allowCandidate(input: {
    channelId: string
    candidateId: string
    enableTarget: boolean
    now?: Date
  }): string | null {
    const now = input.now ?? new Date()
    if (!this.managedChannelExists(input.channelId)) return null
    return this.database.transact(() => {
      const candidate = this.getCandidate(input.channelId, input.candidateId)
      if (!candidate || candidate.status !== 'pending') return null
      this.database.connection.prepare(
        `insert or ignore into channel_allow_policies (
           id, channel_id, subject_type, subject_key_ciphertext, subject_key_ref, subject_key_revision,
           subject_key_hash, conversation_kind, created_at
         ) values (?, ?, 'user', ?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), input.channelId, candidate.userKeyCiphertext, candidate.userKeyRef, candidate.userKeyRevision, candidate.userKeyHash, candidate.kind, now.toISOString())

      let conversationId = this.database.connection.prepare(
        'select id from channel_conversations where channel_id = ? and conversation_key_hash = ?'
      ).get(input.channelId, candidate.conversationKeyHash) as { id: string } | undefined
      if (!conversationId) {
        const id = randomUUID()
        this.database.connection.prepare(
          `insert into channel_conversations (
             id, channel_id, conversation_key_ciphertext, conversation_key_ref, conversation_key_revision,
             conversation_key_hash, conversation_kind, agent_session_id, created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, null, ?, ?)`
        ).run(id, input.channelId, candidate.conversationKeyCiphertext, candidate.conversationKeyRef, candidate.conversationKeyRevision, candidate.conversationKeyHash, candidate.kind, now.toISOString(), now.toISOString())
        conversationId = { id }
      }
      this.setDeliveryTarget(input.channelId, conversationId.id, input.enableTarget, now)
      this.database.connection.prepare(
        "update channel_inbound_candidates set status = 'allowed', last_seen_at = ? where channel_id = ? and id = ?"
      ).run(now.toISOString(), input.channelId, input.candidateId)
      return conversationId.id
    })
  }

  ignoreCandidate(channelId: string, candidateId: string, now = new Date()): boolean {
    return this.database.connection.prepare(
      "update channel_inbound_candidates set status = 'ignored', last_seen_at = ? where channel_id = ? and id = ? and status = 'pending'"
    ).run(now.toISOString(), channelId, candidateId).changes === 1
  }

  allow(channelId: string, input: {
    subjectType: 'user' | 'conversation'
    keyCiphertext: Uint8Array
    keyRef: string
    keyRevision: number
    keyHash: string
    conversationKind?: ChannelConversationKind
  }, now = new Date()): void {
    this.database.connection.prepare(
      `insert or ignore into channel_allow_policies (
        id, channel_id, subject_type, subject_key_ciphertext, subject_key_ref, subject_key_revision,
        subject_key_hash, conversation_kind, created_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(randomUUID(), channelId, input.subjectType, input.keyCiphertext, input.keyRef, input.keyRevision, input.keyHash, input.conversationKind ?? null, now.toISOString())
  }

  isAllowed(channelId: string, userHash: string, conversationHash: string, kind: ChannelConversationKind): boolean {
    const row = this.database.connection.prepare(
      `select 1 from channel_allow_policies
       where channel_id = ? and (
         (subject_type = 'user' and subject_key_hash = ? and (conversation_kind is null or conversation_kind = ?))
         or (subject_type = 'conversation' and subject_key_hash = ? and (conversation_kind is null or conversation_kind = ?))
       ) limit 1`
    ).get(channelId, userHash, kind, conversationHash, kind)
    return Boolean(row)
  }

  handleClaim(input: {
    channelId: string
    generation: number
    eventCiphertext: Uint8Array
    eventKeyRef: string
    eventKeyRevision: number
    eventHash: string
    decision: 'ignored' | 'processing'
    auditCode?: ChannelInboundAuditCode
    work?: Omit<ChannelWorkItemRecord, 'id' | 'receiptId' | 'status' | 'leaseToken' | 'attemptCount'>
    admissionId?: string
    now: Date
  }): { outcome: 'claimed' | 'duplicate' | 'retry' | 'capacity'; dispatchId?: string; claim?: ChannelExecutionClaim } {
    return this.database.transact(() => {
      if (!this.isCurrentActive(input.channelId, input.generation)) return { outcome: 'retry' }
      const existing = this.database.connection.prepare(
        'select id, status from channel_receipts where channel_id = ? and provider_event_key_hash = ?'
      ).get(input.channelId, input.eventHash) as ReceiptRow | undefined
      if (existing) {
        if (existing.status === 'processing' && !this.hasWorkItem(existing.id)) {
          this.updateReceipt(existing.id, 'quarantined', input.now)
          this.audit(input.channelId, input.generation, 'channel-receipt-without-work-item', input.now)
          return { outcome: 'retry' }
        }
        return { outcome: 'duplicate' }
      }
      if (input.decision === 'processing') {
        const activeCount = this.database.connection.prepare(
          `select count(*) as count from channel_inbound_work_items where channel_id = ? and status in ('processing', 'dispatching', 'unknown-after-restart')`
        ).get(input.channelId) as { count: number }
        const otherReservations = this.database.connection.prepare(
          `select count(*) as count from channel_inbound_admission_reservations
           where channel_id = ? and generation = ? and id <> ?`
        ).get(input.channelId, input.generation, input.admissionId ?? '') as { count: number }
        const ownReservation = input.admissionId
          ? this.database.connection.prepare(
              `select 1 from channel_inbound_admission_reservations
               where id = ? and channel_id = ? and generation = ? and expires_at > ?`
            ).get(input.admissionId, input.channelId, input.generation, input.now.toISOString())
          : null
        if (!ownReservation || activeCount.count + otherReservations.count >= 10_000) {
          this.audit(input.channelId, input.generation, 'channel-work-capacity-exhausted', input.now)
          return { outcome: 'capacity' }
        }
      }
      const receiptId = randomUUID()
      this.database.connection.prepare(
        `insert into channel_receipts (
          id, channel_id, provider_event_key_ciphertext, provider_event_key_ref, provider_event_key_revision,
          provider_event_key_hash, status, generation, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(receiptId, input.channelId, input.eventCiphertext, input.eventKeyRef, input.eventKeyRevision, input.eventHash, input.decision, input.generation, input.now.toISOString(), input.now.toISOString())
      if (input.auditCode) this.audit(input.channelId, input.generation, input.auditCode, input.now)
      if (input.decision === 'ignored') return { outcome: 'claimed' }
      if (!input.work) throw new Error('Channel work item is required.')
      const workItemId = randomUUID()
      const leaseToken = randomUUID()
      this.database.connection.prepare(
        `insert into channel_inbound_work_items (
          id, receipt_id, channel_id, conversation_id, dispatch_id, payload_ciphertext, payload_key_ref,
          payload_key_revision, status, lease_token, lease_expires_at, attempt_count, created_at, updated_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, 1, ?, ?)`
      ).run(workItemId, receiptId, input.work.channelId, input.work.conversationId, input.work.dispatchId, input.work.ciphertext, input.work.keyRef, input.work.keyRevision, leaseToken, input.work.leaseExpiresAt, input.now.toISOString(), input.now.toISOString())
      if (input.admissionId) this.releaseAdmission(input.admissionId)
      return {
        outcome: 'claimed',
        dispatchId: input.work.dispatchId,
        claim: {
          workItemId,
          receiptId,
          channelId: input.work.channelId,
          dispatchId: input.work.dispatchId,
          generation: input.generation,
          leaseToken,
          leaseExpiresAt: input.work.leaseExpiresAt as string
        }
      }
    })
  }

  reclaimExpired(now = new Date(), leaseMs = 60_000, limit = 500): ChannelExecutionClaim[] {
    this.quarantineOrphanReceipts(now, limit)
    const lease = new Date(now.getTime() + leaseMs).toISOString()
    return this.database.transact(() => {
      const rows = this.database.connection.prepare(
        `select w.id, w.receipt_id, w.channel_id, w.conversation_id, w.dispatch_id, w.payload_ciphertext, w.payload_key_ref,
                w.payload_key_revision, w.status, w.lease_token, w.lease_expires_at, w.attempt_count, r.generation
         from channel_inbound_work_items w join channel_receipts r on r.id = w.receipt_id
         where w.status in ('processing', 'dispatching', 'unknown-after-restart') and (w.lease_expires_at is null or w.lease_expires_at <= ?)
         order by w.lease_expires_at asc, w.id asc limit ?`
      ).all(now.toISOString(), Math.max(1, Math.min(limit, 500))) as Array<WorkRow & { generation: number }>
      this.beforeReclaimLease?.()
      const reclaimed: ChannelExecutionClaim[] = []
      for (const row of rows) {
        const leaseToken = randomUUID()
        const updated = this.database.connection.prepare(
          `update channel_inbound_work_items set status = 'processing', lease_token = ?, lease_expires_at = ?, attempt_count = attempt_count + 1, updated_at = ?
           where id = ? and exists (
             select 1 from channel_receipts r
             join channel_runtime_generations g on g.channel_id = r.channel_id
             join agent_channels c on c.id = g.channel_id
             join agent_entities a on a.id = c.agent_id
             where r.id = ? and r.generation = ? and g.lifecycle_state = 'active'
               and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
           )`
        ).run(leaseToken, lease, now.toISOString(), row.id, row.receipt_id, row.generation).changes
        if (updated === 1) {
          const adopted = this.database.connection.prepare(
            `update channel_receipts set generation = (
               select generation from channel_runtime_generations where channel_id = channel_receipts.channel_id and lifecycle_state = 'active'
             ), status = 'processing', updated_at = ?
             where id = ? and generation = ?`
          ).run(now.toISOString(), row.receipt_id, row.generation).changes
          if (adopted !== 1) throw new Error('Channel recovery generation adoption failed.')
          const owner = this.database.connection.prepare(
            'select generation from channel_receipts where id = ?'
          ).get(row.receipt_id) as { generation: number }
          reclaimed.push({
            workItemId: row.id,
            receiptId: row.receipt_id,
            channelId: row.channel_id,
            dispatchId: row.dispatch_id,
            generation: owner.generation,
            leaseToken,
            leaseExpiresAt: lease
          })
          continue
        }
        // Only an inactive/deleted lifecycle may reject recovery after the CAS check.
        const quarantined = this.database.connection.prepare(
          `update channel_inbound_work_items set status = 'quarantined', lease_expires_at = null, updated_at = ?
           where id = ? and status in ('processing', 'dispatching', 'unknown-after-restart')
             and not exists (
               select 1 from channel_runtime_generations g
               join agent_channels c on c.id = g.channel_id
               join agent_entities a on a.id = c.agent_id
               where g.channel_id = channel_inbound_work_items.channel_id and g.lifecycle_state = 'active'
                 and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
             )`
        ).run(now.toISOString(), row.id).changes
        if (quarantined === 1) {
          this.updateReceipt(row.receipt_id, 'quarantined', now)
          this.audit(row.channel_id, row.generation, 'channel-lifecycle-fenced', now)
        }
      }
      return reclaimed
    })
  }

  // This is a one-time admission: a recovery claim cannot expose its payload twice.
  admitDispatch(claim: ChannelExecutionClaim, now = new Date()): ChannelDispatchAdmission | null {
    return this.database.transact(() => {
      const row = this.database.connection.prepare(
        `select w.id, w.receipt_id, w.channel_id, w.conversation_id, w.dispatch_id, w.payload_ciphertext, w.payload_key_ref,
                w.payload_key_revision, r.generation
         from channel_inbound_work_items w
         join channel_receipts r on r.id = w.receipt_id
         join channel_runtime_generations g on g.channel_id = r.channel_id and g.generation = r.generation
         join agent_channels c on c.id = r.channel_id
         join agent_entities a on a.id = c.agent_id
         where w.id = ? and w.receipt_id = ? and w.channel_id = ? and w.dispatch_id = ?
           and w.status = 'processing' and w.lease_token = ? and w.lease_expires_at = ? and w.lease_expires_at > ?
           and r.generation = ? and g.lifecycle_state = 'active'
           and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1`
      ).get(
        claim.workItemId, claim.receiptId, claim.channelId, claim.dispatchId,
        claim.leaseToken, claim.leaseExpiresAt, now.toISOString(), claim.generation
      ) as DispatchAdmissionRow | undefined
      if (row) {
        const admitted = this.database.connection.prepare(
          `update channel_inbound_work_items set status = 'dispatching', updated_at = ?
           where id = ? and status = 'processing' and lease_token = ? and lease_expires_at = ?`
        ).run(now.toISOString(), claim.workItemId, claim.leaseToken, claim.leaseExpiresAt).changes
        if (admitted !== 1) return null
        const receiptUpdated = this.database.connection.prepare(
          `update channel_receipts set status = 'dispatching', updated_at = ?
           where id = ? and generation = ?`
        ).run(now.toISOString(), claim.receiptId, claim.generation).changes
        if (receiptUpdated !== 1) throw new Error('Channel dispatch admission receipt transition failed.')
        return {
          workItemId: row.id,
          receiptId: row.receipt_id,
          channelId: row.channel_id,
          conversationId: row.conversation_id,
          dispatchId: row.dispatch_id,
          generation: row.generation,
          ciphertext: row.payload_ciphertext,
          keyRef: row.payload_key_ref,
          keyRevision: row.payload_key_revision
        }
      }

      // Only a current owner fenced out by lifecycle may quarantine acknowledged work.
      // An expired lease remains recoverable until reclaim assigns a new owner.
      const quarantined = this.database.connection.prepare(
        `update channel_inbound_work_items set status = 'quarantined', lease_expires_at = null, updated_at = ?
         where id = ? and receipt_id = ? and channel_id = ? and status = 'processing' and lease_token = ?
           and exists (
             select 1 from channel_receipts r where r.id = channel_inbound_work_items.receipt_id and r.generation = ?
           )
           and not exists (
             select 1 from channel_runtime_generations g
             join agent_channels c on c.id = g.channel_id
             join agent_entities a on a.id = c.agent_id
             where g.channel_id = channel_inbound_work_items.channel_id
               and g.lifecycle_state = 'active' and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
           )`
      ).run(now.toISOString(), claim.workItemId, claim.receiptId, claim.channelId, claim.leaseToken, claim.generation).changes
      if (quarantined === 1) {
        this.database.connection.prepare(
          'update channel_receipts set status = \'quarantined\', updated_at = ? where id = ? and generation = ?'
        ).run(now.toISOString(), claim.receiptId, claim.generation)
        this.audit(claim.channelId, claim.generation, 'channel-lifecycle-fenced', now)
      }
      return null
    })
  }

  renewDispatchLease(claim: ChannelExecutionClaim, now = new Date(), leaseMs = 60_000): ChannelExecutionClaim | null {
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString()
    return this.database.transact(() => {
      const renewed = this.database.connection.prepare(
        `update channel_inbound_work_items set lease_expires_at = ?, updated_at = ?
         where id = ? and receipt_id = ? and channel_id = ? and dispatch_id = ? and status = 'dispatching'
           and lease_token = ? and lease_expires_at = ? and lease_expires_at > ?
           and exists (
             select 1 from channel_receipts r
             join channel_runtime_generations g on g.channel_id = r.channel_id and g.generation = r.generation
             join agent_channels c on c.id = r.channel_id
             join agent_entities a on a.id = c.agent_id
             where r.id = channel_inbound_work_items.receipt_id and r.generation = ?
               and g.lifecycle_state = 'active' and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
           )`
      ).run(
        leaseExpiresAt, now.toISOString(), claim.workItemId, claim.receiptId, claim.channelId, claim.dispatchId,
        claim.leaseToken, claim.leaseExpiresAt, now.toISOString(), claim.generation
      ).changes
      return renewed === 1 ? { ...claim, leaseExpiresAt } : null
    })
  }

  finalizeDispatch(claim: ChannelExecutionClaim, status: ChannelDispatchFinalStatus, now = new Date()): boolean {
    return this.database.transact(() => {
      const finalized = this.database.connection.prepare(
        `update channel_inbound_work_items set status = ?, lease_token = null, lease_expires_at = null, updated_at = ?
         where id = ? and receipt_id = ? and channel_id = ? and dispatch_id = ? and status = 'dispatching'
           and lease_token = ? and lease_expires_at = ? and lease_expires_at > ?
           and exists (
             select 1 from channel_receipts r
             join channel_runtime_generations g on g.channel_id = r.channel_id and g.generation = r.generation
             join agent_channels c on c.id = r.channel_id
             join agent_entities a on a.id = c.agent_id
             where r.id = channel_inbound_work_items.receipt_id and r.generation = ?
               and g.lifecycle_state = 'active' and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
           )`
      ).run(
        status, now.toISOString(), claim.workItemId, claim.receiptId, claim.channelId, claim.dispatchId,
        claim.leaseToken, claim.leaseExpiresAt, now.toISOString(), claim.generation
      ).changes
      if (finalized !== 1) return false
      const receiptUpdated = this.database.connection.prepare(
        'update channel_receipts set status = ?, updated_at = ? where id = ? and generation = ?'
      ).run(status, now.toISOString(), claim.receiptId, claim.generation).changes
      if (receiptUpdated !== 1) throw new Error('Channel dispatch finalization receipt transition failed.')
      return true
    })
  }

  cleanupChannel(channelId: string, now = new Date(), limit = 500): { receipts: number; workItems: number } {
    const batch = Math.max(1, Math.min(limit, 500))
    const workItems = Number(this.database.connection.prepare(
      `delete from channel_inbound_work_items where id in (
        select id from channel_inbound_work_items where channel_id = ? and (
          (status = 'completed' and updated_at < ?) or (status in ('failed', 'quarantined') and updated_at < ?) or
          (status in ('completed', 'failed', 'quarantined') and id in (
            select id from channel_inbound_work_items
            where channel_id = ? and status in ('completed', 'failed', 'quarantined')
            order by created_at desc, id desc limit -1 offset 10000
          ))
        ) order by updated_at asc, id asc limit ?
      )`
    ).run(channelId, new Date(now.getTime() - 86_400_000).toISOString(), new Date(now.getTime() - 7 * 86_400_000).toISOString(), channelId, batch).changes)
    const receipts = Number(this.database.connection.prepare(
      `delete from channel_receipts where id in (
        select r.id from channel_receipts r
        where r.channel_id = ? and not exists (select 1 from channel_inbound_work_items w where w.receipt_id = r.id)
          and (r.created_at < ? or r.id in (
            select id from channel_receipts where channel_id = ? order by created_at desc, id desc limit -1 offset 100000
          ))
        order by r.created_at asc, r.id asc limit ?
      )`
    ).run(channelId, new Date(now.getTime() - 7 * 86_400_000).toISOString(), channelId, batch).changes)
    return { receipts, workItems }
  }

  cleanupPage(channelId: string, cursor: string | null, now = new Date(), limit = 500): {
    receipts: number
    workItems: number
    nextCursor: string | null
  } {
    const batch = Math.max(1, Math.min(limit, 500))
    const after = decodeCleanupCursor(cursor)
    const cursorWhere = after ? 'where (sort_at > ? or (sort_at = ? and (kind > ? or (kind = ? and id > ?))))' : ''
    const candidates = this.database.connection.prepare(
      `with candidates as (
         select 'work' as kind, id, updated_at as sort_at from channel_inbound_work_items
         where channel_id = ? and (
           (status = 'completed' and updated_at < ?) or
           (status in ('failed', 'quarantined') and updated_at < ?) or
           (status in ('completed', 'failed', 'quarantined') and id in (
             select id from channel_inbound_work_items
             where channel_id = ? and status in ('completed', 'failed', 'quarantined')
             order by created_at desc, id desc limit -1 offset 10000
           ))
         )
         union all
         select 'receipt' as kind, id, created_at as sort_at from channel_receipts r
         where channel_id = ? and not exists (select 1 from channel_inbound_work_items w where w.receipt_id = r.id)
           and created_at < ?
       ) select kind, id, sort_at from candidates ${cursorWhere}
       order by sort_at asc, kind asc, id asc limit ?`
    ).all(
      channelId, new Date(now.getTime() - 86_400_000).toISOString(),
      new Date(now.getTime() - 7 * 86_400_000).toISOString(), channelId,
      channelId, new Date(now.getTime() - 7 * 86_400_000).toISOString(),
      ...(after ? [after.sortAt, after.sortAt, after.kind, after.kind, after.id] : []),
      batch
    ) as Array<{ kind: 'work' | 'receipt'; id: string; sort_at: string }>
    if (candidates.length === 0) return { receipts: 0, workItems: 0, nextCursor: null }
    const workIds = candidates.filter((item) => item.kind === 'work').map((item) => item.id)
    const receiptIds = candidates.filter((item) => item.kind === 'receipt').map((item) => item.id)
    this.database.transact(() => {
      if (workIds.length > 0) this.database.connection.prepare(`delete from channel_inbound_work_items where id in (${workIds.map(() => '?').join(', ')})`).run(...workIds)
      if (receiptIds.length > 0) this.database.connection.prepare(`delete from channel_receipts where id in (${receiptIds.map(() => '?').join(', ')})`).run(...receiptIds)
    })
    const tail = candidates[candidates.length - 1]
    return {
      receipts: receiptIds.length,
      workItems: workIds.length,
      nextCursor: candidates.length === batch ? encodeCleanupCursor(tail) : null
    }
  }

  private hasWorkItem(receiptId: string): boolean {
    return Boolean(this.database.connection.prepare('select 1 from channel_inbound_work_items where receipt_id = ?').get(receiptId))
  }

  private quarantineOrphanReceipts(now: Date, limit: number): void {
    const rows = this.database.connection.prepare(
      `select id, channel_id, generation from channel_receipts r
       where r.status in ('processing', 'dispatching') and not exists (select 1 from channel_inbound_work_items w where w.receipt_id = r.id)
       order by r.updated_at asc, r.id asc limit ?`
    ).all(Math.max(1, Math.min(limit, 500))) as Array<{ id: string; channel_id: string; generation: number }>
    this.database.transact(() => {
      for (const row of rows) {
        this.updateReceipt(row.id, 'quarantined', now)
        this.audit(row.channel_id, row.generation, 'channel-receipt-without-work-item', now)
      }
    })
  }

  private quarantineIneligibleWork(now: Date, limit: number): void {
    const rows = this.database.connection.prepare(
      `select w.id, w.receipt_id, w.channel_id, r.generation from channel_inbound_work_items w
       join channel_receipts r on r.id = w.receipt_id
       where w.status in ('processing', 'dispatching', 'unknown-after-restart') and (w.lease_expires_at is null or w.lease_expires_at <= ?)
         and not exists (
           select 1 from channel_runtime_generations g
           join agent_channels c on c.id = g.channel_id
           join agent_entities a on a.id = c.agent_id
           where g.channel_id = w.channel_id and g.lifecycle_state = 'active'
             and ${SUPPORTED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
         )
       order by w.lease_expires_at asc, w.id asc limit ?`
    ).all(now.toISOString(), Math.max(1, Math.min(limit, 500))) as Array<{ id: string; receipt_id: string; channel_id: string; generation: number }>
    this.database.transact(() => {
      for (const row of rows) {
        this.database.connection.prepare("update channel_inbound_work_items set status = 'quarantined', lease_expires_at = null, updated_at = ? where id = ?").run(now.toISOString(), row.id)
        this.updateReceipt(row.receipt_id, 'quarantined', now)
        this.audit(row.channel_id, row.generation, 'channel-lifecycle-fenced', now)
      }
    })
  }

  private updateReceipt(receiptId: string, status: string, now: Date): void {
    this.database.connection.prepare('update channel_receipts set status = ?, updated_at = ? where id = ?').run(status, now.toISOString(), receiptId)
  }

  private audit(channelId: string, generation: number, code: ChannelInboundAuditCode, now: Date): void {
    this.database.connection.prepare(
      'insert into channel_runtime_audits (id, channel_id, generation, code, created_at) values (?, ?, ?, ?, ?)'
    ).run(randomUUID(), channelId, generation, code, now.toISOString())
  }
}

type ConversationRow = {
  id: string; channel_id: string; conversation_key_ciphertext: Uint8Array; conversation_key_ref: string
  conversation_key_revision: number; conversation_key_hash: string; conversation_kind: ChannelConversationKind; agent_session_id: string | null
}
type WorkRow = {
  id: string; receipt_id: string; channel_id: string; conversation_id: string; dispatch_id: string; payload_ciphertext: Uint8Array
  payload_key_ref: string; payload_key_revision: number; status: ChannelWorkItemRecord['status']; lease_token: string | null; lease_expires_at: string | null; attempt_count: number
}
type DispatchAdmissionRow = {
  id: string; receipt_id: string; channel_id: string; conversation_id: string; dispatch_id: string
  payload_ciphertext: Uint8Array; payload_key_ref: string; payload_key_revision: number; generation: number
}
type InitialClaimRow = {
  id: string; receipt_id: string; channel_id: string; dispatch_id: string; lease_token: string; lease_expires_at: string; generation: number
}

function mapConversation(row: ConversationRow): ChannelConversationRecord {
  return { id: row.id, channelId: row.channel_id, keyCiphertext: row.conversation_key_ciphertext, keyRef: row.conversation_key_ref, keyRevision: row.conversation_key_revision, keyHash: row.conversation_key_hash, kind: row.conversation_kind, sessionId: row.agent_session_id }
}
function encodeCleanupCursor(value: { kind: 'work' | 'receipt'; id: string; sort_at: string }): string {
  return Buffer.from(JSON.stringify({ sortAt: value.sort_at, kind: value.kind, id: value.id })).toString('base64url')
}

function decodeCleanupCursor(value: string | null): { sortAt: string; kind: 'work' | 'receipt'; id: string } | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Record<string, unknown>
    if ((parsed.kind !== 'work' && parsed.kind !== 'receipt') || typeof parsed.sortAt !== 'string' || typeof parsed.id !== 'string') return null
    return { sortAt: parsed.sortAt, kind: parsed.kind, id: parsed.id }
  } catch {
    return null
  }
}
