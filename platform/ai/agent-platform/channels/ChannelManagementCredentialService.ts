import { randomUUID } from 'node:crypto'

import type { ChannelCredentialVault, ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import { assertDiscordSecret, assertLarkSecret, assertQqSecret, assertSenderId, assertSlackSecret, assertTelegramSecret, type ChannelManagementResult, type SecureHandoffSubmit } from './ChannelManagementContracts'
import { ChannelManagementRepository, hasValidDeleteKnownRefs, type ChannelManagementOperation, type TelegramLifecycleOwner } from './ChannelManagementRepository'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'

type CredentialDependencies = {
  repository: ChannelManagementRepository
  vault: ChannelCredentialVault
  cipher: ChannelPayloadCipher
  handoff: ChannelSecureHandoff
  now: () => string
}

export class ChannelManagementCredentialService {
  constructor(private readonly deps: CredentialDependencies) {}

  async provision(input: { id: string; actorId: string; senderId: unknown; handoff: SecureHandoffSubmit; owner: TelegramLifecycleOwner }): Promise<ChannelManagementResult> {
    return this.write(input, 'provision')
  }

  async rotate(input: { id: string; actorId: string; senderId: unknown; handoff: SecureHandoffSubmit; owner: TelegramLifecycleOwner }): Promise<ChannelManagementResult> {
    return this.write(input, 'rotate')
  }

  async recover(): Promise<void> {
    for (const operation of this.deps.repository.pendingOperations()) {
      try {
        // Generic credential journals are forbidden for every WeChat storage row, including forged legacy rows.
        if (operation.purpose !== 'delete' && this.deps.repository.isWechatStorageChannel(operation.channelId)) {
          this.deps.repository.abandonWechatCredentialOperation(operation, this.deps.now())
          continue
        }
        await this.recoverOperation(operation)
      } catch {
        if (operation.purpose === 'delete') this.deps.repository.deferOperation(operation.id, 'channel-delete-pending', this.deps.now())
        else this.deps.repository.deferOperation(operation.id, 'channel-management-recovery-pending', this.deps.now())
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

  private async write(
    input: { id: string; actorId: string; senderId: unknown; handoff: SecureHandoffSubmit; owner: TelegramLifecycleOwner },
    intent: 'provision' | 'rotate'
  ): Promise<ChannelManagementResult> {
    // Defense in depth: public service gates must not be the only barrier for a replayed handoff.
    if (this.deps.repository.channelType(input.id) === 'wechat') return { ok: false, code: 'channel-credential-invalid' }
    if (!this.ownsMutation(input.id, input.owner)) return this.staleMutation()
    const plaintext = await this.deps.handoff.consume({
      ...input.handoff,
      channelId: input.id,
      purpose: 'credential',
      senderId: assertSenderId(input.senderId)
    })
    try {
      if (!this.ownsMutation(input.id, input.owner)) return this.staleMutation()
      const type = this.deps.repository.channelType(input.id)
      if (!type) return { ok: false, code: 'channel-not-found' }
      const value = JSON.parse(new TextDecoder().decode(plaintext))
      const secret = type === 'slack'
        ? assertSlackSecret(value)
        : type === 'feishu'
          ? assertLarkSecret(value)
          : type === 'qq'
            ? assertQqSecret(value)
          : type === 'discord'
              ? assertDiscordSecret(value)
              : assertTelegramSecret(value)
      return intent === 'provision'
        ? await this.provisionReserved(input.id, input.actorId, type, secret, input.owner)
        : await this.rotateKnown(input.id, input.actorId, type, secret, input.owner)
    } catch (error) {
      const code = error instanceof Error && error.message === 'channel-input-invalid'
        ? 'channel-credential-invalid'
        : 'channel-credential-unavailable'
      return { ok: false, code }
    } finally {
      plaintext.fill(0)
    }
  }

  private async provisionReserved(id: string, actorId: string, type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat', secret: Record<string, string>, owner: TelegramLifecycleOwner): Promise<ChannelManagementResult> {
    if (!this.ownsMutation(id, owner) || this.deps.repository.hasPendingCredentialOperation(id)) {
      return { ok: false, code: 'channel-credential-unavailable' }
    }
    const now = this.deps.now()
    const reservation = await this.deps.vault.prepareMigration({ channelId: id, type, value: secret })
    if (!this.ownsMutation(id, owner)) return this.staleMutation()
    const operationId = randomUUID()
    if (!this.deps.repository.reserveOperation({
      id: operationId,
      channelId: id,
      purpose: 'provision',
      ref: reservation.credentialRef,
      fingerprint: reservation.sourceFingerprint,
      keyId: reservation.fingerprintKeyId,
      permit: reservation.migrationPermit,
      owner,
      now
    })) return { ok: false, code: 'channel-credential-unavailable' }
    if (!this.ownsMutation(id, owner)) {
      this.deps.repository.markOwnedOperationRevoked(operationId, owner, this.deps.now())
      return this.staleMutation()
    }
    if (!this.deps.repository.beginExternalCredentialCall(operationId, owner, this.deps.now())) return this.staleMutation()
    const safe = await this.deps.vault.putReserved({ channelId: id, type, value: secret, ...reservation })
    if (!this.ownsMutation(id, owner)) {
      this.deps.repository.markOperationExternalResult(operationId, { expectedRevision: safe.revision }, this.deps.now())
      const operation = this.deps.repository.operation(operationId)
      if (operation) {
        try { await this.recoverRevokedOperation(operation) } catch {}
      }
      return this.staleMutation()
    }
    if (!this.deps.repository.setCredential({ id, ref: safe.credentialRef, revision: safe.revision, expectedRevision: null, now: this.deps.now(), owner })) {
      this.deps.repository.deferOperation(operationId, 'channel-management-metadata-failed', this.deps.now(), owner)
      return { ok: false, code: 'channel-management-metadata-failed' }
    }
    if (!this.deps.repository.completeOperation(operationId, this.deps.now(), owner)) return this.staleMutation()
    this.deps.repository.audit(id, actorId, 'provision', null, this.deps.now())
    return { ok: true, code: 'configuration-ready', channel: this.deps.repository.query.get(id) ?? undefined }
  }

  private async rotateKnown(id: string, actorId: string, _type: 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat', secret: Record<string, string>, owner: TelegramLifecycleOwner): Promise<ChannelManagementResult> {
    if (!this.ownsMutation(id, owner) || this.deps.repository.hasPendingCredentialOperation(id)) {
      return { ok: false, code: 'channel-credential-unavailable' }
    }
    const current = this.deps.repository.credentialMetadata(id)
    if (!current || !this.deps.vault.rotateIfRevision || !this.deps.vault.inspectMutationReceipt) {
      return { ok: false, code: 'channel-credential-missing' }
    }
    const operationId = randomUUID()
    const now = this.deps.now()
    const mutationEpoch = owner.epoch
    if (typeof mutationEpoch !== 'number' || !Number.isSafeInteger(mutationEpoch) || mutationEpoch < 1) {
      return { ok: false, code: 'channel-credential-unavailable' }
    }
    if (!this.deps.repository.reserveOperation({ id: operationId, channelId: id, purpose: 'rotate', ref: current.ref, expectedRevision: current.revision, owner, now })) {
      return { ok: false, code: 'channel-credential-unavailable' }
    }
    if (!this.ownsMutation(id, owner)) {
      this.deps.repository.markOwnedOperationRevoked(operationId, owner, this.deps.now())
      return this.staleMutation()
    }
    if (!this.deps.repository.beginExternalCredentialCall(operationId, owner, this.deps.now())) return this.staleMutation()
    const safe = await this.deps.vault.rotateIfRevision(current.ref, current.revision, secret, {
      channelId: id,
      operationId,
      mutationEpoch
    })
    if (!this.ownsMutation(id, owner)) {
      this.deps.repository.markOperationExternalResult(operationId, { expectedRevision: current.revision }, this.deps.now())
      const operation = this.deps.repository.operation(operationId)
      if (operation) {
        try { await this.recoverRevokedOperation(operation) } catch {}
      }
      return this.staleMutation()
    }
    if (!this.deps.repository.setCredential({ id, ref: current.ref, revision: safe.revision, expectedRevision: current.revision, now: this.deps.now(), owner })) {
      this.deps.repository.deferOperation(operationId, 'channel-management-metadata-failed', this.deps.now(), owner)
      return { ok: false, code: 'channel-management-metadata-failed' }
    }
    if (!this.deps.repository.completeOperation(operationId, this.deps.now(), owner)) return this.staleMutation()
    this.deps.repository.audit(id, actorId, 'rotate', null, this.deps.now())
    return { ok: true, code: 'configuration-ready', channel: this.deps.repository.query.get(id) ?? undefined }
  }

  private async recoverOperation(operation: ChannelManagementOperation): Promise<void> {
    if (operation.purpose === 'delete') {
      await this.finalizeDelete(operation)
      return
    }
    const currentOwner = operation.lifecycleOwnerToken
      ? this.deps.repository.mutationOwnerForOperation(operation)
      : null
    if (operation.lifecycleOwnerToken && !currentOwner) {
      await this.recoverRevokedOperation(operation)
      return
    }
    if (currentOwner && operation.purpose === 'rotate' && operation.state === 'external-inflight') {
      await this.recoverOwnedCrashedRotation(operation)
      return
    }
    const safe = operation.purpose === 'provision'
      ? await this.inspectReserved(operation)
      : await this.inspectKnownCredential(operation.ref)
    if (!safe) {
      if (operation.purpose === 'provision') {
        // A reservation with no Vault record never received a credential; release only this known intent for retry.
        this.deps.repository.abandonOperation(operation.id, 'channel-credential-unavailable', this.deps.now())
        return
      }
      throw new Error('channel-management-recovery-pending')
    }
    if (operation.purpose === 'rotate') {
      if (operation.expectedRevision === null) throw new Error('channel-management-recovery-pending')
      if (safe.revision === operation.expectedRevision) {
        this.deps.repository.abandonOperation(operation.id, 'channel-credential-unavailable', this.deps.now())
        return
      }
      if (safe.revision !== operation.expectedRevision + 1) throw new Error('channel-management-recovery-pending')
      const receipt = await this.hasRotationReceipt(operation, safe.revision)
    if (!receipt) {
        this.deps.repository.markRevokedRotationUnavailable(operation, this.deps.now())
        this.deps.repository.completeUnattributedRotation(operation, this.deps.now())
        return
      }
    }
    const now = this.deps.now()
    if (!this.deps.repository.completeRecoveredCredentialOperation(operation, safe, now) &&
      !this.deps.repository.setRecoveredCredential(operation, safe, now)) {
      throw new Error('channel-management-recovery-pending')
    }
    if (!this.deps.repository.completeRecoveredCredentialOperation(operation, safe, now)) {
      throw new Error('channel-management-recovery-pending')
    }
  }

  private async inspectReserved(operation: ChannelManagementOperation) {
    if (!operation.fingerprint || !operation.keyId || !operation.permit) throw new Error('channel-management-recovery-pending')
    const type = this.channelType(operation.channelId)
    return this.deps.vault.inspectReserved({
      credentialRef: operation.ref,
      sourceFingerprint: operation.fingerprint,
      fingerprintKeyId: operation.keyId,
      migrationPermit: operation.permit,
      channelId: operation.channelId,
      type
    })
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
    let safe: Awaited<ReturnType<ChannelManagementCredentialService['inspectKnownCredential']>>
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

  private async recoverRevokedOperation(operation: ChannelManagementOperation): Promise<void> {
    const type = this.channelType(operation.channelId)
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
    const type = this.channelType(channelId)
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

  private ownsMutation(channelId: string, owner: TelegramLifecycleOwner): boolean {
    return this.deps.repository.ownsPendingMutationOwner(channelId, owner)
  }

  private staleMutation(): ChannelManagementResult {
    return { ok: false, code: 'channel-management-metadata-failed' }
  }

  private channelType(channelId: string): 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat' {
    const type = this.deps.repository.knownChannelType(channelId)
    if (!type) throw new Error('channel-management-recovery-pending')
    return type
  }
}
