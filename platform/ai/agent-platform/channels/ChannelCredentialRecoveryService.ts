import { randomUUID } from 'node:crypto'

import type {
  ChannelCredentialMigrationReservation,
  ChannelCredentialSafeView,
  ChannelCredentialVault,
  ChannelPayloadCipher
} from '../../../secrets/channels/channelCredentialContracts'
import type { AgentChannelType } from '../schemas/channelSchemas'
import {
  ChannelManagementRepository,
  hasValidDeleteKnownRefs,
  type ChannelManagementOperation
} from './ChannelManagementRepository'

/**
 * 凭据的恢复路径（从 `ChannelManagementCredentialService` 拆出来的第二块）。
 *
 * 为什么单独一个文件：写路径与恢复路径关心的事情不同——写路径回答「这次保存怎么落定」，
 * 恢复路径回答「历史操作留下的记录现在是什么形态、能不能自愈」。混在一起那个类过 500 行，
 * 而体积门禁要求只减不增。
 *
 * 这一块的两条硬规矩：
 * - **判读必须用 settle 之前的 revision**：预留记录不可能被 `rotateIfRevision` 写过，先落定再判会变成 +1，
 *   被误判成「别人写过了」→ `markRevokedRotationUnavailable` → 又打成 unavailable；
 * - **重试有上限**：`recovery-pending` 不许永久压着，到上限就落 unavailable + 一行审计。
 */

export type CredentialRecoveryDependencies = {
  repository: ChannelManagementRepository
  vault: ChannelCredentialVault
  cipher: ChannelPayloadCipher
  now: () => string
}

/** 恢复最多试几次；到上限就落 `unavailable` + 一行审计，不许永久压着 `recovery-pending`。 */
const MAX_CREDENTIAL_RECOVERY_ATTEMPTS = 3

/** 一条待恢复操作的凭据在 Vault 里的真实形态，四种，缺一不可地分开。 */
type RecordedCredential =
  | { kind: 'missing' }
  | { kind: 'reserved'; safe: ChannelCredentialSafeView; reservation: ChannelCredentialMigrationReservation }
  | { kind: 'settled'; safe: ChannelCredentialSafeView }
  | { kind: 'unreadable' }

export class ChannelCredentialRecoveryService {
  constructor(private readonly deps: CredentialRecoveryDependencies) {}

  async recover(): Promise<void> {
    for (const operation of this.deps.repository.pendingOperations()) {
      try {
        // Generic credential journals are forbidden for every WeChat storage row, including forged legacy rows.
        if (operation.purpose !== 'delete' && this.deps.repository.isWechatStorageChannel(operation.channelId)) {
          this.deps.repository.abandonWechatCredentialOperation(operation, this.deps.now())
          continue
        }
        await this.recoverOperation(operation)
        this.deps.repository.releaseSettledOperationOwner(operation.id)
      } catch {
        if (operation.purpose === 'delete') {
          this.deps.repository.deferOperation(operation.id, 'channel-delete-pending', this.deps.now())
          continue
        }
        this.deps.repository.deferOperation(operation.id, 'channel-management-recovery-pending', this.deps.now())
        // 「每次启动再试一次、每次在同一个地方失败」不是恢复，是死循环。次数到上限就认账：
        // 操作落成 abandoned、健康度落成 unavailable、留一行审计，别让 recovery-pending 永远压着。
        if (this.deps.repository.recordRecoveryFailure(operation.id) < MAX_CREDENTIAL_RECOVERY_ATTEMPTS) continue
        const now = this.deps.now()
        this.deps.repository.abandonOperation(operation.id, 'channel-credential-recovery-exhausted', now)
        this.deps.repository.releaseSettledOperationOwner(operation.id)
        // 一条卡死操作的放弃**不许**替凭据下结论：凭据自己好好的（读得出来、revision 对得上），
        // 把它打成 unavailable 就是恢复动作自己制造「读不出来」那个谎。只有真读不出来才降级。
        if (!(await this.credentialReadable(operation.channelId))) {
          this.deps.repository.setCredentialHealth(operation.channelId, 'unavailable', now)
        }
        this.deps.repository.audit(
          operation.channelId,
          'channel-recovery',
          operation.purpose === 'rotate' ? 'rotate' : 'provision',
          'channel-credential-recovery-exhausted',
          now
        )
      }
    }
  }

