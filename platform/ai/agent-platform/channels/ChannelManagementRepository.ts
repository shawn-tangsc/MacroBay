import { randomUUID } from 'node:crypto'

import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { AgentChannelType } from '../schemas/channelSchemas'
import type { AgentPermissionMode } from '../schemas/agentSchemas'
import type { ChannelWorkspaceOverride } from './ChannelManagementContracts'
import { blockedRuntimeChannelSql, isLarkPublicConfig, isolatedLarkSql, isolatedWechatSql, managedChannelSql, type ChannelAdapterKey } from './ChannelManagementPredicates'
import { channelAdapterDescriptor } from './channelAdapterDescriptors'
import { ChannelManagementQueryRepository } from './ChannelManagementQueryRepository'
import {
  isPayloadKeyRefForChannel,
  isProviderRefForChannel,
  isValidPendingCredentialOperation,
  parseCredentialCleanupRefs,
  parsePayloadKeyRefs
} from './channelCredentialJournalRefs'
import {
  activateOwnedChannelRuntime,
  explainEnableBlock
} from './channelRuntimeActivation'
import {
  abandonCredentialOperation,
  insertManagedChannel,
  listManagedCredentialRows,
  recordCredentialRecoveryFailure,
  releaseSettledOperationOwner,
  setManagedCredentialHealth,
  settleReservedCredentialMetadata,
  updateManagedChannelRow,
  type ManagedChannelCreateInput,
  type ManagedChannelUpdateInput
} from './channelManagementRepositoryWrites'

const MANAGED_CHANNEL_SQL = managedChannelSql()
const MANAGED_CHANNEL_C_SQL = managedChannelSql('c')
const MANAGED_CHANNEL_CH_SQL = managedChannelSql('ch')
const ISOLATED_LARK_C_SQL = isolatedLarkSql('c')
const ISOLATED_WECHAT_C_SQL = isolatedWechatSql('c')

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


export type TelegramLifecycleOwner = { token: string; purpose: 'enable' | 'restart' | 'mutation'; generation: number | null; epoch?: number | null }

export function hasValidDeleteKnownRefs(operation: Pick<ChannelManagementOperation, 'channelId' | 'ref' | 'payloadKeyRefs'>): boolean {
  return (operation.ref === '' || isProviderRefForChannel(operation.ref, operation.channelId)) &&
    operation.payloadKeyRefs !== null &&
    operation.payloadKeyRefs.every((ref) => isPayloadKeyRefForChannel(ref, operation.channelId))
}

export class ChannelManagementRepository {
  readonly query: ChannelManagementQueryRepository

  constructor(private readonly database: AgentPlatformDatabase) {
    this.query = new ChannelManagementQueryRepository(database)
  }

  agentExists(agentId: string): boolean {
    return Boolean(this.database.connection.prepare('select 1 from agent_entities where id = ?').get(agentId))
  }

  /**
   * 这条通道最近一次**真实投递**（任意来源）的结局。
   *
   * 为什么要有它：读者看到的横幅说「通道未就绪」，而库里明明有成功的投递尝试——界面缺一个
   * 他自己能核对的事实。会话标签从入站候选里按 `conversation_key_hash` 对出来，不往审计里复制姓名。
   */
  lastDelivery(channelId: string): { status: 'delivered' | 'failed' | 'unknown-after-send'; at: string; conversationLabel: string | null } | null {
    const row = this.database.connection.prepare(
      `select a.status as status, coalesce(a.completed_at, a.created_at) as at, c.display_label as label
       from channel_delivery_attempts a
       left join channel_conversations v on v.id = a.conversation_id
       left join channel_inbound_candidates c
         on c.channel_id = a.channel_id and c.conversation_key_hash = v.conversation_key_hash
       where a.channel_id = ?
       order by coalesce(a.completed_at, a.created_at) desc, a.id desc
       limit 1`
    ).get(channelId) as { status: string; at: string; label: string | null } | undefined
    if (!row) return null
    // 只认三种终态；别的值（queued 等）说明还没走完，按「没到手」处理更安全。
    if (row.status !== 'delivered' && row.status !== 'failed' && row.status !== 'unknown-after-send') return null
    return { status: row.status, at: row.at, conversationLabel: row.label }
  }

