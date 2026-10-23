import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { AgentChannelType } from '../schemas/channelSchemas'
import { blockedRuntimeChannelSql, isLarkPublicConfig, isolatedFeishuSql, isolatedWechatSql, managedChannelSql } from './ChannelManagementPredicates'
import { ChannelManagementQueryRepository } from './ChannelManagementQueryRepository'

const MANAGED_CHANNEL_SQL = managedChannelSql()
const MANAGED_CHANNEL_C_SQL = managedChannelSql('c')
const MANAGED_CHANNEL_CH_SQL = managedChannelSql('ch')
const ISOLATED_FEISHU_C_SQL = isolatedFeishuSql('c')
const ISOLATED_WECHAT_C_SQL = isolatedWechatSql('c')
const BLOCKED_RUNTIME_C_SQL = blockedRuntimeChannelSql('c')

export type ChannelManagementOperation = {
  id: string
  channelId: string
  purpose: 'provision' | 'rotate' | 'delete'
  ref: string
  fingerprint: string | null
  keyId: string | null
  permit: string | null
  expectedRevision: number | null
  payloadKeyRefs: string[] | null
  legacyMigrations: LegacyMigrationRef[] | null
  lifecycleOwnerToken: string | null
  mutationEpoch: number | null
  credentialCleanupRefs: CredentialCleanupRef[] | null
  state: 'reserved' | 'needs-recovery' | 'external-inflight' | 'revoked-inflight' | 'revoked-cleanup' | 'completed' | 'abandoned' | 'superseded'
}

export type CredentialCleanupRef = {
  purpose: 'provision' | 'rotate'
  ref: string
  fingerprint: string | null
  keyId: string | null
  permit: string | null
  expectedRevision: number | null
}

export type LegacyMigrationRef = {
  purpose: 'provider-credential' | 'legacy-discovery-archive'
  type: 'telegram' | 'wechat'
  ref: string
  fingerprint: string
  keyId: string
  permit: string
}

export type TelegramLifecycleOwner = { token: string; purpose: 'enable' | 'restart' | 'mutation'; generation: number | null; epoch?: number | null }

export function hasValidDeleteKnownRefs(operation: Pick<ChannelManagementOperation, 'channelId' | 'ref' | 'payloadKeyRefs' | 'legacyMigrations'>): boolean {
  return (operation.ref === '' || isProviderRefForChannel(operation.ref, operation.channelId)) &&
    operation.payloadKeyRefs !== null &&
    operation.payloadKeyRefs.every((ref) => isPayloadKeyRefForChannel(ref, operation.channelId)) &&
    operation.legacyMigrations !== null &&
    operation.legacyMigrations.every((migration) => isValidLegacyMigrationRef(migration, operation.channelId)) &&
    uniqueMigrationRefs(operation.legacyMigrations)
}

export class ChannelManagementRepository {
  readonly query: ChannelManagementQueryRepository

  constructor(private readonly database: AgentPlatformDatabase) {
    this.query = new ChannelManagementQueryRepository(database)
  }

  agentExists(agentId: string): boolean {
    return Boolean(this.database.connection.prepare('select 1 from agent_entities where id = ?').get(agentId))
  }

  create(input: { id: string; type?: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat'; name: string; agentId: string; now: string }): boolean {
    return this.database.connection
      .prepare(
        `insert into agent_channels (
          id, type, name, agent_id, public_config_json, requested_enabled, migration_state, created_at, updated_at
        ) select ?, ?, ?, ?, ?, 0, 'credential-missing', ?, ?
          where not exists (select 1 from channel_management_tombstones where channel_id = ?)`
      )
      .run(input.id, input.type ?? 'telegram', input.name, input.agentId, input.type === 'feishu' ? '{"domain":"lark"}' : '{}', input.now, input.now, input.id).changes === 1
  }

  channelType(id: string): 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat' | null {
    const row = this.database.connection.prepare(
      `select type from agent_channels where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state not in ('deleting','legacy')`
    ).get(id) as { type: AgentChannelType } | undefined
    return row?.type === 'telegram' || row?.type === 'slack' || row?.type === 'feishu' || row?.type === 'qq' || row?.type === 'discord' || row?.type === 'wechat' ? row.type : null
  }