  async finalizeDelete(operation: ChannelManagementOperation): Promise<void> {
    if (!this.deps.cipher.destroy) throw new Error('channel-payload-destroy-unavailable')
    if (operation.payloadKeyRefs === null || !hasValidDeleteKnownRefs(operation)) throw new Error('channel-delete-known-ref-invalid')
    if (this.deps.repository.isStrictWechatChannel(operation.channelId)) {
      // QR-only WeChat deletes local C03 payload keys and rows without touching Vault.
      await this.deps.cipher.destroy(operation.channelId, operation.payloadKeyRefs)
      if (!this.deps.repository.completeDelete(operation.channelId, operation.id)) throw new Error('channel-delete-finalization-failed')
      return
    }
    await this.cleanupKnownCredentialRefs(operation.channelId, operation.credentialCleanupRefs)
    if (this.deps.repository.hasUnsettledCredentialCompensation(operation.channelId)) {
      throw new Error('channel-management-recovery-pending')
    }
    await this.deps.cipher.destroy(operation.channelId, operation.payloadKeyRefs)
    if (operation.ref) await this.deps.vault.delete(operation.ref)
    if (!this.deps.repository.completeDelete(operation.channelId, operation.id)) {
      throw new Error('channel-delete-finalization-failed')
    }
  }

  private async recoverOperation(operation: ChannelManagementOperation): Promise<void> {
    if (operation.purpose === 'delete') {
      await this.finalizeDelete(operation)
      return
    }
    if (operation.purpose === 'provision') {
      // `revoked-cleanup` = 这条 provision 已经被放弃，只剩「把预留记录清掉」一件事；
      // 其它状态才是「把这条凭据落定并写进元数据」。
      if (operation.state === 'revoked-cleanup') {
        await this.recoverRevokedOperation(operation)
        return
      }
      await this.recoverProvisionOperation(operation)
      return
    }
    // rotate 之前先看它指向的凭据是不是「预留记录」：预留记录不可能被 rotateIfRevision 写过，
    // 所以这里 settle 的是**旧值**，这条 rotate 的新值从未生效——落定之后按「已被取代」收口。
    // 判读必须用 settle 之前的 revision，先 settle 再判会变成 +1，被误判成「别人写过了」。
    if (await this.settleReservedIfPresent(operation)) {
      this.deps.repository.abandonOperation(operation.id, 'channel-credential-settled', this.deps.now())
      return
    }
    const currentOwner = operation.lifecycleOwnerToken
      ? this.deps.repository.mutationOwnerForOperation(operation)
      : null
    if (operation.lifecycleOwnerToken && !currentOwner) {
      await this.recoverRevokedOperation(operation)
      return
    }
    if (currentOwner && operation.state === 'external-inflight') {
      await this.recoverOwnedCrashedRotation(operation)
      return
    }
    const safe = await this.inspectKnownCredential(operation.ref)
    if (!safe) throw new Error('channel-management-recovery-pending')
    if (operation.expectedRevision === null) throw new Error('channel-management-recovery-pending')
    if (safe.revision === operation.expectedRevision) {
      this.deps.repository.abandonOperation(operation.id, 'channel-credential-unavailable', this.deps.now())
      return
    }
    if (safe.revision !== operation.expectedRevision + 1) throw new Error('channel-management-recovery-pending')
    const receipt = await this.hasRotationReceipt(operation, safe.revision)
    if (!receipt) {
      // 元数据已经指向这条 ref 的这个 revision：要么是我们自己 setCredential 之后崩了，
      // 要么是并发的另一笔写入已经落定。两种都按「已落定」收口，**不许**再把它打成 unavailable。
      if (this.deps.repository.credentialReferences(operation.channelId, operation.ref, safe.revision)) {
        if (!this.deps.repository.completeRecoveredCredentialOperation(operation, safe, this.deps.now())) {
          this.deps.repository.completeUnattributedRotation(operation, this.deps.now())
        }
        return
      }
      this.deps.repository.markRevokedRotationUnavailable(operation, this.deps.now())
      this.deps.repository.completeUnattributedRotation(operation, this.deps.now())
      return
    }
    if (!this.deps.repository.completeRecoveredCredentialOperation(operation, safe, this.deps.now()) &&
      !this.deps.repository.setRecoveredCredential(operation, safe, this.deps.now())) {
      throw new Error('channel-management-recovery-pending')
    }
    if (!this.deps.repository.completeRecoveredCredentialOperation(operation, safe, this.deps.now())) {
      throw new Error('channel-management-recovery-pending')
    }
  }