  create(input: ManagedChannelCreateInput): boolean {
    return insertManagedChannel(this.database, input)
  }

  update(id: string, input: ManagedChannelUpdateInput): boolean {
    return updateManagedChannelRow(this.database, id, input, {
      invalidateLifecycleOwner: (channelId) => this.invalidateLifecycleOwner(channelId),
      fence: (channelId, at) => this.fence(channelId, at)
    })
  }

  channelType(id: string): 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat' | null {
    const row = this.database.connection.prepare(
      `select case when adapter_key = 'lark' then 'feishu' else adapter_key end as type from agent_channels where id = ? and ${MANAGED_CHANNEL_SQL} and lifecycle_state not in ('deleting')`
    ).get(id) as { type: AgentChannelType } | undefined
    return row?.type === 'telegram' || row?.type === 'slack' || row?.type === 'feishu' || row?.type === 'qq' || row?.type === 'discord' || row?.type === 'wechat' ? row.type : null
  }

  /** Recovery may identify a deleting Channel only to consume its already-journaled Vault capability. */
  knownChannelType(id: string): 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat' | null {
    const row = this.database.connection.prepare(
      `select case when adapter_key = 'lark' then 'feishu' else adapter_key end as type from agent_channels where id = ? and ${MANAGED_CHANNEL_SQL}`
    ).get(id) as { type: AgentChannelType } | undefined
    return row?.type === 'telegram' || row?.type === 'slack' || row?.type === 'feishu' || row?.type === 'qq' || row?.type === 'discord' || row?.type === 'wechat' ? row.type : null
  }

  /** A WeChat storage row never has a generic credential recovery path in Release F. */
  isWechatStorageChannel(id: string): boolean {
    return Boolean(this.database.connection.prepare(`select 1 from agent_channels where id = ? and adapter_key = 'wechat'`).get(id))
  }

  isStrictWechatChannel(id: string): boolean {
    return Boolean(this.database.connection.prepare(
      `select 1 from agent_channels where id = ? and adapter_key = 'wechat' and public_config_json = '{}'`
    ).get(id))
  }

  disable(id: string, now: string): boolean {
    return this.database.transact(() => {
      this.invalidateLifecycleOwner(id)
      const changed = this.database.connection
        .prepare(
          `update agent_channels
           set requested_enabled = 0, lifecycle_state = 'disabled', updated_at = ?
           where id = ? and ${MANAGED_CHANNEL_SQL} and lifecycle_state not in ('deleting')`
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
         where id = ? and ${MANAGED_CHANNEL_SQL} and adapter_key <> 'wechat' and lifecycle_state not in ('deleting')`
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
             lifecycle_state = 'ready', credential_health = 'configured', migration_error_code = null, updated_at = ?
         where id = ? and ${MANAGED_CHANNEL_SQL} and adapter_key <> 'wechat' and lifecycle_state not in ('deleting')
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
              and (adapter_key <> 'wechat' or ? = 'delete')
              and lifecycle_state not in ('deleting')
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
    credentialCleanupRefs: CredentialCleanupRef[]; now: string
  }): void {
    this.database.connection.prepare(
      `insert into channel_management_operations (id, channel_id, purpose, credential_ref, expected_revision, payload_key_refs_json, legacy_migrations_json, credential_cleanup_refs_json, state, created_at, updated_at)
       values (?, ?, 'delete', ?, ?, ?, ?, ?, 'reserved', ?, ?)`
    ).run(input.id, input.channelId, input.ref, input.expectedRevision ?? null, JSON.stringify(input.payloadKeyRefs), '[]', JSON.stringify(input.credentialCleanupRefs), input.now, input.now)
  }

  beginDelete(id: string, operationId: string, now: string): ChannelManagementOperation | null {
    return this.database.transact(() => {
      const row = this.database.connection
        .prepare(
          `select case when adapter_key = 'lark' then 'feishu' else adapter_key end as type, public_config_json, credential_ref, credential_revision from agent_channels
           where id = ? and ${MANAGED_CHANNEL_SQL} and lifecycle_state not in ('deleting')`
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
      this.invalidateLifecycleOwner(id)
      this.database.connection
        .prepare(
          `update agent_channels set requested_enabled = 0, lifecycle_state = 'deleting', updated_at = ? where id = ?`
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
         requested_enabled = 0, lifecycle_state = 'deleting', migration_error_code = 'channel-credential-unsupported', updated_at = ?
       where id = ? and adapter_key = 'wechat' and public_config_json = '{}'`
    ).run(now, id)
    this.fence(id, now)
    this.clearC03Rows(id)
    this.reserveDeleteOperation({ id: operationId, channelId: id, ref: '', payloadKeyRefs, credentialCleanupRefs: [], now })
    return {
      id: operationId, channelId: id, purpose: 'delete', ref: '', fingerprint: null, keyId: null, permit: null,
      expectedRevision: null, payloadKeyRefs, lifecycleOwnerToken: null,
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
      const removed = this.database.connection.prepare(`delete from agent_channels where id = ? and lifecycle_state = 'deleting'`).run(channelId).changes
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

  /** 把「预留记录已经落定」写进元数据：只推进 revision 与健康度，不碰启用意图与生命周期。 */
  settleReservedCredentialMetadata(input: {
    channelId: string; ref: string; expectedRevision: number | null; observedRevision: number; now: string
  }): boolean {
    return settleReservedCredentialMetadata(this.database, input)
  }

  /** 记一次恢复失败并返回累计次数：给「永远好不了的操作」一个上限，而不是无限重试。 */
  recordRecoveryFailure(id: string): number {
    return recordCredentialRecoveryFailure(this.database, id)
  }

  /** 操作收口后放掉它自己的生命周期 owner 行（幂等）；留着会把用户锁在「不能启用」外面。 */
  releaseSettledOperationOwner(id: string): void {
    releaseSettledOperationOwner(this.database, id)
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
      `select 1 from agent_channels where id = ? and credential_ref = ? and lifecycle_state not in ('deleting')
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
         and mutation_epoch = ? and lifecycle_state not in ('deleting', 'enabled')
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
           and mutation_epoch = ? and lifecycle_state not in ('deleting', 'enabled')
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
           and lifecycle_state not in ('deleting', 'enabled')`
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
         and lifecycle_state not in ('deleting', 'enabled')
         and not exists (select 1 from channel_telegram_lifecycle_operations o where o.channel_id = agent_channels.id)`
    ).run(now, operation.channelId, operation.ref, operation.mutationEpoch)
  }

  /** Completes a crashed live mutation only after its durable metadata already matches the known Vault view. */
  completeRecoveredCredentialOperation(operation: ChannelManagementOperation, safe: { credentialRef: string; revision: number }, now: string): boolean {
    return this.database.transact(() => {
      const metadata = this.database.connection.prepare(
        `select 1 from agent_channels
         where id = ? and ${MANAGED_CHANNEL_SQL} and credential_ref = ? and credential_revision = ?
           and lifecycle_state = 'ready'`
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
           lifecycle_state = 'ready', credential_health = 'configured', migration_error_code = null, updated_at = ?
         where id = ? and ${MANAGED_CHANNEL_SQL} and adapter_key <> 'wechat' and lifecycle_state not in ('deleting')
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

  /** 放弃一条操作：连带清掉它自己的生命周期 owner 行，否则下一次启用会被它挡住。 */
  abandonOperation(id: string, code: string, now: string): void {
    abandonCredentialOperation(this.database, id, code, now)
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
             ? "lifecycle_state in ('ready','disabled')"
             : "lifecycle_state not in ('deleting')"}
           and not exists (select 1 from channel_telegram_lifecycle_operations o where o.channel_id = c.id)`
      ).get(channelId)
      if (!row) return null
      const epoch = purpose === 'mutation'
        ? this.database.connection.prepare(
          `update agent_channels set mutation_epoch = mutation_epoch + 1, updated_at = ?
           where id = ? and ${MANAGED_CHANNEL_SQL} and lifecycle_state not in ('deleting')`
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
       where c.id = ? and ${MANAGED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
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

  activateOwnedRuntime(
    channelId: string,
    owner: TelegramLifecycleOwner,
    now: string
  ): { owner: TelegramLifecycleOwner; displaced: import('./singleEnabledChannel').DisplacedChannel[] } | null {
    return activateOwnedChannelRuntime(this.database, channelId, owner, now)
  }

  /** 启用被挡住的**真实**原因：只有助手行真的不在时才允许说「助手不在了」。 */
  enableBlockReason(channelId: string, owner: TelegramLifecycleOwner) {
    return explainEnableBlock(this.database, channelId, owner)
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
        `update agent_channels set requested_enabled=0,lifecycle_state='disabled',updated_at=?
         where id=? and lifecycle_state='enabled' and requested_enabled=1`
      ).run(now, channelId).changes
      if (changed) this.fence(channelId, now)
      return changed === 1
    })
  }

  /** Keep startup intent for a transient runtime failure so the next boot can retry. */
  preserveResumeIntent(channelId: string, now: string): boolean {
    return this.database.transact(() => {
      const changed = this.database.connection.prepare(
        `update agent_channels set requested_enabled = 1,
           lifecycle_state = case when lifecycle_state = 'deleting' then 'deleting' else 'ready' end,
           updated_at = ?
         where id = ? and credential_ref is not null`
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
        `update agent_channels set requested_enabled=0,lifecycle_state='disabled',updated_at=? where id=? and lifecycle_state not in ('deleting')`
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
        `update agent_channels set requested_enabled=0,lifecycle_state='disabled',updated_at=?
         where id=? and lifecycle_state='enabled' and requested_enabled=1
           and exists (select 1 from channel_runtime_generations g where g.channel_id=agent_channels.id and g.generation=? and g.lifecycle_state='active')`
      ).run(now, channelId, generation).changes
      if (changed) {
        this.invalidateLifecycleOwner(channelId)
        this.fence(channelId, now)
      }
      return changed === 1
    })
  }

  /**
   * 启动期围栏：把运行代际作废，**但保留读者的开启意图**（`requested_enabled` 不动，状态回 `ready`）。
   *
   * 为什么不能清意图：已实现、只是还没有验收证据的适配器，靠「启用时现场自检通过」放行；
   * 证据决定的是平台对外声明，不是这位读者能不能用。启动时拿 `canEnable`（= 有证据）把这类频道
   * 判成「不许跑」还可以，但顺手把 `requested_enabled` 抹掉就等于替他取消启用——
   * 下次启动连恢复候选都没有，简报只会发到恰好还在启用的那一条（用户今天报的现场）。
   */
  fenceRuntimeGenerationKeepingIntent(channelId: string, now: string): boolean {
    return this.database.transact(() => {
      const changed = this.database.connection.prepare(
        `update agent_channels
           set lifecycle_state = case when lifecycle_state = 'deleting' then 'deleting' else 'ready' end,
               updated_at = ?
         where id = ? and ${MANAGED_CHANNEL_SQL} and lifecycle_state <> 'deleting' and requested_enabled = 1`
      ).run(now, channelId).changes
      this.fence(channelId, now)
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
      const isolated = this.fenceIsolatedLarkRuntimes(now)
      const isolatedWechat = this.fenceIsolatedWechatRuntimes(now)
      const blockedAdapters = this.fenceBlockedAdapterRuntimes(now)
      const ids = this.database.connection.prepare(
        `select distinct c.id from agent_channels c left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
         where ${MANAGED_CHANNEL_C_SQL} and (o.channel_id is not null or (c.lifecycle_state = 'enabled' and c.requested_enabled = 1))`
      ).all().map((row) => (row as { id: string }).id)
      for (const id of ids) {
        this.invalidateLifecycleOwner(id)
        this.database.connection.prepare(
          `update agent_channels set requested_enabled = 0, lifecycle_state = case when lifecycle_state = 'deleting' then 'deleting' else 'disabled' end, updated_at = ? where id = ?`
        ).run(now, id)
        this.fence(id, now)
      }
      return [...new Set([...isolated, ...isolatedWechat, ...blockedAdapters, ...ids])]
    })
  }

  /** Quit preserves user intent: fence generations and owners, but leave requested_enabled/state. */
  fenceAllForQuit(now: string): string[] {
    return this.database.transact(() => {
      const isolated = this.fenceIsolatedLarkRuntimes(now)
      const isolatedWechat = this.fenceIsolatedWechatRuntimes(now)
      const blockedAdapters = this.fenceBlockedAdapterRuntimes(now)
      const ids = this.database.connection.prepare(
        `select distinct c.id from agent_channels c left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
         where ${MANAGED_CHANNEL_C_SQL} and (o.channel_id is not null or (c.lifecycle_state = 'enabled' and c.requested_enabled = 1))`
      ).all().map((row) => (row as { id: string }).id)
      for (const id of ids) {
        this.invalidateLifecycleOwner(id)
        this.fence(id, now)
      }
      return [...new Set([...isolated, ...isolatedWechat, ...blockedAdapters, ...ids])]
    })
  }

  /** Channels whose user intent survived a graceful quit but whose generation is no longer active. */
  resumableChannelIds(): string[] {
    return (this.database.connection.prepare(
      `select c.id from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       where ${MANAGED_CHANNEL_C_SQL} and c.requested_enabled = 1 and c.lifecycle_state in ('enabled', 'ready')
         and (g.lifecycle_state is null or g.lifecycle_state <> 'active')`
    ).all() as Array<{ id: string }>).map((row) => row.id)
  }

  activeRuntimeOwners(now: string): Array<{ channelId: string; generation: number; token: string }> {
    return this.database.transact(() => {
      this.fenceIsolatedLarkRuntimes(now)
      this.fenceIsolatedWechatRuntimes(now)
      this.fenceBlockedAdapterRuntimes(now)
      const rows = this.database.connection.prepare(
      `select c.id as channel_id, g.generation, o.owner_token, o.purpose, o.generation as owner_generation from agent_channels c
       join channel_runtime_generations g on g.channel_id = c.id
       join agent_entities a on a.id = c.agent_id
       left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where ${MANAGED_CHANNEL_C_SQL} and c.lifecycle_state = 'enabled' and c.requested_enabled = 1
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
    return listManagedCredentialRows(this.database)
  }

  setCredentialHealth(channelId: string, health: 'configured' | 'missing' | 'unavailable', now: string): void {
    setManagedCredentialHealth(this.database, channelId, health, now)
  }

  audit(channelId: string, actorId: string, action: string, code: string | null, now: string, summary?: Record<string, string>): void {
    this.database.connection
      .prepare(
        `insert into channel_management_audits (id, channel_id, actor_id, action, code, summary_json, created_at)
         values (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), channelId, actorId, action, code, JSON.stringify(summary ?? {}), now)
  }

  setTarget(channelId: string, conversationId: string, enabled: boolean, now: string): boolean {
    return this.database.connection
      .prepare(
        `insert into channel_delivery_targets (id, channel_id, conversation_id, enabled, created_at, updated_at)
         select ?, ?, ?, ?, ?, ?
         where exists (
           select 1 from channel_conversations c
           join agent_channels ch on ch.id = c.channel_id and ch.agent_id is not null
             and ${MANAGED_CHANNEL_CH_SQL} and ch.adapter_key <> 'wechat' and ch.lifecycle_state <> 'deleting'
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
            where id = ? and ${MANAGED_CHANNEL_SQL} and adapter_key <> 'wechat' and lifecycle_state not in ('deleting')
          )`
      )
      .run(randomUUID(), input.channelId, input.subjectType, input.ciphertext, input.keyRef, input.keyRevision, input.keyHash, input.conversationKind, input.now, input.channelId).changes === 1
  }

  deletePolicy(channelId: string, id: string): boolean {
    return this.database.connection.prepare(
      `delete from channel_allow_policies where id = ? and channel_id = ? and exists (
         select 1 from agent_channels where id = channel_allow_policies.channel_id
           and ${MANAGED_CHANNEL_SQL} and adapter_key <> 'wechat' and lifecycle_state not in ('deleting')
       )`
    ).run(id, channelId).changes === 1
  }

  /** Settles forged generic credential journals without reading or changing Vault state. */
  abandonWechatCredentialOperation(operation: ChannelManagementOperation, now: string): boolean {
    if (operation.purpose === 'delete') return false
    return this.database.transact(() => {
      const channel = this.database.connection.prepare(
        `update agent_channels set credential_ref = null, credential_revision = null, credential_health = 'missing',
           requested_enabled = 0, lifecycle_state = case when lifecycle_state = 'deleting' then 'deleting' else 'credential-missing' end,
           migration_error_code = 'channel-credential-unsupported', updated_at = ?
         where id = ? and adapter_key = 'wechat'`
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
  private fenceIsolatedLarkRuntimes(now: string): string[] {
    const ids = this.database.connection.prepare(
      `select distinct c.id from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where ${ISOLATED_LARK_C_SQL} and (
         o.channel_id is not null or g.lifecycle_state = 'active' or (c.lifecycle_state = 'enabled' and c.requested_enabled = 1)
       )`
    ).all().map((row) => (row as { id: string }).id)
    for (const id of ids) {
      this.invalidateLifecycleOwner(id)
      this.database.connection.prepare(
        `update agent_channels set requested_enabled = 0, lifecycle_state = 'disabled', updated_at = ? where id = ?`
      ).run(now, id)
      this.fence(id, now)
    }
    return ids
  }
  private fenceIsolatedWechatRuntimes(now: string): string[] {
    const ids = this.database.connection.prepare(
      `select distinct c.id from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where ${ISOLATED_WECHAT_C_SQL} and (
         o.channel_id is not null or g.lifecycle_state = 'active' or (c.lifecycle_state = 'enabled' and c.requested_enabled = 1)
       )`
    ).all().map((row) => (row as { id: string }).id)
    for (const id of ids) {
      this.invalidateLifecycleOwner(id)
      this.database.connection.prepare(
        `update agent_channels set requested_enabled = 0,
           lifecycle_state = case when lifecycle_state = 'deleting' then 'deleting' else 'disabled' end,
           updated_at = ? where id = ?`
      ).run(now, id)
      this.fence(id, now)
    }
    return ids
  }

  /** A blocked adapter is manageable metadata, never a durable C03 runtime owner. */
  private fenceBlockedAdapterRuntimes(now: string): string[] {
    const rows = this.database.connection.prepare(
      `select distinct c.id, c.adapter_key from agent_channels c
       left join channel_runtime_generations g on g.channel_id = c.id
       left join channel_telegram_lifecycle_operations o on o.channel_id = c.id
       where ${blockedRuntimeChannelSql('c')} and (
         o.channel_id is not null or g.lifecycle_state = 'active' or (c.lifecycle_state = 'enabled' and c.requested_enabled = 1)
       )`
    ).all() as Array<{ id: string; adapter_key: ChannelAdapterKey }>
    const ids = rows.map((row) => row.id)
    for (const { id, adapter_key: adapterKey } of rows) {
      this.invalidateLifecycleOwner(id)
      // **已实现、只是还没拿到验收证据**的适配器：只围栏运行时，不清开启意图。
      // 这类频道的启用是读者点启用时靠现场自检放行的——`supported` 决定的是平台对外声明，
      // 不是读者能不能用；清掉 `requested_enabled` 会让他的意图消失，下次启动连恢复候选都没有
      // （用户 2026-11-04 报的「每次重启都要再点一次启用」）。
      // 未实现的适配器（微信/飞书/QQ/Discord）仍按原规则收口：它们根本没运行时可跑。
      if (channelAdapterDescriptor(adapterKey).implemented) { this.fence(id, now); continue }
      this.database.connection.prepare(
        `update agent_channels set requested_enabled = 0,
           lifecycle_state = case when lifecycle_state = 'deleting' then 'deleting' else 'disabled' end,
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


}

