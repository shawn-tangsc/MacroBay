import { randomUUID } from 'node:crypto'

import type {
  ChannelCredentialSafeView,
  ChannelCredentialVault,
  ChannelPayloadCipher
} from '../../../secrets/channels/channelCredentialContracts'
import type { AgentChannelType } from '../schemas/channelSchemas'
import { assertDiscordSecret, assertLarkSecret, assertQqSecret, assertSenderId, assertSlackSecret, assertTelegramSecret, type ChannelManagementResult, type SecureHandoffSubmit } from './ChannelManagementContracts'
import { ChannelManagementRepository, type TelegramLifecycleOwner } from './ChannelManagementRepository'
import { ChannelCredentialRecoveryService } from './ChannelCredentialRecoveryService'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'

type CredentialDependencies = {
  repository: ChannelManagementRepository
  vault: ChannelCredentialVault
  cipher: ChannelPayloadCipher
  handoff: ChannelSecureHandoff
  now: () => string
}

export class ChannelManagementCredentialService {
  private readonly recovery: ChannelCredentialRecoveryService

  constructor(private readonly deps: CredentialDependencies) {
    this.recovery = new ChannelCredentialRecoveryService({
      repository: deps.repository,
      vault: deps.vault,
      cipher: deps.cipher,
      now: deps.now
    })
  }

  /** 启动恢复：历史操作留下的预留记录在这里落定或收口。 */
  async recover(): Promise<void> {
    return this.recovery.recover()
  }

  async finalizeDelete(operation: Parameters<ChannelCredentialRecoveryService['finalizeDelete']>[0]): Promise<void> {
    return this.recovery.finalizeDelete(operation)
  }

  async provision(input: { id: string; actorId: string; senderId: unknown; handoff: SecureHandoffSubmit; owner: TelegramLifecycleOwner }): Promise<ChannelManagementResult> {
    return this.write(input, 'provision')
  }