  /**
   * provision 的恢复：读真实形态 → 预留就落定 → 写进元数据。
   *
   * 这里补的正是「写完必须落定」缺的那一步：中断在 `putReserved` 与 `settleReserved` 之间，
   * 启动后必须能自己把记录落定、把 revision 写进元数据，而不是每次都读不出来。
   */
  private async recoverProvisionOperation(operation: ChannelManagementOperation): Promise<void> {
    const type = this.channelTypeOf(operation.channelId)
    const record = await this.readOperationCredential(operation, type)
    if (record.kind === 'missing') {
      this.deps.repository.abandonOperation(operation.id, 'channel-credential-unavailable', this.deps.now())
      return
    }
    if (record.kind === 'unreadable') throw new Error('channel-management-recovery-pending')
    const safe = record.kind === 'reserved'
      ? await this.deps.vault.settleReserved({
        ...record.reservation,
        channelId: operation.channelId,
        type,
        expectedRevision: record.safe.revision
      })
      : record.safe
    const now = this.deps.now()
    if (this.deps.repository.completeRecoveredCredentialOperation(operation, safe, now)) return
    // 元数据已经被另一笔写入推进：这条操作失去了所有权，留一行结果即可，不再反复重试。
    const metadata = this.deps.repository.credentialMetadata(operation.channelId)
    if (metadata && metadata.revision !== operation.expectedRevision) {
      this.deps.repository.abandonOperation(operation.id, 'channel-credential-mutation-superseded', now)
      return
    }
    if (!this.deps.repository.setCredential({
      id: operation.channelId,
      ref: safe.credentialRef,
      revision: safe.revision,
      expectedRevision: operation.expectedRevision,
      now: this.deps.now()
    })) throw new Error('channel-management-recovery-pending')
    if (!this.deps.repository.completeRecoveredCredentialOperation(operation, safe, this.deps.now())) {
      this.deps.repository.completeOperation(operation.id, this.deps.now())
    }
  }

  /**
   * 如果这条操作指向的凭据是**预留记录**，就把它落定（`revision + 1`）并把元数据推进到落定后的 revision。
   *
   * 用户库里那条历史坏记录就靠这一步自愈：不删、不改，重启后凭据可读、启用能过。
   * 返回 `true` 表示「确实落定了」——调用方据此把这条操作按已被取代收口。
   */
  private async settleReservedIfPresent(operation: ChannelManagementOperation): Promise<boolean> {
    const type = this.channelTypeOf(operation.channelId)
    const record = await this.readOperationCredential(operation, type)
    if (record.kind !== 'reserved') return false
    const settled = await this.deps.vault.settleReserved({
      ...record.reservation,
      channelId: operation.channelId,
      type,
      expectedRevision: record.safe.revision
    })
    const metadata = this.deps.repository.credentialMetadata(operation.channelId)
    if (metadata && metadata.ref === record.safe.credentialRef) {
      this.deps.repository.settleReservedCredentialMetadata({
        channelId: operation.channelId,
        ref: metadata.ref,
        expectedRevision: metadata.revision,
        observedRevision: settled.revision,
        now: this.deps.now()
      })
    }
    return true
  }