  /** Recovery may identify a deleting Channel only to consume its already-journaled Vault capability. */
  knownChannelType(id: string): 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat' | null {
    const row = this.database.connection.prepare(
      `select type from agent_channels where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state <> 'legacy'`
    ).get(id) as { type: AgentChannelType } | undefined
    return row?.type === 'telegram' || row?.type === 'slack' || row?.type === 'feishu' || row?.type === 'qq' || row?.type === 'discord' || row?.type === 'wechat' ? row.type : null
  }

  /** A WeChat storage row never has a generic credential recovery path in Release F. */
  isWechatStorageChannel(id: string): boolean {
    return Boolean(this.database.connection.prepare(`select 1 from agent_channels where id = ? and type = 'wechat'`).get(id))
  }

  isStrictWechatChannel(id: string): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from agent_channels where id = ? and type = 'wechat' and public_config_json = '{}'`
    ).get(id))
  }

  update(id: string, input: { name: string; agentId: string; now: string }): boolean {
    return this.database.transact(() => {
      this.invalidateLifecycleOwner(id)
      const changed = this.database.connection
        .prepare(
          `update agent_channels
           set name = ?, agent_id = ?, requested_enabled = 0, migration_state = 'disabled', updated_at = ?
           where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state not in ('deleting', 'legacy')`
        )
        .run(input.name, input.agentId, input.now, id).changes
      if (changed) this.fence(id, input.now)
      return changed === 1
    })
  }

  disable(id: string, now: string): boolean {
    return this.database.transact(() => {
      this.invalidateLifecycleOwner(id)
      const changed = this.database.connection
        .prepare(
          `update agent_channels
           set requested_enabled = 0, migration_state = 'disabled', updated_at = ?
           where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state not in ('deleting', 'legacy')`
        )
        .run(now, id).changes
      if (changed) this.fence(id, now)
      return changed === 1
    })
  }

  credentialMetadata(id: string): { ref: string; revision: number } | null {
    const row = this.database.connection
      .prepare(
        `select credential_ref, credential_revision from agent_channels
         where id = ? and ${MANAGED_CHANNEL_SQL} and type <> 'wechat' and migration_state not in ('deleting', 'legacy')`
      )
      .get(id) as { credential_ref: string | null; credential_revision: number | null } | undefined
    return row?.credential_ref && row.credential_revision !== null
      ? { ref: row.credential_ref, revision: row.credential_revision }
      : null
  }

  setCredential(input: {
    id: string; ref: string; revision: number; expectedRevision: number | null; now: string
    owner?: TelegramLifecycleOwner
  }): boolean {
    const expected = input.expectedRevision
    const changed = this.database.transact(() => {
      const result = this.database.connection
      .prepare(
        `update agent_channels
         set credential_ref = ?, credential_revision = ?, requested_enabled = 0,
             migration_state = 'configuration-ready', credential_health = 'configured', migration_error_code = null, updated_at = ?
         where id = ? and ${MANAGED_CHANNEL_SQL} and type <> 'wechat' and migration_state not in ('deleting', 'legacy')
           and ((? is null and credential_revision is null) or credential_revision = ?)
           ${input.owner ? `and exists (
             select 1 from channel_telegram_lifecycle_operations o
             where o.channel_id = agent_channels.id and o.owner_token = ?
               and o.purpose = 'mutation' and o.generation is null
           )` : ''}`
      )
      .run(input.ref, input.revision, input.now, input.id, expected, expected, ...(input.owner ? [input.owner.token] : [])).changes
      if (result) this.fence(input.id, input.now)
      return result
    })
    return changed === 1
  }

  reserveOperation(input: {
    id: string
    channelId: string
    purpose: ChannelManagementOperation['purpose']
    ref: string
    fingerprint?: string
    keyId?: string
    permit?: string
    expectedRevision?: number
    owner?: TelegramLifecycleOwner
    now: string
  }): boolean {
    const ownerColumn = input.owner ? ', lifecycle_owner_token' : ''
    const ownerValue = input.owner ? ', ?' : ''
    const ownerGate = input.owner
      ? `and exists (
          select 1 from channel_telegram_lifecycle_operations o
          where o.channel_id = ? and o.owner_token = ? and o.purpose = 'mutation' and o.generation is null
        ) and exists (
          select 1 from agent_channels c where c.id = ? and c.mutation_epoch = ?
        )`
      : ''
    return this.database.connection
      .prepare(
        `insert into channel_management_operations (
          id, channel_id, purpose, credential_ref, source_fingerprint, fingerprint_key_id,
          operation_permit, expected_revision, state, created_at, updated_at
          ${ownerColumn}${input.owner ? ', mutation_epoch' : ''}
        ) select ?, ?, ?, ?, ?, ?, ?, ?, 'reserved', ?, ?${ownerValue}${input.owner ? ', ?' : ''}
          where exists (
            select 1 from agent_channels
            where id = ? and ${MANAGED_CHANNEL_SQL}
              and (type <> 'wechat' or ? = 'delete')
              and migration_state not in ('deleting', 'legacy')
          ) ${ownerGate}`
      )
      .run(
        input.id,
        input.channelId,
        input.purpose,
        input.ref,
        input.fingerprint ?? null,
        input.keyId ?? null,
        input.permit ?? null,
        input.expectedRevision ?? null,
        input.now,
        input.now,
        ...(input.owner ? [input.owner.token] : []),
        ...(input.owner ? [input.owner.epoch ?? null] : []),
        input.channelId,
        input.purpose,
        ...(input.owner ? [input.channelId, input.owner.token, input.channelId, input.owner.epoch ?? -1] : [])
      ).changes === 1
  }

  private reserveDeleteOperation(input: {
    id: string; channelId: string; ref: string; expectedRevision?: number; payloadKeyRefs: string[]
    legacyMigrations: LegacyMigrationRef[]; credentialCleanupRefs: CredentialCleanupRef[]; now: string
  }): void {
    this.database.connection.prepare(
      `insert into channel_management_operations (id, channel_id, purpose, credential_ref, expected_revision, payload_key_refs_json, legacy_migrations_json, credential_cleanup_refs_json, state, created_at, updated_at)
       values (?, ?, 'delete', ?, ?, ?, ?, ?, 'reserved', ?, ?)`
    ).run(input.id, input.channelId, input.ref, input.expectedRevision ?? null, JSON.stringify(input.payloadKeyRefs), JSON.stringify(input.legacyMigrations), JSON.stringify(input.credentialCleanupRefs), input.now, input.now)
  }

  beginDelete(id: string, operationId: string, now: string): ChannelManagementOperation | null {
    return this.database.transact(() => {
      const row = this.database.connection
        .prepare(
          `select type, public_config_json, credential_ref, credential_revision from agent_channels
           where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state not in ('deleting', 'legacy')`
        )
        .get(id) as { type: string; public_config_json: string; credential_ref: string | null; credential_revision: number | null } | undefined
      if (!row) return null
      if (row.type === 'wechat' && row.public_config_json === '{}') return this.beginStrictWechatDelete(id, operationId, now)

      const pending = this.database.connection
        .prepare(
          `select purpose, credential_ref, source_fingerprint, fingerprint_key_id, operation_permit, expected_revision from channel_management_operations
           where channel_id = ? and purpose in ('provision', 'rotate')
             and state in ('reserved', 'needs-recovery', 'external-inflight', 'revoked-inflight', 'revoked-cleanup')
           order by updated_at desc, id desc`
        )
        .all(id) as Array<{
          credential_ref: string | null; source_fingerprint: string | null; fingerprint_key_id: string | null
          purpose: 'provision' | 'rotate'; operation_permit: string | null; expected_revision: number | null
        }>
      if (!pending.every((operation) => isValidPendingCredentialOperation(operation, id))) throw new Error('channel-delete-known-ref-invalid')
      const cleanupRefs = pending.map((operation) => ({
        purpose: operation.purpose, ref: operation.credential_ref!, fingerprint: operation.source_fingerprint,
        keyId: operation.fingerprint_key_id, permit: operation.operation_permit, expectedRevision: operation.expected_revision
      }))
      const newestPending = pending[0]
      const knownRef = row.credential_ref ?? newestPending?.credential_ref ?? null
      const knownRevision = row.credential_revision ?? newestPending?.expected_revision ?? null
      if (knownRef && !isProviderRefForChannel(knownRef, id)) throw new Error('channel-delete-known-ref-invalid')
      const payloadKeyRefs = this.knownPayloadKeyRefs(id)
      if (!payloadKeyRefs.every((ref) => isPayloadKeyRefForChannel(ref, id))) throw new Error('channel-delete-known-ref-invalid')
      const legacyMigrations = this.knownLegacyMigrations(id)
      if (legacyMigrations === null) throw new Error('channel-delete-known-ref-invalid')
      this.invalidateLifecycleOwner(id)
      this.database.connection
        .prepare(
          `update agent_channels set requested_enabled = 0, migration_state = 'deleting', updated_at = ? where id = ?`
        )
        .run(now, id)
      this.fence(id, now)
      this.database.connection
        .prepare(`update channel_management_operations set state = 'revoked-cleanup', updated_at = ?
          where channel_id = ? and state in ('reserved', 'needs-recovery') and purpose in ('provision', 'rotate')`)
        .run(now, id)
      this.clearC03Rows(id)
      this.reserveDeleteOperation({
        id: operationId,
        channelId: id,
        ref: knownRef ?? '',
        expectedRevision: knownRevision ?? undefined,
        payloadKeyRefs,
        legacyMigrations,
        credentialCleanupRefs: cleanupRefs,
        now
      })
      return {
        id: operationId,
        channelId: id,
        purpose: 'delete',
        ref: knownRef ?? '',
        fingerprint: null,
        keyId: null,
        permit: null,
        expectedRevision: knownRevision,
        payloadKeyRefs,
        legacyMigrations,
        lifecycleOwnerToken: null,
        mutationEpoch: null,
        credentialCleanupRefs: cleanupRefs,
        state: 'reserved'
      }
    })
  }

  /** Release F deletes its QR-only carrier locally; forged credential records never cross into Vault cleanup. */
  private beginStrictWechatDelete(id: string, operationId: string, now: string): ChannelManagementOperation {
    const payloadKeyRefs = this.knownPayloadKeyRefs(id)
    if (!payloadKeyRefs.every((ref) => isPayloadKeyRefForChannel(ref, id))) throw new Error('channel-delete-known-ref-invalid')
    this.invalidateLifecycleOwner(id)
    this.database.connection.prepare(
      `update channel_management_operations set state = 'abandoned', operation_permit = null,
         stable_error_code = 'channel-credential-unsupported', updated_at = ?
       where channel_id = ? and purpose in ('provision', 'rotate')
         and state in ('reserved', 'needs-recovery', 'external-inflight', 'revoked-inflight', 'revoked-cleanup')`
    ).run(now, id)
    this.database.connection.prepare(
      `update agent_channels set credential_ref = null, credential_revision = null, credential_health = 'missing',
         requested_enabled = 0, migration_state = 'deleting', migration_error_code = 'channel-credential-unsupported', updated_at = ?
       where id = ? and type = 'wechat' and public_config_json = '{}'`
    ).run(now, id)
    this.fence(id, now)
    this.clearC03Rows(id)
    this.reserveDeleteOperation({ id: operationId, channelId: id, ref: '', payloadKeyRefs, legacyMigrations: [], credentialCleanupRefs: [], now })
    return {
      id: operationId, channelId: id, purpose: 'delete', ref: '', fingerprint: null, keyId: null, permit: null,
      expectedRevision: null, payloadKeyRefs, legacyMigrations: [], lifecycleOwnerToken: null,
      mutationEpoch: null, credentialCleanupRefs: [], state: 'reserved'
    }
  }

  completeDelete(channelId: string, operationId: string): boolean {
    return this.database.transact(() => {
      if (this.hasUnsettledCredentialCompensation(channelId)) return false
      const operation = this.database.connection.prepare(
        `select 1 from channel_management_operations
         where id = ? and channel_id = ? and purpose = 'delete' and state in ('reserved', 'needs-recovery')`
      ).get(operationId, channelId)
      if (!operation) return false
      this.clearC03Rows(channelId)
      this.database.connection.prepare(`delete from channel_management_operations where channel_id = ?`).run(channelId)
      const removed = this.database.connection.prepare(`delete from agent_channels where id = ? and migration_state = 'deleting'`).run(channelId).changes
      if (removed !== 1) throw new Error('channel delete finalization failed')
      this.database.connection.prepare(`insert or ignore into channel_management_tombstones(channel_id,deleted_at) values(?,?)`).run(channelId, new Date().toISOString())
      return true
    })
  }

  completeOperation(id: string, now: string, owner?: TelegramLifecycleOwner): boolean {
    return this.database.transact(() => {
      const completed = this.database.connection
        .prepare(`update channel_management_operations set state = 'completed', operation_permit = null, updated_at = ?
          where id = ? ${owner ? `and lifecycle_owner_token = ? and exists (
            select 1 from channel_telegram_lifecycle_operations o
            where o.channel_id = channel_management_operations.channel_id and o.owner_token = ?
              and o.purpose = 'mutation' and o.generation is null
          )` : ''}`)
        .run(now, id, ...(owner ? [owner.token, owner.token] : [])).changes
      if (completed && owner) this.database.connection.prepare(
        `delete from channel_telegram_lifecycle_operations
         where channel_id = (select channel_id from channel_management_operations where id = ?)
           and owner_token = ? and purpose = 'mutation' and generation is null`
      ).run(id, owner.token)
      return completed === 1
    })
  }

  deferOperation(id: string, code: string, now: string, owner?: TelegramLifecycleOwner): boolean {
    return this.database.connection
      .prepare(`update channel_management_operations
        set state = case when state in ('external-inflight', 'revoked-inflight', 'revoked-cleanup')
          then 'revoked-cleanup' else 'needs-recovery' end,
          stable_error_code = ?, updated_at = ?
        where id = ? ${owner ? `and lifecycle_owner_token = ? and exists (
          select 1 from channel_telegram_lifecycle_operations o
          where o.channel_id = channel_management_operations.channel_id and o.owner_token = ?
            and o.purpose = 'mutation' and o.generation is null
        )` : ''}`)
      .run(code, now, id, ...(owner ? [owner.token, owner.token] : [])).changes === 1
  }

  /** Keeps the known journal for diagnostics, but makes a superseded continuation unrecoverable. */
  markOwnedOperationRevoked(id: string, owner: TelegramLifecycleOwner, now: string): boolean {
    return this.database.connection.prepare(
      `update channel_management_operations set state = 'revoked-cleanup',
         stable_error_code = 'channel-mutation-revoked', updated_at = ?
       where id = ? and lifecycle_owner_token = ? and state in ('reserved', 'needs-recovery')`
    ).run(now, id, owner.token).changes === 1
  }

  beginExternalCredentialCall(id: string, owner: TelegramLifecycleOwner, now: string): boolean {
    return this.database.connection.prepare(
      `update channel_management_operations set state = 'external-inflight', updated_at = ?
       where id = ? and lifecycle_owner_token = ? and state = 'reserved' and exists (
         select 1 from channel_telegram_lifecycle_operations o
         where o.channel_id = channel_management_operations.channel_id and o.owner_token = ?
           and o.purpose = 'mutation' and o.generation is null
       )`
    ).run(now, id, owner.token, owner.token).changes === 1
  }

  markOperationExternalResult(id: string, result: Pick<CredentialCleanupRef, 'expectedRevision'>, now: string): boolean {
    return this.database.connection.prepare(
      `update channel_management_operations set expected_revision = coalesce(?, expected_revision),
         state = 'revoked-cleanup', stable_error_code = 'channel-mutation-revoked', updated_at = ?
       where id = ? and state in ('reserved', 'needs-recovery', 'external-inflight', 'revoked-inflight', 'revoked-cleanup')`
    ).run(result.expectedRevision, now, id).changes === 1
  }

  completeRevokedOperation(id: string, now: string): boolean {
    return this.database.connection.prepare(
      `update channel_management_operations set state = 'completed', operation_permit = null,
         stable_error_code = 'channel-mutation-revoked-cleaned', updated_at = ?
       where id = ? and state in ('external-inflight', 'revoked-cleanup', 'revoked-inflight')`
    ).run(now, id).changes === 1
  }

  /** An observed rotate revision without this journal's Vault receipt is never adopted. */
  completeUnattributedRotation(operation: ChannelManagementOperation, now: string): boolean {
    return this.database.connection.prepare(
      `update channel_management_operations set state = 'completed', operation_permit = null,
         stable_error_code = 'channel-credential-mutation-unattributed', updated_at = ?
       where id = ? and channel_id = ? and purpose = 'rotate'
         and state in ('external-inflight', 'revoked-cleanup', 'revoked-inflight')`
    ).run(now, operation.id, operation.channelId).changes === 1
  }

  operation(id: string): ChannelManagementOperation | null {
    return this.pendingOperations().find((operation) => operation.id === id) ?? null
  }

  hasUnsettledCredentialCompensation(channelId: string): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from channel_management_operations
       where channel_id = ? and purpose in ('provision', 'rotate')
         and state in ('external-inflight', 'revoked-inflight', 'revoked-cleanup')`
    ).get(channelId))
  }

  hasInFlightCredentialCleanup(channelId: string): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from channel_management_operations
       where channel_id = ? and purpose in ('provision', 'rotate')
         and state in ('external-inflight', 'revoked-inflight')`
    ).get(channelId))
  }

  completeCredentialCompensations(channelId: string, now: string): void {
    this.database.connection.prepare(
      `update channel_management_operations set state = 'completed', operation_permit = null,
         stable_error_code = 'channel-mutation-revoked-cleaned', updated_at = ?
       where channel_id = ? and purpose in ('provision', 'rotate') and state = 'revoked-cleanup'`
    ).run(now, channelId)
  }

  credentialReferences(channelId: string, ref: string, revision?: number): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from agent_channels where id = ? and credential_ref = ? and migration_state not in ('deleting', 'legacy')
       ${revision === undefined ? '' : 'and credential_revision = ?'}`
    ).get(channelId, ref, ...(revision === undefined ? [] : [revision])))
  }

  /** A revoked rotate may advance Vault first; reconcile only the exact old metadata revision and never re-enable. */
  settleRevokedRotation(operation: ChannelManagementOperation, observedRevision: number, now: string): boolean {
    if (operation.mutationEpoch === null) return false
    return this.database.connection.prepare(
      `update agent_channels set credential_revision = ?, requested_enabled = 0,
         credential_health = 'configured', migration_error_code = null, updated_at = ?
       where id = ? and ${MANAGED_CHANNEL_SQL} and credential_ref = ? and credential_revision = ?
         and mutation_epoch = ? and migration_state not in ('deleting', 'legacy', 'runtime-ready')
         and not exists (select 1 from channel_telegram_lifecycle_operations o where o.channel_id = agent_channels.id)
         and exists (select 1 from channel_management_operations op where op.id = ? and op.channel_id = agent_channels.id
           and op.purpose = 'rotate' and op.lifecycle_owner_token = ? and op.mutation_epoch = ?
           and op.state in ('external-inflight', 'revoked-cleanup', 'revoked-inflight'))`
    ).run(observedRevision, now, operation.channelId, operation.ref, operation.expectedRevision, operation.mutationEpoch,
      operation.id, operation.lifecycleOwnerToken, operation.mutationEpoch).changes === 1
  }

  /** Recovers an interrupted external rotate only while its persisted mutation owner is still exact. */
  settleOwnedCrashedRotation(operation: ChannelManagementOperation, observedRevision: number, now: string): boolean {
    if (!operation.lifecycleOwnerToken || operation.mutationEpoch === null) return false
    return this.database.transact(() => {
      const updated = this.database.connection.prepare(
        `update agent_channels set credential_revision = ?, requested_enabled = 0,
           credential_health = 'configured', migration_error_code = null, updated_at = ?
         where id = ? and ${MANAGED_CHANNEL_SQL} and credential_ref = ? and credential_revision = ?
           and mutation_epoch = ? and migration_state not in ('deleting', 'legacy', 'runtime-ready')
           and exists (select 1 from channel_telegram_lifecycle_operations o
             where o.channel_id = agent_channels.id and o.owner_token = ? and o.purpose = 'mutation' and o.generation is null)
           and exists (select 1 from channel_management_operations op
             where op.id = ? and op.channel_id = agent_channels.id and op.purpose = 'rotate'
               and op.lifecycle_owner_token = ? and op.mutation_epoch = ? and op.state = 'external-inflight')`
      ).run(observedRevision, now, operation.channelId, operation.ref, operation.expectedRevision, operation.mutationEpoch,
        operation.lifecycleOwnerToken, operation.id, operation.lifecycleOwnerToken, operation.mutationEpoch).changes
      if (updated !== 1) return false
      const completed = this.database.connection.prepare(
        `update channel_management_operations set state = 'completed', operation_permit = null,
           stable_error_code = 'channel-credential-crash-recovered', updated_at = ?
         where id = ? and state = 'external-inflight' and lifecycle_owner_token = ? and mutation_epoch = ?`
      ).run(now, operation.id, operation.lifecycleOwnerToken, operation.mutationEpoch).changes
      if (completed !== 1) throw new Error('channel management recovery completion failed')
      const cleared = this.database.connection.prepare(
        `delete from channel_telegram_lifecycle_operations
         where channel_id = ? and owner_token = ? and purpose = 'mutation' and generation is null`
      ).run(operation.channelId, operation.lifecycleOwnerToken).changes
      if (cleared !== 1) throw new Error('channel management recovery owner changed')
      return true
    })
  }

  /** Releases only an exact crash owner when its external outcome cannot safely be attributed. */
  releaseOwnedCrashedOperation(operation: ChannelManagementOperation, code: string, now: string): boolean {
    if (!operation.lifecycleOwnerToken || operation.mutationEpoch === null) return false
    return this.database.transact(() => {
      const owner = this.database.connection.prepare(
        `select 1 from channel_telegram_lifecycle_operations o
         join agent_channels c on c.id = o.channel_id
         join channel_management_operations op on op.channel_id = c.id
         where o.channel_id = ? and o.owner_token = ? and o.purpose = 'mutation' and o.generation is null
           and c.mutation_epoch = ? and op.id = ? and op.lifecycle_owner_token = ?
           and op.mutation_epoch = ? and op.state = 'external-inflight'`
      ).get(operation.channelId, operation.lifecycleOwnerToken, operation.mutationEpoch, operation.id,
        operation.lifecycleOwnerToken, operation.mutationEpoch)
      if (!owner) return false
      this.database.connection.prepare(
        `update agent_channels set requested_enabled = 0, credential_health = 'unavailable',
           migration_error_code = ?, updated_at = ?
         where id = ? and ${MANAGED_CHANNEL_SQL} and mutation_epoch = ?
           and migration_state not in ('deleting', 'legacy', 'runtime-ready')`
      ).run(code, now, operation.channelId, operation.mutationEpoch)
      this.database.connection.prepare(
        `update channel_management_operations set state = 'completed', operation_permit = null,
           stable_error_code = ?, updated_at = ? where id = ? and state = 'external-inflight'
             and lifecycle_owner_token = ? and mutation_epoch = ?`
      ).run(code, now, operation.id, operation.lifecycleOwnerToken, operation.mutationEpoch)
      this.database.connection.prepare(
        `delete from channel_telegram_lifecycle_operations
         where channel_id = ? and owner_token = ? and purpose = 'mutation' and generation is null`
      ).run(operation.channelId, operation.lifecycleOwnerToken)
      return true
    })
  }

  markRevokedRotationUnavailable(operation: ChannelManagementOperation, now: string): void {
    if (operation.mutationEpoch === null) return
    this.database.connection.prepare(
      `update agent_channels set requested_enabled = 0, credential_health = 'unavailable',
         migration_error_code = 'channel-credential-revision-advanced', updated_at = ?
       where id = ? and ${MANAGED_CHANNEL_SQL} and credential_ref = ? and mutation_epoch = ?
         and migration_state not in ('deleting', 'legacy', 'runtime-ready')
         and not exists (select 1 from channel_telegram_lifecycle_operations o where o.channel_id = agent_channels.id)`
    ).run(now, operation.channelId, operation.ref, operation.mutationEpoch)
  }

  /** Completes a crashed live mutation only after its durable metadata already matches the known Vault view. */
  completeRecoveredCredentialOperation(operation: ChannelManagementOperation, safe: { credentialRef: string; revision: number }, now: string): boolean {
    return this.database.transact(() => {
      const metadata = this.database.connection.prepare(
        `select 1 from agent_channels
         where id = ? and ${MANAGED_CHANNEL_SQL} and credential_ref = ? and credential_revision = ?
           and migration_state = 'configuration-ready'`
      ).get(operation.channelId, safe.credentialRef, safe.revision)
      if (!metadata) return false
      const completed = this.database.connection.prepare(
        `update channel_management_operations set state = 'completed', operation_permit = null, updated_at = ?
         where id = ? and channel_id = ? and state in ('reserved', 'needs-recovery', 'external-inflight')`
      ).run(now, operation.id, operation.channelId).changes
      if (completed && operation.lifecycleOwnerToken) this.database.connection.prepare(
        `delete from channel_telegram_lifecycle_operations
         where channel_id = ? and owner_token = ? and purpose = 'mutation' and generation is null`
      ).run(operation.channelId, operation.lifecycleOwnerToken)
      return completed === 1
    })
  }

  setRecoveredCredential(operation: ChannelManagementOperation, safe: { credentialRef: string; revision: number }, now: string): boolean {
    const expected = operation.purpose === 'provision' ? null : operation.expectedRevision
    return this.database.transact(() => {
      const updated = this.database.connection.prepare(
        `update agent_channels set credential_ref = ?, credential_revision = ?, requested_enabled = 0,
           migration_state = 'configuration-ready', credential_health = 'configured', migration_error_code = null, updated_at = ?
         where id = ? and ${MANAGED_CHANNEL_SQL} and type <> 'wechat' and migration_state not in ('deleting', 'legacy')
           and ((? is null and credential_revision is null) or credential_revision = ?)
           and exists (
             select 1 from channel_management_operations o
            where o.id = ? and o.channel_id = agent_channels.id and o.state in ('reserved', 'needs-recovery', 'external-inflight')
           )`
      ).run(safe.credentialRef, safe.revision, now, operation.channelId, expected, expected, operation.id).changes
      if (updated) this.fence(operation.channelId, now)
      return updated === 1
    })
  }

  abandonOperation(id: string, code: string, now: string): void {
    this.database.connection
      .prepare(`update channel_management_operations set state = 'abandoned', operation_permit = null, stable_error_code = ?, updated_at = ? where id = ?`)
      .run(code, now, id)
  }

  pendingOperations(): ChannelManagementOperation[] {
    return (
      this.database.connection
        .prepare(
          `select id, channel_id, purpose, credential_ref, source_fingerprint, fingerprint_key_id, operation_permit, expected_revision, payload_key_refs_json, legacy_migrations_json, lifecycle_owner_token, mutation_epoch, credential_cleanup_refs_json, state
           from channel_management_operations
           where state in ('reserved', 'needs-recovery', 'external-inflight', 'revoked-cleanup', 'revoked-inflight')
           order by updated_at asc, id asc limit 100`
        )
        .all() as Array<{
          id: string
          channel_id: string
          purpose: ChannelManagementOperation['purpose']
          credential_ref: string
          source_fingerprint: string | null
          fingerprint_key_id: string | null
          operation_permit: string | null
          expected_revision: number | null
          payload_key_refs_json: string
          legacy_migrations_json: string
          lifecycle_owner_token: string | null
          mutation_epoch: number | null
          credential_cleanup_refs_json: string
          state: ChannelManagementOperation['state']
        }>
    ).map((row) => ({
      id: row.id,
      channelId: row.channel_id,
      purpose: row.purpose,
      ref: row.credential_ref,
      fingerprint: row.source_fingerprint,
      keyId: row.fingerprint_key_id,
      permit: row.operation_permit,
      expectedRevision: row.expected_revision,
      payloadKeyRefs: parsePayloadKeyRefs(row.payload_key_refs_json, row.channel_id),
      legacyMigrations: parseLegacyMigrations(row.legacy_migrations_json, row.channel_id),
      lifecycleOwnerToken: row.lifecycle_owner_token,
      mutationEpoch: row.mutation_epoch,
      credentialCleanupRefs: parseCredentialCleanupRefs(row.credential_cleanup_refs_json, row.channel_id),
      state: row.state
    }))
  }

  hasPendingCredentialOperation(channelId: string): boolean {
    return Boolean(this.database.connection
      .prepare(`select 1 from channel_management_operations
        where channel_id = ? and purpose in ('provision', 'rotate') and state in ('reserved', 'needs-recovery')`)
      .get(channelId))
  }

  beginLifecycleOwner(channelId: string, purpose: TelegramLifecycleOwner['purpose'], token: string, now: string): TelegramLifecycleOwner | null {
    return this.database.transact(() => {
      if (purpose === 'restart') return this.replaceActiveRuntimeOwner(channelId, token, now)
      const row = this.database.connection.prepare(
        `select 1 from agent_channels c where c.id = ? and ${MANAGED_CHANNEL_C_SQL}
           and ${purpose === 'enable'
             ? "migration_state in ('configuration-ready','disabled')"
             : "migration_state not in ('deleting','legacy')"}
           and not exists (select 1 from channel_telegram_lifecycle_operations o where o.channel_id = c.id)`
      ).get(channelId)
      if (!row) return null
      const epoch = purpose === 'mutation'
        ? this.database.connection.prepare(
          `update agent_channels set mutation_epoch = mutation_epoch + 1, updated_at = ?
           where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state not in ('deleting', 'legacy')`
        ).run(now, channelId).changes === 1
          ? (this.database.connection.prepare('select mutation_epoch from agent_channels where id = ?').get(channelId) as { mutation_epoch: number }).mutation_epoch
          : null
        : null
      if (purpose === 'mutation' && epoch === null) return null
      this.database.connection.prepare(
        `insert into channel_telegram_lifecycle_operations(channel_id,owner_token,purpose,generation,created_at,updated_at)
         values(?,?,?,null,?,?) on conflict(channel_id) do update set owner_token=excluded.owner_token,purpose=excluded.purpose,generation=null,updated_at=excluded.updated_at`
      ).run(channelId, token, purpose, now, now)
      return { token, purpose, generation: null, epoch }
    })
  }

  /** Atomically replaces only the exact active runtime owner before a restart handshake awaits. */
  private replaceActiveRuntimeOwner(channelId: string, token: string, now: string): TelegramLifecycleOwner | null {
    const active = this.database.connection.prepare(
      `select g.generation, o.owner_token, o.purpose, o.generation as owner_generation
       from agent_channels c
       join channel_runtime_generations g on g.channel_id = c.id
       join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where c.id = ? and ${MANAGED_CHANNEL_C_SQL} and c.migration_state = 'runtime-ready' and c.requested_enabled = 1
         and g.lifecycle_state = 'active' and o.purpose in ('enable', 'restart') and o.generation = g.generation`
    ).get(channelId) as { generation: number; owner_token: string; purpose: string; owner_generation: number } | undefined
    if (!active) return null
    this.fence(channelId, now)
    const replaced = this.database.connection.prepare(
      `update channel_telegram_lifecycle_operations set owner_token = ?, purpose = 'restart', generation = null, updated_at = ?
       where channel_id = ? and owner_token = ? and purpose = ? and generation = ?`
    ).run(token, now, channelId, active.owner_token, active.purpose, active.owner_generation).changes
    return replaced === 1 ? { token, purpose: 'restart', generation: null } : null
  }

  activateOwnedRuntime(channelId: string, owner: TelegramLifecycleOwner, now: string): TelegramLifecycleOwner | null {
    return this.database.transact(() => {
      const current = this.database.connection.prepare(
        `select 1 from channel_telegram_lifecycle_operations where channel_id = ? and owner_token = ? and purpose = ? and generation is null`
      ).get(channelId, owner.token, owner.purpose)
      if (!current) return null
      if (owner.purpose === 'mutation') return null
      const states = owner.purpose === 'enable' ? "('configuration-ready', 'disabled')" : "('runtime-ready')"
      const changed = this.database.connection.prepare(
        `update agent_channels set requested_enabled = 1, migration_state = 'runtime-ready', updated_at = ?
         where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state in ${states}
           and credential_ref is not null and credential_revision is not null and credential_health = 'configured'
           and exists (select 1 from agent_entities a where a.id = agent_channels.agent_id)
           and not exists (select 1 from channel_management_operations o where o.channel_id = agent_channels.id
             and o.purpose in ('provision', 'rotate') and o.state in ('reserved', 'needs-recovery'))`
      ).run(now, channelId).changes
      if (changed !== 1) return null
      const prior = this.database.connection.prepare('select generation from channel_runtime_generations where channel_id = ?').get(channelId) as { generation: number } | undefined
      const generation = (prior?.generation ?? 0) + 1
      this.database.connection.prepare(
        `insert into channel_runtime_generations(channel_id,generation,lifecycle_state,updated_at) values(?,?, 'active',?)
         on conflict(channel_id) do update set generation=excluded.generation,lifecycle_state='active',updated_at=excluded.updated_at`
      ).run(channelId, generation, now)
      const owned = this.database.connection.prepare(
        `update channel_telegram_lifecycle_operations set generation = ?, updated_at = ? where channel_id = ? and owner_token = ? and purpose = ? and generation is null`
      ).run(generation, now, channelId, owner.token, owner.purpose).changes
      return owned === 1 ? { ...owner, generation } : null
    })
  }

  ownsLifecycleOwner(channelId: string, owner: TelegramLifecycleOwner): boolean {
    return owner.generation !== null && Boolean(this.database.connection.prepare(
      'select 1 from channel_telegram_lifecycle_operations where channel_id = ? and owner_token = ? and purpose = ? and generation = ?'
    ).get(channelId, owner.token, owner.purpose, owner.generation))
  }

  ownsPendingMutationOwner(channelId: string, owner: TelegramLifecycleOwner): boolean {
    return owner.purpose === 'mutation' && owner.generation === null && Boolean(this.database.connection.prepare(
      `select 1 from channel_telegram_lifecycle_operations
       where channel_id = ? and owner_token = ? and purpose = 'mutation' and generation is null`
    ).get(channelId, owner.token))
  }

  mutationOwnerForOperation(operation: ChannelManagementOperation): TelegramLifecycleOwner | null {
    if (!operation.lifecycleOwnerToken || operation.mutationEpoch === null) return null
    const row = this.database.connection.prepare(
      `select c.mutation_epoch from channel_telegram_lifecycle_operations o
       join agent_channels c on c.id = o.channel_id
       where o.channel_id = ? and o.owner_token = ? and o.purpose = 'mutation' and o.generation is null`
    ).get(operation.channelId, operation.lifecycleOwnerToken) as { mutation_epoch: number } | undefined
    return row?.mutation_epoch === operation.mutationEpoch
      ? { token: operation.lifecycleOwnerToken, purpose: 'mutation', generation: null, epoch: operation.mutationEpoch }
      : null
  }

  failOwnedRuntime(channelId: string, owner: TelegramLifecycleOwner, now: string): boolean {
    if (owner.generation === null) return false
    return this.database.transact(() => {
      const cleared = this.database.connection.prepare(
        `delete from channel_telegram_lifecycle_operations where channel_id = ? and owner_token = ? and purpose = ? and generation = ?`
      ).run(channelId, owner.token, owner.purpose, owner.generation).changes
      if (cleared !== 1) return false
      const changed = this.database.connection.prepare(
        `update agent_channels set requested_enabled=0,migration_state='disabled',updated_at=?
         where id=? and migration_state='runtime-ready' and requested_enabled=1`
      ).run(now, channelId).changes
      if (changed) this.fence(channelId, now)
      return changed === 1
    })
  }

  failPendingLifecycleOwner(channelId: string, owner: TelegramLifecycleOwner, now: string): boolean {
    return this.database.transact(() => {
      const cleared = this.database.connection.prepare(
        `delete from channel_telegram_lifecycle_operations where channel_id = ? and owner_token = ? and purpose = ? and generation is null`
      ).run(channelId, owner.token, owner.purpose).changes
      if (cleared !== 1) return false
      const changed = this.database.connection.prepare(
        `update agent_channels set requested_enabled=0,migration_state='disabled',updated_at=? where id=? and migration_state not in ('deleting','legacy')`
      ).run(now, channelId).changes
      if (changed) this.fence(channelId, now)
      return changed === 1
    })
  }

  clearPendingLifecycleOwner(channelId: string, owner: TelegramLifecycleOwner): boolean {
    return this.database.connection.prepare(
      `delete from channel_telegram_lifecycle_operations where channel_id = ? and owner_token = ? and purpose = ? and generation is null`
    ).run(channelId, owner.token, owner.purpose).changes === 1
  }

  disableRuntimeGeneration(channelId: string, generation: number, now: string): boolean {
    return this.database.transact(() => {
      const changed = this.database.connection.prepare(
        `update agent_channels set requested_enabled=0,migration_state='disabled',updated_at=?
         where id=? and migration_state='runtime-ready' and requested_enabled=1
           and exists (select 1 from channel_runtime_generations g where g.channel_id=agent_channels.id and g.generation=? and g.lifecycle_state='active')`
      ).run(now, channelId, generation).changes
      if (changed) {
        this.invalidateLifecycleOwner(channelId)
        this.fence(channelId, now)
      }
      return changed === 1
    })
  }

  private invalidateLifecycleOwner(channelId: string): void {
    this.database.connection.prepare(
      `update channel_management_operations set state = case when state = 'external-inflight' then 'revoked-inflight' else 'revoked-cleanup' end,
         stable_error_code = 'channel-mutation-superseded', updated_at = ?
       where channel_id = ? and state in ('reserved', 'needs-recovery', 'external-inflight')
         and lifecycle_owner_token in (
           select owner_token from channel_telegram_lifecycle_operations
           where channel_id = ? and purpose = 'mutation' and generation is null
         )`
    ).run(new Date().toISOString(), channelId, channelId)
    this.database.connection.prepare('delete from channel_telegram_lifecycle_operations where channel_id = ?').run(channelId)
  }

  stopAllRuntimeAndFence(now: string): string[] {
    return this.database.transact(() => {
      const isolated = this.fenceIsolatedFeishuRuntimes(now)
      const isolatedWechat = this.fenceIsolatedWechatRuntimes(now)
      const blockedAdapters = this.fenceBlockedAdapterRuntimes(now)
      const ids = this.database.connection.prepare(
        `select distinct c.id from agent_channels c left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
         where ${MANAGED_CHANNEL_C_SQL} and (o.channel_id is not null or (c.migration_state = 'runtime-ready' and c.requested_enabled = 1))`
      ).all().map((row) => (row as { id: string }).id)
      for (const id of ids) {
        this.invalidateLifecycleOwner(id)
        this.database.connection.prepare(
          `update agent_channels set requested_enabled = 0, migration_state = case when migration_state = 'deleting' then 'deleting' else 'disabled' end, updated_at = ? where id = ?`
        ).run(now, id)
        this.fence(id, now)
      }
      return [...new Set([...isolated, ...isolatedWechat, ...blockedAdapters, ...ids])]
    })
  }

  activeRuntimeOwners(now: string): Array<{ channelId: string; generation: number; token: string }> {
    return this.database.transact(() => {
      this.fenceIsolatedFeishuRuntimes(now)
      this.fenceIsolatedWechatRuntimes(now)
      this.fenceBlockedAdapterRuntimes(now)
      const rows = this.database.connection.prepare(
      `select c.id as channel_id, g.generation, o.owner_token, o.purpose, o.generation as owner_generation from agent_channels c
       join channel_runtime_generations g on g.channel_id = c.id
       join agent_entities a on a.id = c.agent_id
       left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where ${MANAGED_CHANNEL_C_SQL} and c.migration_state = 'runtime-ready' and c.requested_enabled = 1
         and c.credential_health = 'configured' and g.lifecycle_state = 'active'`
      ).all() as Array<{ channel_id: string; generation: number; owner_token: string | null; purpose: string | null; owner_generation: number | null }>
      const owners: Array<{ channelId: string; generation: number; token: string }> = []
      for (const row of rows) {
        if (row.owner_token && (row.purpose === 'enable' || row.purpose === 'restart') && row.owner_generation === row.generation) {
          owners.push({ channelId: row.channel_id, generation: row.generation, token: row.owner_token })
        } else {
          this.disableRuntimeGeneration(row.channel_id, row.generation, now)
        }
      }
      return owners
    })
  }

  activeRuntimeChannels(now: string): Array<{ channelId: string; generation: number; token: string }> {
    return this.activeRuntimeOwners(now)
  }


  managedCredentialRows(): Array<{ channelId: string; ref: string; revision: number }> {
    return this.database.connection.prepare(
      `select id, credential_ref, credential_revision from agent_channels
       where ${MANAGED_CHANNEL_SQL} and type <> 'wechat' and credential_ref is not null and credential_revision is not null
         and migration_state not in ('deleting', 'legacy')`
    ).all().map((row) => ({
      channelId: (row as { id: string }).id,
      ref: (row as { credential_ref: string }).credential_ref,
      revision: (row as { credential_revision: number }).credential_revision
    }))
  }

  setCredentialHealth(channelId: string, health: 'configured' | 'missing' | 'unavailable', now: string): void {
    this.database.connection.prepare(
      `update agent_channels set credential_health = ?, updated_at = ?
       where id = ? and ${MANAGED_CHANNEL_SQL} and migration_state not in ('deleting', 'legacy')`
    ).run(health, now, channelId)
  }

  audit(channelId: string, actorId: string, action: string, code: string | null, now: string): void {
    this.database.connection
      .prepare(
        `insert into channel_management_audits (id, channel_id, actor_id, action, code, summary_json, created_at)
         values (?, ?, ?, ?, ?, '{}', ?)`
      )
      .run(randomUUID(), channelId, actorId, action, code, now)
  }

  setTarget(channelId: string, conversationId: string, enabled: boolean, now: string): boolean {
    return this.database.connection
      .prepare(
        `insert into channel_delivery_targets (id, channel_id, conversation_id, enabled, created_at, updated_at)
         select ?, ?, ?, ?, ?, ?
         where exists (
           select 1 from channel_conversations c
           join agent_channels ch on ch.id = c.channel_id and ch.agent_id is not null
             and ${MANAGED_CHANNEL_CH_SQL} and ch.type <> 'wechat' and ch.migration_state not in ('legacy', 'deleting')
           where c.id = ? and c.channel_id = ?
         )
         on conflict(channel_id, conversation_id) do update set enabled = excluded.enabled, updated_at = excluded.updated_at`
      )
      .run(randomUUID(), channelId, conversationId, enabled ? 1 : 0, now, now, conversationId, channelId).changes === 1
  }

  createPolicy(input: {
    channelId: string
    subjectType: 'user' | 'conversation'
    ciphertext: Uint8Array
    keyRef: string
    keyRevision: number
    keyHash: string
    conversationKind: 'direct' | 'group' | 'channel' | null
    now: string
  }): boolean {
    return this.database.connection
      .prepare(
        `insert into channel_allow_policies (
          id, channel_id, subject_type, subject_key_ciphertext, subject_key_ref,
          subject_key_revision, subject_key_hash, conversation_kind, created_at
        ) select ?, ?, ?, ?, ?, ?, ?, ?, ?
          where exists (
            select 1 from agent_channels
            where id = ? and ${MANAGED_CHANNEL_SQL} and type <> 'wechat' and migration_state not in ('deleting', 'legacy')
          )`
      )
      .run(randomUUID(), input.channelId, input.subjectType, input.ciphertext, input.keyRef, input.keyRevision, input.keyHash, input.conversationKind, input.now, input.channelId).changes === 1
  }

  deletePolicy(channelId: string, id: string): boolean {
    return this.database.connection.prepare(
      `delete from channel_allow_policies where id = ? and channel_id = ? and exists (
         select 1 from agent_channels where id = channel_allow_policies.channel_id
           and ${MANAGED_CHANNEL_SQL} and type <> 'wechat' and migration_state not in ('deleting', 'legacy')
       )`
    ).run(id, channelId).changes === 1
  }

  /** Settles forged generic credential journals without reading or changing Vault state. */
  abandonWechatCredentialOperation(operation: ChannelManagementOperation, now: string): boolean {
    if (operation.purpose === 'delete') return false
    return this.database.transact(() => {
      const channel = this.database.connection.prepare(
        `update agent_channels set credential_ref = null, credential_revision = null, credential_health = 'missing',
           requested_enabled = 0, migration_state = case when migration_state = 'deleting' then 'deleting' else 'credential-missing' end,
           migration_error_code = 'channel-credential-unsupported', updated_at = ?
         where id = ? and type = 'wechat'`
      ).run(now, operation.channelId).changes
      if (!channel) return false
      this.database.connection.prepare(
        `update channel_management_operations set state = 'abandoned', operation_permit = null,
           stable_error_code = 'channel-credential-unsupported', updated_at = ?
         where id = ? and channel_id = ? and purpose in ('provision', 'rotate')
           and state in ('reserved', 'needs-recovery', 'external-inflight', 'revoked-cleanup', 'revoked-inflight')`
      ).run(now, operation.id, operation.channelId)
      this.database.connection.prepare(
        `delete from channel_telegram_lifecycle_operations
         where channel_id = ? and purpose = 'mutation' and generation is null`
      ).run(operation.channelId)
      this.fence(operation.channelId, now)
      return true
    })
  }

  private fence(channelId: string, now: string): void {
    const prior = this.database.connection
      .prepare(`select generation from channel_runtime_generations where channel_id = ?`)
      .get(channelId) as { generation: number } | undefined
    this.database.connection
      .prepare(
        `insert into channel_runtime_generations (channel_id, generation, lifecycle_state, updated_at)
         values (?, ?, 'inactive', ?)
         on conflict(channel_id) do update set generation = excluded.generation, lifecycle_state = 'inactive', updated_at = excluded.updated_at`
      )
      .run(channelId, (prior?.generation ?? 0) + 1, now)
  }

  /** Never leave a historic `feishu` row runnable just because it is outside the Lark management view. */
  private fenceIsolatedFeishuRuntimes(now: string): string[] {
    const ids = this.database.connection.prepare(
      `select distinct c.id from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where ${ISOLATED_FEISHU_C_SQL} and (
         o.channel_id is not null or g.lifecycle_state = 'active' or (c.migration_state = 'runtime-ready' and c.requested_enabled = 1)
       )`
    ).all().map((row) => (row as { id: string }).id)
    for (const id of ids) {
      this.invalidateLifecycleOwner(id)
      this.database.connection.prepare(
        `update agent_channels set requested_enabled = 0,
           migration_state = case when migration_state = 'deleting' then 'deleting' else 'disabled' end,
           updated_at = ? where id = ?`
      ).run(now, id)
      this.fence(id, now)
    }
    return ids
  }

  /** A legacy or malformed WeChat storage row must never remain runnable beside the strict QR carrier. */
  private fenceIsolatedWechatRuntimes(now: string): string[] {
    const ids = this.database.connection.prepare(
      `select distinct c.id from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where ${ISOLATED_WECHAT_C_SQL} and (
         o.channel_id is not null or g.lifecycle_state = 'active' or (c.migration_state = 'runtime-ready' and c.requested_enabled = 1)
       )`
    ).all().map((row) => (row as { id: string }).id)
    for (const id of ids) {
      this.invalidateLifecycleOwner(id)
      this.database.connection.prepare(
        `update agent_channels set requested_enabled = 0,
           migration_state = case when migration_state = 'deleting' then 'deleting' else 'disabled' end,
           updated_at = ? where id = ?`
      ).run(now, id)
      this.fence(id, now)
    }
    return ids
  }

  /** A blocked adapter is manageable metadata, never a durable C03 runtime owner. */
  private fenceBlockedAdapterRuntimes(now: string): string[] {
    const ids = this.database.connection.prepare(
      `select distinct c.id from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where ${BLOCKED_RUNTIME_C_SQL} and (
         o.channel_id is not null or g.lifecycle_state = 'active' or (c.migration_state = 'runtime-ready' and c.requested_enabled = 1)
       )`
    ).all().map((row) => (row as { id: string }).id)
    for (const id of ids) {
      this.invalidateLifecycleOwner(id)
      this.database.connection.prepare(
        `update agent_channels set requested_enabled = 0,
           migration_state = case when migration_state = 'deleting' then 'deleting' else 'disabled' end,
           updated_at = ? where id = ?`
      ).run(now, id)
      this.fence(id, now)
    }
    return ids
  }

  private clearC03Rows(channelId: string): void {
    for (const table of [
      'agent_channel_task_subscriptions',
      'channel_inbound_admission_reservations',
      'channel_conversation_session_operations',
      'channel_delivery_targets',
      'channel_allow_policies',
      'channel_inbound_work_items',
      'channel_receipts',
      'channel_delivery_attempts',
      'channel_delivery_audits',
      'channel_runtime_audits',
      'channel_conversations',
      'channel_runtime_generations',
      'channel_legacy_discovery_archives',
      'channel_credential_migrations',
      'channel_telegram_offsets',
      'channel_telegram_runtime_audits',
      'channel_slack_runtime_state',
      'channel_slack_runtime_audits',
      'channel_lark_runtime_state',
      'channel_lark_runtime_audits',
      'channel_qq_gateway_state',
      'channel_qq_runtime_audits',
      'channel_discord_gateway_state',
      'channel_discord_runtime_audits',
      'channel_wechat_qr_enrollments',
      'channel_wechat_poll_state',
      'channel_wechat_runtime_audits'
    ]) {
      this.database.connection.prepare(`delete from ${table} where channel_id = ?`).run(channelId)
    }
  }

  private knownPayloadKeyRefs(channelId: string): string[] {
    const refs = this.database.connection.prepare(
      `select payload_key_ref as ref from channel_inbound_work_items where channel_id = ?
       union select subject_key_ref as ref from channel_allow_policies where channel_id = ?
       union select conversation_key_ref as ref from channel_conversations where channel_id = ?`
    ).all(channelId, channelId, channelId) as Array<{ ref: string }>
    return [...new Set(refs.map((row) => row.ref))]
  }

  private knownLegacyMigrations(channelId: string): LegacyMigrationRef[] | null {
    const channel = this.database.connection.prepare('select type, public_config_json from agent_channels where id = ?').get(channelId) as { type: string; public_config_json: string } | undefined
    if (channel?.type === 'slack' || channel?.type === 'qq' || channel?.type === 'discord' || channel?.type === 'wechat' || (channel?.type === 'feishu' && isLarkPublicConfig(channel.public_config_json))) return []
    if (channel?.type !== 'telegram' && channel?.type !== 'wechat') return null
    const migrations = this.database.connection.prepare(
      `select purpose, credential_ref, source_fingerprint, fingerprint_key_id, migration_permit
       from channel_credential_migrations where channel_id = ?`
    ).all(channelId) as Array<{
      purpose: string; credential_ref: string; source_fingerprint: string
      fingerprint_key_id: string; migration_permit: string
    }>
    if (!migrations.every((migration) => isValidLegacyMigrationRow(migration, channelId))) return null
    const archives = this.database.connection.prepare(
      'select archive_ref from channel_legacy_discovery_archives where channel_id = ?'
    ).all(channelId) as Array<{ archive_ref: string }>
    const archiveRefs = migrations.filter((row) => row.purpose === 'legacy-discovery-archive').map((row) => row.credential_ref)
    if (new Set(archiveRefs).size !== archiveRefs.length || archives.length !== archiveRefs.length || !archives.every((archive) => archiveRefs.includes(archive.archive_ref))) return null
    return migrations.map((row) => ({
      purpose: row.purpose as LegacyMigrationRef['purpose'],
      type: channel.type as LegacyMigrationRef['type'],
      ref: row.credential_ref,
      fingerprint: row.source_fingerprint,
      keyId: row.fingerprint_key_id,
      permit: row.migration_permit
    }))
  }
}