  async rotate(input: { id: string; actorId: string; senderId: unknown; handoff: SecureHandoffSubmit; owner: TelegramLifecycleOwner }): Promise<ChannelManagementResult> {
    return this.write(input, 'rotate')
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
      // 编辑弹层保存 Token 走的是 `rotate`，「新建」走 `provision`。两条都得先看清**已有凭据的真实形态**：
      // 能正常读 → 就地轮换；读不出来（预留记录、或已失效）→ 新写入 + 切 ref + 旧记录幂等清理。
      // 以前只有「有元数据就 rotate」这一条判据，而所有凭据都是预留记录 → 换 Token 必然失败，
      // 用户的凭据还被那几次失败的 rotate 打成 unavailable（每试一次多一条卡住的操作）。
      const current = this.deps.repository.credentialMetadata(input.id)
      const expectedRevision = current?.revision ?? null
      // 「读不出来」才换 ref 重写；「读得出来但 revision 落后」仍旧走轮换，让 CAS 失败如实报出来
      // （`channel-credential-mutation-incomplete`），不能拿一次重写把它悄悄盖过去。
      const readable = current ? await this.credentialReadState(current) : 'unreadable'
      if (intent === 'rotate' && current && readable !== 'unreadable') {
        return await this.rotateKnown(input.id, input.actorId, type, secret, input.owner)
      }
      return await this.provisionReserved(input.id, input.actorId, type, secret, input.owner, expectedRevision, current ?? undefined)
    } catch (error) {
      const code = error instanceof Error && error.message === 'channel-input-invalid'
        ? 'channel-credential-invalid'
        : 'channel-credential-unavailable'
      return { ok: false, code }
    } finally {
      plaintext.fill(0)
    }
  }

  /**
   * 写入凭据：`putReserved` → **`settleReserved`** → 再 `setCredential`。
   *
   * 顺序不能反：库里必须先有落定后的 revision，否则 `verifyCredential` 的
   * `safe.revision === metadata.revision` 仍会判 unavailable——那正是「存了却读不出来」的来源。
   * `expectedRevision` 非空表示这条频道已经有一条（读不出来的）旧凭据，这次要切到这个新 ref。
   */
  private async provisionReserved(
    id: string,
    actorId: string,
    type: AgentChannelType,
    secret: Record<string, string>,
    owner: TelegramLifecycleOwner,
    expectedRevision: number | null,
    previous?: { ref: string; revision: number }
  ): Promise<ChannelManagementResult> {
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
      ...(expectedRevision === null ? {} : { expectedRevision }),
      owner,
      now
    })) return { ok: false, code: 'channel-credential-unavailable' }
    if (!this.ownsMutation(id, owner)) {
      this.deps.repository.markOwnedOperationRevoked(operationId, owner, this.deps.now())
      return this.staleMutation()
    }
    if (!this.deps.repository.beginExternalCredentialCall(operationId, owner, this.deps.now())) return this.staleMutation()

    let reserved: ChannelCredentialSafeView
    try {
      reserved = await this.deps.vault.putReserved({ channelId: id, type, value: secret, ...reservation })
    } catch (error) {
      // 写失败也可能已经落了一条记录（写与读不是同一个动作）：登记成清理意图再抛，
      // 现场能清就清，清不掉交给启动恢复——不能只 abandon、把可能的记录留在库里没人知道。
      await this.abandonReservedWrite(operationId)
      throw error
    }
    if (!this.ownsMutation(id, owner)) {
      this.deps.repository.markOperationExternalResult(operationId, { expectedRevision: reserved.revision }, this.deps.now())
      const operation = this.deps.repository.operation(operationId)
      if (operation) {
        try { await this.recovery.recoverRevokedOperation(operation) } catch {}
      }
      return this.staleMutation()
    }

    let settled: ChannelCredentialSafeView
    try {
      settled = await this.deps.vault.settleReserved({
        ...reservation,
        channelId: id,
        type,
        expectedRevision: reserved.revision
      })
    } catch (error) {
      // 记录留在了「预留」形态：登记成一次清理意图（revoked-cleanup），现场能清就清，
      // 清不掉交给启动恢复的有界清理——绝不把它留在 external-inflight 让下次启动把它算成「恢复中」。
      await this.abandonReservedWrite(operationId, reserved.revision)
      throw error
    }
    if (!this.deps.repository.setCredential({
      id,
      ref: settled.credentialRef,
      revision: settled.revision,
      expectedRevision,
      now: this.deps.now(),
      owner
    })) {
      this.deps.repository.deferOperation(operationId, 'channel-management-metadata-failed', this.deps.now(), owner)
      return { ok: false, code: 'channel-management-metadata-failed' }
    }
    if (!this.deps.repository.completeOperation(operationId, this.deps.now(), owner)) return this.staleMutation()
    this.deps.repository.audit(id, actorId, 'provision', null, this.deps.now())
    // 切到新 ref 之后，旧的那条预留记录（里面的旧 Token）必须清掉：不清理，删频道时不会有人知道它存在，
    // 旧凭据会永久留在盘上。清理本身允许失败，失败就留在 revoked-cleanup 里等启动恢复。
    if (previous && previous.ref !== settled.credentialRef) {
      await this.recovery.retireSupersededReserved(id, type, previous)
    }
    return { ok: true, code: 'configuration-ready', channel: this.deps.repository.query.get(id) ?? undefined }
  }

  private async rotateKnown(id: string, actorId: string, _type: AgentChannelType, secret: Record<string, string>, owner: TelegramLifecycleOwner): Promise<ChannelManagementResult> {
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

    let safe: ChannelCredentialSafeView
    try {
      safe = await this.deps.vault.rotateIfRevision(current.ref, current.revision, secret, {
        channelId: id,
        operationId,
        mutationEpoch
      })
    } catch {
      // 失败当场收尾：以前这里把操作留在 external-inflight，下次启动会把它当作「恢复中」并把
      // credential_health 打成 unavailable——用户每试一次就更坏一点，正是那 9 条卡住记录的来路。
      const code = await this.classifyRotationFailure(current)
      this.deps.repository.abandonOperation(operationId, code, this.deps.now())
      return { ok: false, code }
    }
    if (!this.ownsMutation(id, owner)) {
      this.deps.repository.markOperationExternalResult(operationId, { expectedRevision: current.revision }, this.deps.now())
      const operation = this.deps.repository.operation(operationId)
      if (operation) {
        try { await this.recovery.recoverRevokedOperation(operation) } catch {}
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

  /**
   * 轮换失败要能分辨两种完全不同的处境：
   * - `channel-credential-mutation-incomplete`：库里的 revision 已经不是我们读到的那一版（别处改过/上次没收尾），
   *   重新打开编辑保存一次就能继续；
   * - `channel-credential-unavailable`：Vault 本身取不到值（不可用）。
   * 一律压成后者，界面只能说「没存上」，用户不知道下一步该做什么。
   */
  private async classifyRotationFailure(current: { ref: string; revision: number }): Promise<'channel-credential-mutation-incomplete' | 'channel-credential-unavailable'> {
    try {
      const safe = await this.deps.vault.inspectSafe?.(current.ref)
      if (safe === null) return 'channel-credential-unavailable'
      return safe && safe.revision !== current.revision ? 'channel-credential-mutation-incomplete' : 'channel-credential-unavailable'
    } catch {
      return 'channel-credential-unavailable'
    }
  }

  /**
   * 一条已有凭据的读法三态，用来决定「就地轮换」还是「换 ref 重写」：
   * - `configured`：读得到且 revision 对得上 → 正常轮换；
   * - `stale`：读得到但 revision 落后 → 仍走轮换，让 CAS 失败如实报 `mutation-incomplete`；
   * - `unreadable`：读不出来（预留记录 / 记录不在 / Vault 不可用）→ 轮换没有对象，只能新写入 + 切 ref。
   */
  private async credentialReadState(metadata: { ref: string; revision: number }): Promise<'configured' | 'stale' | 'unreadable'> {
    try {
      const safe = await this.deps.vault.inspectSafe?.(metadata.ref)
      if (!safe) return 'unreadable'
      return safe.revision === metadata.revision ? 'configured' : 'stale'
    } catch {
      return 'unreadable'
    }
  }

  /** 外部 Vault 调用中途失败时的统一收尾：登记清理意图 → 现场清理（失败就留给启动恢复）。 */
  private async abandonReservedWrite(operationId: string, expectedRevision?: number): Promise<void> {
    this.deps.repository.markOperationExternalResult(operationId, { expectedRevision: expectedRevision ?? null }, this.deps.now())
    const operation = this.deps.repository.operation(operationId)
    if (!operation) return
    try { await this.recovery.recoverRevokedOperation(operation) } catch {}
  }

  private ownsMutation(channelId: string, owner: TelegramLifecycleOwner): boolean {
    return this.deps.repository.ownsPendingMutationOwner(channelId, owner)
  }

  private staleMutation(): ChannelManagementResult {
    return { ok: false, code: 'channel-management-metadata-failed' }
  }

}