  /**
   * 读一条操作指向的凭据真实形态。三条读法按顺序试，越往后越「兜底但可判定」：
   * 1. `inspectSafe`：已经是普通记录；
   * 2. `inspectReserved`（用日志里的 permit）：还是预留记录；
   * 3. `get` 取回值 + `prepareMigration` 重算 permit：日志里的 permit 已经不可用（历史行/指纹键变化），
   *    但 ref 是 `f(channelId, 值指纹)`，同一把值必然算出同一个 ref 与一把可用的 permit。
   */
  private async readOperationCredential(operation: ChannelManagementOperation, type: AgentChannelType): Promise<RecordedCredential> {
    const settled = await this.tryInspectKnown(operation.ref)
    if (settled) return { kind: 'settled', safe: settled }
    const journal = this.journalReservation(operation)
    if (journal) {
      const reserved = await this.tryInspectReserved(operation.channelId, type, journal)
      if (reserved) return { kind: 'reserved', safe: reserved, reservation: journal }
    }
    const recomputed = await this.permitForStoredValue(operation.channelId, type, operation.ref)
    if (!recomputed) return { kind: 'missing' }
    const reserved = await this.tryInspectReserved(operation.channelId, type, recomputed)
    if (reserved) return { kind: 'reserved', safe: reserved, reservation: recomputed }
    return reserved === null ? { kind: 'missing' } : { kind: 'unreadable' }
  }

  /** 这条频道的凭据现在读得出来吗？恢复动作只能据此决定要不要降级，不能凭一条卡死操作下结论。 */
  private async credentialReadable(channelId: string): Promise<boolean> {
    const metadata = this.deps.repository.credentialMetadata(channelId)
    if (!metadata) return false
    try {
      const safe = await this.deps.vault.inspectSafe?.(metadata.ref)
      return Boolean(safe && safe.revision === metadata.revision)
    } catch {
      return false
    }
  }

  private journalReservation(operation: ChannelManagementOperation): ChannelCredentialMigrationReservation | null {
    if (!operation.fingerprint || !operation.keyId || !operation.permit) return null
    return {
      credentialRef: operation.ref,
      sourceFingerprint: operation.fingerprint,
      fingerprintKeyId: operation.keyId,
      migrationPermit: operation.permit
    }
  }

  private async tryInspectReserved(
    channelId: string,
    type: AgentChannelType,
    reservation: ChannelCredentialMigrationReservation
  ): Promise<ChannelCredentialSafeView | null | undefined> {
    try {
      return await this.deps.vault.inspectReserved({ ...reservation, channelId, type })
    } catch {
      // `undefined` = 读不成（permit 不可用 / 已经不是预留记录），与 `null`（真的没有这条记录）不是一回事。
      return undefined
    }
  }

  private async tryInspectKnown(ref: string): Promise<ChannelCredentialSafeView | null | undefined> {
    try {
      return await this.inspectKnownCredential(ref)
    } catch {
      return undefined
    }
  }

  /** 按 ref 取值并重算指纹/许可：ref 是值的确定性函数，同一把值必然算出同一个 ref。 */
  private async permitForStoredValue(channelId: string, type: AgentChannelType, ref: string): Promise<ChannelCredentialMigrationReservation | null> {
    const value = await this.deps.vault.get(ref)
    if (!value) return null
    const reservation = await this.deps.vault.prepareMigration({ channelId, type, value })
    return reservation.credentialRef === ref ? reservation : null
  }