function parsePayloadKeyRefs(value: string, channelId: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    const refs = parsed.filter((ref) => isPayloadKeyRefForChannel(ref, channelId))
    return refs.length === parsed.length ? [...new Set(refs)] : null
  } catch {
    return null
  }
}

function parseCredentialCleanupRefs(value: string, channelId: string): CredentialCleanupRef[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    const refs = parsed.filter((ref) => isValidCredentialCleanupRef(ref, channelId))
    return refs.length === parsed.length ? refs : null
  } catch {
    return null
  }
}

function isValidCredentialCleanupRef(value: unknown, channelId: string): value is CredentialCleanupRef {
  if (!value || typeof value !== 'object') return false
  const ref = value as CredentialCleanupRef
  if (ref.purpose === 'rotate') return isProviderRefForChannel(ref.ref, channelId) &&
    typeof ref.expectedRevision === 'number' && Number.isSafeInteger(ref.expectedRevision) && ref.expectedRevision > 0
  return ref.purpose === 'provision' && isBase64Url(ref.fingerprint, 512) &&
    isOpaqueJournalValue(ref.keyId, 256) && isBase64Url(ref.permit, 512) &&
    typeof ref.fingerprint === 'string' && ref.ref === providerRef(channelId, ref.fingerprint) &&
    (ref.expectedRevision === null ||
      (typeof ref.expectedRevision === 'number' && Number.isSafeInteger(ref.expectedRevision) && ref.expectedRevision > 0))
}

function isPayloadKeyRefForChannel(value: unknown, channelId: string): value is string {
  const prefix = `channel-payload-key:${channelId}:`
  return typeof value === 'string' && value.startsWith(prefix) && /^[0-9a-f-]{36}$/i.test(value.slice(prefix.length))
}

function isValidPendingCredentialOperation(value: {
  purpose: 'provision' | 'rotate'; credential_ref: string | null; source_fingerprint: string | null; fingerprint_key_id: string | null; operation_permit: string | null; expected_revision: number | null
}, channelId: string): boolean {
  if (value.purpose === 'rotate') return typeof value.credential_ref === 'string' && isProviderRefForChannel(value.credential_ref, channelId) &&
    typeof value.expected_revision === 'number' && Number.isSafeInteger(value.expected_revision) && value.expected_revision > 0
  return isBase64Url(value.source_fingerprint, 512) && isOpaqueJournalValue(value.fingerprint_key_id, 256) &&
    isBase64Url(value.operation_permit, 512) && typeof value.source_fingerprint === 'string' && value.credential_ref === providerRef(channelId, value.source_fingerprint)
}

function parseLegacyMigrations(value: string, channelId: string): LegacyMigrationRef[] | null {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return null
    const migrations = parsed.filter((migration) => isValidLegacyMigrationRef(migration, channelId))
    return migrations.length === parsed.length && uniqueMigrationRefs(migrations) ? migrations : null
  } catch {
    return null
  }
}