  /**
   * 切到新 ref 之后，旧的那条预留记录必须清掉（里面的旧 Token 否则永久留在盘上）。
   * 做法与删除路径一致：登记一条指向旧 ref 的 provision 意图 → 置成 `revoked-cleanup` → 现场清理；
   * 清不掉就留给启动恢复的有界清理，绝不因为清理失败而把一次成功的保存说成失败。
   */
  async retireSupersededReserved(
    channelId: string,
    type: AgentChannelType,
    previous: { ref: string; revision: number }
  ): Promise<void> {
    try {
      const reservation = await this.permitForStoredValue(channelId, type, previous.ref)
      if (!reservation) return
      const operationId = randomUUID()
      const now = this.deps.now()
      if (!this.deps.repository.reserveOperation({
        id: operationId,
        channelId,
        purpose: 'provision',
        ref: previous.ref,
        fingerprint: reservation.sourceFingerprint,
        keyId: reservation.fingerprintKeyId,
        permit: reservation.migrationPermit,
        expectedRevision: previous.revision,
        now
      })) return
      this.deps.repository.markOperationExternalResult(operationId, { expectedRevision: previous.revision }, this.deps.now())
      const operation = this.deps.repository.operation(operationId)
      if (operation) await this.recoverRevokedOperation(operation)
    } catch {
      // 旧值已经不在库里，或指纹复算不出来：没有可清理的记录。保存在这之前已经落定，不因此报错。
    }
  }

  private async inspectKnownCredential(ref: string) {
    if (!this.deps.vault.inspectSafe) throw new Error('channel-management-recovery-pending')
    return this.deps.vault.inspectSafe(ref)
  }

  private async hasRotationReceipt(operation: ChannelManagementOperation, revision: number): Promise<boolean> {
    if (!this.deps.vault.inspectMutationReceipt || operation.mutationEpoch === null) return false
    const receipt = await this.deps.vault.inspectMutationReceipt(operation.ref)
    return receipt !== null &&
      receipt.channelId === operation.channelId &&
      receipt.credentialRef === operation.ref &&
      receipt.revision === revision &&
      receipt.operationId === operation.id &&
      receipt.mutationEpoch === operation.mutationEpoch
  }

  private async recoverOwnedCrashedRotation(operation: ChannelManagementOperation): Promise<void> {
    let safe: ChannelCredentialSafeView | null
    try {
      safe = await this.inspectKnownCredential(operation.ref)
    } catch {
      // The process that owned the call is gone. Do not leave its durable owner as a permanent lock.
      this.deps.repository.releaseOwnedCrashedOperation(operation, 'channel-credential-unavailable', this.deps.now())
      return
    }
    let exactResult = false
    try {
      exactResult = safe !== null && operation.expectedRevision !== null &&
        safe.revision === operation.expectedRevision + 1 &&
        await this.hasRotationReceipt(operation, safe.revision)
    } catch {
      // Receipt inspection is itself an external Vault read. Its failure cannot leave a crash owner locked.
      this.deps.repository.releaseOwnedCrashedOperation(operation, 'channel-credential-unavailable', this.deps.now())
      return
    }
    if (exactResult && this.deps.repository.settleOwnedCrashedRotation(operation, safe!.revision, this.deps.now())) return

    // A persisted owner from a crashed process is not a live lease. Release it only if it is still exact,
    // while leaving the known normal Vault ref intact for explicit retry or deletion.
    this.deps.repository.releaseOwnedCrashedOperation(
      operation,
      exactResult ? 'channel-management-recovery-pending' : 'channel-credential-mutation-unattributed',
      this.deps.now()
    )
  }