function isValidLegacyMigrationRow(value: { purpose: string; credential_ref: string; source_fingerprint: string; fingerprint_key_id: string; migration_permit: string }, channelId: string): boolean {
  return isValidLegacyMigrationRef({
    purpose: value.purpose as LegacyMigrationRef['purpose'], type: 'telegram', ref: value.credential_ref,
    fingerprint: value.source_fingerprint, keyId: value.fingerprint_key_id, permit: value.migration_permit
  }, channelId)
}

function isValidLegacyMigrationRef(value: unknown, channelId: string): value is LegacyMigrationRef {
  if (!value || typeof value !== 'object') return false
  const migration = value as LegacyMigrationRef
  if ((migration.purpose !== 'provider-credential' && migration.purpose !== 'legacy-discovery-archive') ||
      (migration.type !== 'telegram' && migration.type !== 'wechat') ||
      !isBase64Url(migration.fingerprint, 512) || !isOpaqueJournalValue(migration.keyId, 256) ||
      !isBase64Url(migration.permit, 512)) return false
  const expected = migration.purpose === 'legacy-discovery-archive'
    ? archiveRef(channelId, migration.fingerprint)
    : providerRef(channelId, migration.fingerprint)
  return migration.ref === expected
}

function uniqueMigrationRefs(migrations: readonly LegacyMigrationRef[]): boolean {
  return new Set(migrations.map((migration) => `${migration.purpose}:${migration.ref}`)).size === migrations.length
}

function isOpaqueJournalValue(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\s]/.test(value)
}

function isBase64Url(value: unknown, max: number): value is string {
  return isOpaqueJournalValue(value, max) && /^[A-Za-z0-9_-]+$/.test(value)
}

function providerRef(channelId: string, fingerprint: string): string {
  return `channel-migration:${channelId}:${fingerprint}`
}

function archiveRef(channelId: string, fingerprint: string): string {
  return `channel-migration-archive:${channelId}:${fingerprint}`
}

function isProviderRefForChannel(value: string, channelId: string): boolean {
  const prefix = `channel-migration:${channelId}:`
  const fingerprint = value.startsWith(prefix) ? value.slice(prefix.length) : ''
  return isBase64Url(fingerprint, 512)
}