  async recoverRevokedOperation(operation: ChannelManagementOperation): Promise<void> {
    const type = this.channelTypeOf(operation.channelId)
    if (operation.purpose === 'provision') {
      if (!this.deps.vault.claimReservedCleanup || !this.deps.vault.deleteReservedIfCleanupClaim) {
        throw new Error('channel-management-recovery-pending')
      }
      const claim = await this.deps.vault.claimReservedCleanup({
        channelId: operation.channelId, type, credentialRef: operation.ref,
        sourceFingerprint: operation.fingerprint!, fingerprintKeyId: operation.keyId!, migrationPermit: operation.permit!
      })
      if (!claim) {
        this.deps.repository.completeRevokedOperation(operation.id, this.deps.now())
        return
      }
      const removed = await this.deps.vault.deleteReservedIfCleanupClaim({
        channelId: operation.channelId, type, credentialRef: operation.ref,
        sourceFingerprint: operation.fingerprint!, fingerprintKeyId: operation.keyId!, migrationPermit: operation.permit!,
        expectedRevision: claim.revision, cleanupToken: claim.cleanupToken
      })
      // A later same-secret put atomically revokes the claim; it owns the ref instead of being deleted.
      if (!removed && !this.deps.repository.credentialReferences(operation.channelId, operation.ref, claim.revision)) {
        throw new Error('channel-management-recovery-pending')
      }
      this.deps.repository.completeRevokedOperation(operation.id, this.deps.now())
      return
    }

    const safe = await this.inspectKnownCredential(operation.ref)
    if (!safe) {
      this.deps.repository.completeRevokedOperation(operation.id, this.deps.now())
      return
    }
    if (operation.expectedRevision === null || safe.revision !== operation.expectedRevision + 1) {
      this.deps.repository.markRevokedRotationUnavailable(operation, this.deps.now())
      throw new Error('channel-management-recovery-pending')
    }
    const receipt = await this.hasRotationReceipt(operation, safe.revision)
    if (!receipt) {
      // A different operation advanced this normal ref. Retain it, but never adopt it as this journal's result.
      if (this.deps.repository.credentialReferences(operation.channelId, operation.ref, safe.revision)) {
        this.deps.repository.completeUnattributedRotation(operation, this.deps.now())
        return
      }
      this.deps.repository.markRevokedRotationUnavailable(operation, this.deps.now())
      this.deps.repository.completeUnattributedRotation(operation, this.deps.now())
      return
    }
    // Rotation mutates an existing credential ref. There is no safe compensation delete for the old value.
    const settled = this.deps.repository.settleRevokedRotation(operation, safe.revision, this.deps.now())
    // If another mutation changed metadata, retain the Vault value and make the safe view unavailable instead.
    if (!settled && !this.deps.repository.credentialReferences(operation.channelId, operation.ref, safe.revision)) {
      this.deps.repository.markRevokedRotationUnavailable(operation, this.deps.now())
    }
    this.deps.repository.completeRevokedOperation(operation.id, this.deps.now())
  }

  private async cleanupKnownCredentialRefs(channelId: string, refs: ChannelManagementOperation['credentialCleanupRefs']): Promise<void> {
    if (refs === null) throw new Error('channel-delete-known-ref-invalid')
    const type = this.channelTypeOf(channelId)
    for (const ref of refs) {
      if (ref.purpose === 'provision') {
        if (!this.deps.vault.claimReservedCleanup || !this.deps.vault.deleteReservedIfCleanupClaim) {
          throw new Error('channel-management-recovery-pending')
        }
        const claim = await this.deps.vault.claimReservedCleanup({
          channelId, type, credentialRef: ref.ref, sourceFingerprint: ref.fingerprint!,
          fingerprintKeyId: ref.keyId!, migrationPermit: ref.permit!
        })
        if (claim && !(await this.deps.vault.deleteReservedIfCleanupClaim({
          channelId, type, credentialRef: ref.ref, sourceFingerprint: ref.fingerprint!,
          fingerprintKeyId: ref.keyId!, migrationPermit: ref.permit!, expectedRevision: claim.revision, cleanupToken: claim.cleanupToken
        }))) throw new Error('channel-management-recovery-pending')
      } else {
        // Delete owns the Channel and may use its separately journaled normal known ref. A rotate child never deletes it.
        if (ref.expectedRevision === null) throw new Error('channel-delete-known-ref-invalid')
      }
    }
    if (this.deps.repository.hasInFlightCredentialCleanup(channelId)) throw new Error('channel-management-recovery-pending')
    this.deps.repository.completeCredentialCompensations(channelId, this.deps.now())
  }

  channelTypeOf(channelId: string): AgentChannelType {
    const type = this.deps.repository.knownChannelType(channelId)
    if (!type) throw new Error('channel-management-recovery-pending')
    return type
  }
}
