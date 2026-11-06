import { randomUUID } from 'node:crypto'

import type { ChannelCredentialVault, ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import {
  assertIdentifier,
  assertBoundedInteger,
  type ChannelDeliveryTargetView,
  type ChannelManagementCatalogEntry,
  type ChannelManagementResult,
  type SecureHandoffSubmit
} from './ChannelManagementContracts'
import { ChannelManagementCredentialService } from './ChannelManagementCredentialService'
import { ChannelManagementRepository } from './ChannelManagementRepository'
import { projectDeliveryTargets } from './channelDeliveryTargetsProjection'
import { projectChannelCatalog } from './channelCatalogProjection'
import { createChannelTestMessageSender, type ChannelTestMessageReceipt } from './channelTestMessage'
import { requestSmokeEnabledChannel } from './channelSmokeEnable'
import { releaseChannelAcceptance } from './channelAcceptanceOverride'
import { reconcileEnabledChannels, resumeChannelsWithInvariant, stopDisplacedChannels } from './channelSingleEnabledEnforcement'
import { getWithCredentialPreviews, listWithCredentialPreviews } from './channelCredentialProjection'
import { createChannelInventory, type ChannelInventory } from './channelInventoryQueries'
import { requireExistingChannel } from './channelLookup'
import { listDeliveryAttemptsFor, listDeliveryAuditsFor } from './channelDeliveryQueries'
import { createManagedChannel, updateManagedChannel } from './channelSettingsMutations'
import { assertManagedChannelType } from './channelSettingsInputs'
import { clampAuditLimit, readAuditCursor } from './channelRuntimeAuditPage'
import type { AgentChannelType } from '../schemas/channelSchemas'
import { ChannelSecureHandoff } from './ChannelSecureHandoff'
import { channelAdapterDescriptor } from './channelAdapterDescriptors'
import { channelAdapterKeyForType } from './ChannelManagementPredicates'

type ManagementDependencies = {
  repository: ChannelManagementRepository
  vault: ChannelCredentialVault
  cipher: ChannelPayloadCipher
  registry: ChannelAdapterAcceptanceRegistry
  acceptance?: { isSupported: (adapterType: AgentChannelType) => boolean }
  handoff: ChannelSecureHandoff
  /** 出站投递（『发一条测试消息』用）；组合根装上才有，没装则回执 `not-ready`。 */
  delivery?: { deliver(request: import('./ChannelDeliveryContracts').ChannelDeliveryRequest): Promise<import('./ChannelDeliveryContracts').ChannelDeliveryResult> }
  /**
   * 用户点「启用」时的现场自检：用已存凭据真做一次握手与一次接收往返。
   * 平台的七项真机验收照旧决定「对外是否声明支持」，这条只决定「这位用户现在能不能用」。
   */
  smoke?: (channel: { id: string; type: AgentChannelType }) => Promise<{ ok: true } | { ok: false; code: string }>
  runtime?: {
    /**
     * 启动结果可以是布尔（旧实现）或带原因的结果。**启动失败的真实原因必须往上带**：
     * 以前这里只收布尔，于是 telegram 的启动失败被硬编码成 `telegram-network-unavailable`，
     * 用户被指去看代理与网络，而真实原因可能是凭据、占用或状态。
     */
    start: (channelId: string, generation: number, ownerToken: string) => Promise<boolean | { ok: boolean; reason?: string }>
    stop: (channelId: string, ownerToken?: string) => void
  }
  now?: () => Date
  /**
   * 启动对账用的单频道不变量：由组合根接到同一份数据库（服务不直接摸连接）。
   * 返回保留的那条与被停用的那些；停运行时与审计由服务负责。
   */
  singleEnabledChannel?: (now: string) => { kept: import('./singleEnabledChannel').DisplacedChannel | null; disabled: import('./singleEnabledChannel').DisplacedChannel[] }
}

type MutationInput = { id: unknown; actorId: unknown }

export class ChannelManagementService {
  private readonly credentials: ChannelManagementCredentialService
  private readonly testMessage: ReturnType<typeof createChannelTestMessageSender>
  private readonly channelMutations = new Map<string, Promise<void>>()

  private readonly inventory: ChannelInventory

  constructor(private readonly deps: ManagementDependencies) {
    this.inventory = createChannelInventory({ repository: deps.repository, registry: deps.registry })
    this.testMessage = createChannelTestMessageSender({ channels: () => this, deliver: () => this.deps.delivery, now: () => this.now() })
    this.credentials = new ChannelManagementCredentialService({
      repository: deps.repository,
      vault: deps.vault,
      cipher: deps.cipher,
      handoff: deps.handoff,
      now: () => this.now()
    })
  }

  setDelivery(delivery: NonNullable<ManagementDependencies['delivery']>): void { this.deps.delivery = delivery }

  setRuntime(runtime: NonNullable<ManagementDependencies['runtime']>): void {
    this.deps.runtime = runtime
  }

  catalog() { return this.inventory.catalog() }

  list() { return this.inventory.list() }

  /** 界面读：附凭据头尾掩码（异步解密一次）。推送端口仍用同步 `list()`。 */
  listWithCredentialPreviews() { return listWithCredentialPreviews(this.deps.repository, this.deps.vault, this.deps.repository.query.list()) }
  getWithCredentialPreviews(id: unknown) { return getWithCredentialPreviews(this.deps.repository, this.deps.vault, this.deps.repository.query.get(String(id))) }

  get(id: unknown) { return this.inventory.get(id) }
  listDeliveryTargets() { return this.inventory.listDeliveryTargets() }
  listAudits(input: { id: unknown; limit?: unknown; offset?: unknown }) { return this.inventory.listAudits(input) }
  listPolicies(input: { id: unknown; limit?: unknown }) { return this.inventory.listPolicies(input) }
  listConversations(input: { id: unknown; limit?: unknown }) { return this.inventory.listConversations(input) }
  runtimeStatus(input: { id: unknown }) { return this.inventory.runtimeStatus(input) }
  listDeliveryAttempts(input: { id: unknown; limit?: unknown; offset?: unknown }) { return this.inventory.listDeliveryAttempts(input) }
  listDeliveryAudits(input: { id: unknown; limit?: unknown; offset?: unknown }) { return this.inventory.listDeliveryAudits(input) }
  listRuntimeAudits(input: { id: unknown; limit?: unknown; cursor?: unknown }) { return this.inventory.listRuntimeAudits(input) }

  /** 真发一条测试消息，回执只有三种：受理 / 已交给通道但没拿到确认 / 失败给平台词。 */
  sendTestMessage(input: { id: unknown; text: unknown }): Promise<ChannelTestMessageReceipt> {
    return this.testMessage({ channelId: this.requireChannel(input.id), text: input.text })
  }

  create(input: Parameters<typeof createManagedChannel>[1]): ChannelManagementResult {
    return createManagedChannel(
      {
        repository: this.deps.repository,
        now: () => this.now(),
        stopRuntime: (id) => this.deps.runtime?.stop(id),
        requireMutableChannel: (id) => this.requireMutableChannel(id)
      },
      input
    )
  }

  update(input: Parameters<typeof updateManagedChannel>[1]): ChannelManagementResult {
    return updateManagedChannel(
      {
        repository: this.deps.repository,
        now: () => this.now(),
        stopRuntime: (id) => this.deps.runtime?.stop(id),
        requireMutableChannel: (id) => this.requireMutableChannel(id)
      },
      input
    )
  }

  disable(input: MutationInput): ChannelManagementResult {
    const id = this.requireMutableChannel(input.id)
    const type = this.deps.repository.channelType(id)
    if (!type) throw new Error('channel-not-found')
    const ok = this.deps.repository.disable(id, this.now())
    // 停用就把这次启用拿到的放行还回去：它不该在进程里继续算「可用」。
    if (ok) releaseChannelAcceptance(type)
    if (ok) this.deps.runtime?.stop(id)
    this.deps.repository.audit(id, assertIdentifier(input.actorId), 'disable', ok ? null : 'channel-not-found', this.now())
    return ok ? { ok: true, code: 'disabled', channel: this.deps.repository.query.get(id) ?? undefined } : { ok: false, code: 'channel-not-found' }
  }

  requestEnable(input: MutationInput): ChannelManagementResult | Promise<ChannelManagementResult> {
    const id = this.requireMutableChannel(input.id)
    const channel = this.deps.repository.query.get(id)
    if (!channel) return { ok: false, code: 'channel-not-found' }
    if (!this.canEnableAdapter(channel.type)) {
      // 平台整体还没「对外声明支持」不等于这位用户不能用：用他刚填的凭据现场自检一次，
      // 过了就只在这条通道上启用（进程内、不写库、不翻 supported），没过就把原因说清楚。
      const smoke = this.deps.smoke
      if (!smoke) return this.enableRejected(id, input.actorId, channel)
      return requestSmokeEnabledChannel(
        {
          smoke,
          audit: (code, summary) => this.deps.repository.audit(id, assertIdentifier(input.actorId), 'request-enable', code, this.now(), summary),
          enable: () => this.enableKnownChannel(id, channel, input.actorId)
        },
        { channel }
      )
    }
    return this.enableKnownChannel(id, channel, input.actorId)
  }

  private enableKnownChannel(
    id: string,
    channel: NonNullable<ReturnType<ChannelManagementService['get']>>,
    actorId: unknown
  ): ChannelManagementResult | Promise<ChannelManagementResult> {
    if (!this.deps.repository.credentialMetadata(id)) return this.enableRejected(id, actorId, channel, 'channel-credential-missing')
    const owner = this.deps.repository.beginLifecycleOwner(id, 'enable', randomUUID(), this.now())
    if (owner) return this.startOwnedRuntime(id, actorId, channel, owner, false)
    // A running Channel keeps its existing runtime owner; repeated enable is intentionally idempotent.
    if (channel.state === 'runtime-ready' && channel.requestedEnabled) return { ok: true, code: 'runtime-ready', channel }
    return this.enableRejected(id, actorId, channel, 'adapter-runtime-start-failed')
  }

  restart(input: MutationInput): ChannelManagementResult | Promise<ChannelManagementResult> {
    const id = this.requireMutableChannel(input.id)
    const channel = this.deps.repository.query.get(id)
    if (!channel) return { ok: false, code: 'channel-not-found' }
    if (!this.canEnableAdapter(channel.type)) return this.enableRejected(id, input.actorId, channel)
    const owner = this.deps.repository.beginLifecycleOwner(id, 'restart', randomUUID(), this.now())
    if (owner) this.deps.runtime?.stop(id)
    return owner ? this.startOwnedRuntime(id, input.actorId, channel, owner, true) : this.enableRejected(id, input.actorId, channel, 'adapter-runtime-start-failed')
  }

  private async startOwnedRuntime(
    id: string,
    actorId: unknown,
    channel: NonNullable<ReturnType<ChannelManagementService['get']>>,
    owner: import('./ChannelManagementRepository').TelegramLifecycleOwner,
    restart: boolean
  ): Promise<ChannelManagementResult> {
    const credentialCode = await this.verifyCredential(id)
    if (credentialCode) {
      this.deps.repository.failPendingLifecycleOwner(id, owner, this.now())
      return this.enableRejected(id, actorId, channel, credentialCode)
    }
    const activation = this.deps.repository.activateOwnedRuntime(id, owner, this.now())
    if (activation !== null) stopDisplacedChannels(this.enforcement(), activation.displaced)
    const activeOwner = activation?.owner
    if (!activeOwner?.generation) {
      // 先把真实原因问出来，再放掉 pending owner（放了就查不到 owner 那一档了）。
      // 以前这里非 restart 一律报 `channel-agent-missing`：拿「助手不在了」当兜底，
      // 用户从列表里明明看得见那个助手，却被告知刷新重选——错误码在说谎。
      const blockReason = this.deps.repository.enableBlockReason(id, owner)
      this.deps.repository.clearPendingLifecycleOwner(id, owner)
      return this.enableRejected(
        id,
        actorId,
        channel,
        blockReason ?? (restart ? 'adapter-runtime-start-failed' : 'channel-runtime-owner-conflict')
      )
    }
    this.deps.runtime?.stop(id)
    let started: boolean | { ok: boolean; reason?: string } = false
    try { started = this.deps.runtime ? await this.deps.runtime.start(id, activeOwner.generation, owner.token) : false } catch {}
    const startOk = typeof started === 'boolean' ? started : started.ok === true
    if (!startOk || !this.deps.repository.ownsLifecycleOwner(id, activeOwner)) {
      this.deps.runtime?.stop(id, owner.token)
      this.deps.repository.failOwnedRuntime(id, activeOwner, this.now())
      // 启动失败的真实原因由运行时给（`telegram-proxy-unavailable` / `telegram-conflict` 等），
      // 这里**不再替它编一个**：编出来的原因会把用户指到完全无关的方向。
      const startReason = typeof started === 'object' && started !== null && started.ok === false ? started.reason : undefined
      const rejected = this.enableRejected(
        id,
        actorId,
        channel,
        'adapter-runtime-start-failed',
        startReason ? { runtimeReason: startReason } : undefined
      )
      return startReason ? { ...rejected, reason: startReason } : rejected
    }
    this.deps.repository.audit(id, assertIdentifier(actorId), restart ? 'restart' : 'request-enable', null, this.now())
    return {
      ok: true,
      code: restart ? 'restarted' : 'runtime-ready',
      channel: this.deps.repository.query.get(id) ?? undefined
    }
  }

  async beginCredential(input: { id: unknown; senderId: unknown }) {
    const id = this.requireMutableChannel(input.id)
    // Release F enrollment is QR-only and its public protocol is not frozen; generic credential handoff is forbidden.
    if (this.deps.repository.channelType(id) === 'wechat') throw new Error('channel-input-invalid')
    return this.deps.handoff.begin({ channelId: id, purpose: 'credential', senderId: this.senderId(input.senderId) })
  }

  async beginPolicy(input: { id: unknown; senderId: unknown }) {
    const id = this.requireMutableChannel(input.id)
    // Release F has no policy/Vault path until its public protocol is frozen.
    if (this.deps.repository.channelType(id) === 'wechat') throw new Error('channel-input-invalid')
    return this.deps.handoff.begin({ channelId: id, purpose: 'policy', senderId: this.senderId(input.senderId) })
  }

  async createPolicy(input: { id: unknown; actorId: unknown; senderId: unknown; handoff: SecureHandoffSubmit }): Promise<{ ok: boolean; code: string }> {
    const id = assertIdentifier(input.id)
    return this.withChannelMutation(id, async () => this.writePolicy({ ...input, id }))
  }

  deletePolicy(input: { channelId: unknown; policyId: unknown; actorId: unknown }): { ok: boolean; code: 'policy-deleted' | 'channel-not-found' } {
    const channelId = this.requireMutableChannel(input.channelId)
    if (this.deps.repository.channelType(channelId) === 'wechat') return { ok: false, code: 'channel-not-found' }
    const ok = this.deps.repository.deletePolicy(channelId, assertIdentifier(input.policyId))
    this.deps.repository.audit(channelId, assertIdentifier(input.actorId), 'policy-delete', ok ? null : 'channel-not-found', this.now())
    return { ok, code: ok ? 'policy-deleted' : 'channel-not-found' }
  }

  setTarget(input: { channelId: unknown; conversationId: unknown; enabled: boolean; actorId: unknown }): { ok: boolean; code: 'target-updated' | 'channel-not-found' } {
    const channelId = this.requireMutableChannel(input.channelId)
    if (this.deps.repository.channelType(channelId) === 'wechat') return { ok: false, code: 'channel-not-found' }
    const ok = this.deps.repository.setTarget(channelId, assertIdentifier(input.conversationId), input.enabled, this.now())
    this.deps.repository.audit(channelId, assertIdentifier(input.actorId), 'target-set', ok ? null : 'channel-not-found', this.now())
    return { ok, code: ok ? 'target-updated' : 'channel-not-found' }
  }

  async provision(input: {
    id: unknown
    actorId: unknown
    senderId: unknown
    handoff: SecureHandoffSubmit
  }): Promise<ChannelManagementResult> {
    const id = assertIdentifier(input.id)
    const mutableId = this.requireMutableChannel(id)
    if (this.deps.repository.channelType(mutableId) === 'wechat') return { ok: false, code: 'channel-credential-invalid' }
    if (!this.deps.repository.disable(mutableId, this.now())) return { ok: false, code: 'channel-not-found' }
    this.deps.runtime?.stop(id)
    const owner = this.deps.repository.beginLifecycleOwner(id, 'mutation', randomUUID(), this.now())
    if (!owner) return { ok: false, code: 'channel-management-metadata-failed' }
    try {
      return await this.withChannelMutation(id, async () => this.credentials.provision({
        id: this.requireMutableChannel(id), actorId: assertIdentifier(input.actorId), senderId: input.senderId, handoff: input.handoff, owner
      }))
    } finally { this.deps.repository.clearPendingLifecycleOwner(id, owner) }
  }

  async rotate(input: {
    id: unknown
    actorId: unknown
    senderId: unknown
    handoff: SecureHandoffSubmit
  }): Promise<ChannelManagementResult> {
    const id = assertIdentifier(input.id)
    // Rotation invalidates the active credential generation before waiting for a queued handoff/Vault operation.
    const mutableId = this.requireMutableChannel(id)
    if (this.deps.repository.channelType(mutableId) === 'wechat') return { ok: false, code: 'channel-credential-invalid' }
    if (!this.deps.repository.disable(mutableId, this.now())) return { ok: false, code: 'channel-not-found' }
    this.deps.runtime?.stop(id)
    const owner = this.deps.repository.beginLifecycleOwner(id, 'mutation', randomUUID(), this.now())
    if (!owner) return { ok: false, code: 'channel-management-metadata-failed' }
    try {
      return await this.withChannelMutation(id, async () => {
      return this.credentials.rotate({
        id: this.requireMutableChannel(id), actorId: assertIdentifier(input.actorId), senderId: input.senderId, handoff: input.handoff, owner
      })
    })
    } finally { this.deps.repository.clearPendingLifecycleOwner(id, owner) }
  }

  async delete(input: MutationInput): Promise<ChannelManagementResult> {
    const id = assertIdentifier(input.id)
    const now = this.now()
    const operation = this.deps.repository.beginDelete(id, randomUUID(), now)
    if (!operation) return { ok: false, code: 'channel-not-found' } as ChannelManagementResult
    this.deps.runtime?.stop(id)
    return this.withChannelMutation(id, async () => {
      const deletedType = this.deps.repository.channelType(id)
      if (deletedType) releaseChannelAcceptance(deletedType)
      this.deps.repository.audit(id, assertIdentifier(input.actorId), 'delete', null, now)
      try {
        await this.credentials.finalizeDelete(operation)
        return { ok: true, code: 'deleted' } as ChannelManagementResult
      } catch {
        this.deps.repository.deferOperation(operation.id, 'channel-delete-pending', this.now())
        return { ok: false, code: 'channel-delete-pending', channel: this.deps.repository.query.get(id) ?? undefined } as ChannelManagementResult
      }
    })
  }

  /** Restarts channels whose intent survived a graceful quit；恢复前后各对一次单频道不变量。 */
  async resumeRequested(): Promise<void> {
    await resumeChannelsWithInvariant({
      ...this.enforcement(),
      resumableChannelIds: () => this.deps.repository.resumableChannelIds(),
      readChannel: (id) => this.deps.repository.query.get(id),
      canEnableAdapter: (channel) => this.canEnableAdapter(channel.type as AgentChannelType),
      restart: (input) => this.restart(input), requestEnable: (input) => this.requestEnable(input),
      disable: (input) => this.disable(input)
    })
  }

  async recover(): Promise<void> {
    await this.credentials.recover()
    for (const credential of this.deps.repository.managedCredentialRows()) {
      try {
        if (!this.deps.vault.inspectSafe) throw new Error('channel-credential-inspection-unavailable')
        const safe = await this.deps.vault.inspectSafe(credential.ref)
        this.deps.repository.setCredentialHealth(
          credential.channelId,
          safe === null ? 'missing' : safe.revision === credential.revision ? 'configured' : 'unavailable',
          this.now()
        )
      } catch {
        this.deps.repository.setCredentialHealth(credential.channelId, 'unavailable', this.now())
      }
    }
  }

  /** 启动对账：保留最近启用的那条，其余停用并留一行审计。 */
  reconcileSingleEnabledChannel(): { keptChannelId: string | null; disabledChannelIds: string[] } {
    return reconcileEnabledChannels(this.enforcement())
  }

  /** 单频道不变量的执行上下文（停运行时、还放行、写审计都在 `channelSingleEnabledEnforcement`）。 */
  private enforcement() {
    return {
      repository: this.deps.repository,
      ...(this.deps.runtime ? { runtime: this.deps.runtime } : {}),
      now: () => this.now(),
      releaseAcceptance: (adapter: string) => { releaseChannelAcceptance(adapter) },
      ...(this.deps.singleEnabledChannel ? { reconcile: this.deps.singleEnabledChannel } : {})
    }
  }

  private requireChannel(id: unknown): string {
    return requireExistingChannel(this.deps.repository, id)
  }

  private async writePolicy(input: { id: string; actorId: unknown; senderId: unknown; handoff: SecureHandoffSubmit }): Promise<{ ok: boolean; code: string }> {
    const id = this.requireMutableChannel(input.id)
    const actorId = assertIdentifier(input.actorId)
    // This final gate also rejects a replayed handoff after the UI or begin gate changes.
    if (this.deps.repository.channelType(id) === 'wechat') return { ok: false, code: 'channel-policy-invalid' }
    const plaintext = await this.deps.handoff.consume({
      ...input.handoff,
      channelId: id,
      purpose: 'policy',
      senderId: this.senderId(input.senderId)
    })
    try {
      const policy = validatePolicy(JSON.parse(new TextDecoder().decode(plaintext)))
      const subject = new TextEncoder().encode(policy.key)
      const encrypted = await this.deps.cipher.encrypt(id, subject)
      if (!this.deps.repository.createPolicy({
        channelId: id,
        subjectType: policy.subjectType,
        ciphertext: encrypted.ciphertext,
        keyRef: encrypted.keyRef,
        keyRevision: encrypted.keyRevision,
        keyHash: await this.deps.cipher.keyedHash(id, subject),
        conversationKind: policy.conversationKind,
        now: this.now()
      })) return { ok: false, code: 'channel-policy-invalid' }
      this.deps.repository.audit(id, actorId, 'policy-create', null, this.now())
      return { ok: true, code: 'policy-created' }
    } catch {
      this.deps.repository.audit(id, actorId, 'policy-create', 'channel-policy-invalid', this.now())
      return { ok: false, code: 'channel-policy-invalid' }
    } finally {
      plaintext.fill(0)
    }
  }

  private requireMutableChannel(id: unknown): string {
    const normalized = this.requireChannel(id)
    if (this.deps.repository.query.get(normalized)?.state === 'deleting') throw new Error('channel-not-found')
    return normalized
  }

  private async withChannelMutation<T>(channelId: string, action: () => Promise<T>): Promise<T> {
    const prior = this.channelMutations.get(channelId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = prior.then(() => current)
    this.channelMutations.set(channelId, queued)
    await prior
    try {
      return await action()
    } finally {
      release()
      if (this.channelMutations.get(channelId) === queued) this.channelMutations.delete(channelId)
    }
  }

  private now(): string {
    return (this.deps.now?.() ?? new Date()).toISOString()
  }

  private senderId(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('channel-input-invalid')
    return value
  }

  private async verifyCredential(id: string): Promise<'channel-credential-missing' | 'channel-credential-unavailable' | null> {
    const metadata = this.deps.repository.credentialMetadata(id)
    if (!metadata) return 'channel-credential-missing'
    try {
      const safe = await this.deps.vault.inspectSafe?.(metadata.ref)
      return safe?.revision === metadata.revision ? null : 'channel-credential-unavailable'
    } catch { return 'channel-credential-unavailable' }
  }

  private canEnableAdapter(adapterType: AgentChannelType): boolean {
    return this.deps.acceptance?.isSupported(adapterType) ?? this.deps.registry.canEnable(adapterType)
  }

  private enableRejected(
    id: string,
    actorId: unknown,
    channel: NonNullable<ReturnType<ChannelManagementService['get']>>,
    code: ChannelManagementResult['code'] = 'adapter-not-supported',
    summary?: Record<string, string>
  ): ChannelManagementResult {
    this.deps.repository.audit(id, assertIdentifier(actorId), 'request-enable', code, this.now(), summary)
    return { ok: false, code, channel }
  }
}

function validatePolicy(value: unknown): {
  subjectType: 'user' | 'conversation'
  key: string
  conversationKind: 'direct' | 'group' | 'channel' | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('channel-policy-invalid')
  const policy = value as Record<string, unknown>
  if (policy.subjectType !== 'user' && policy.subjectType !== 'conversation') throw new Error('channel-policy-invalid')
  if (typeof policy.key !== 'string' || !policy.key.trim() || policy.key.length > 512) throw new Error('channel-policy-invalid')
  const conversationKind = policy.conversationKind ?? null
  if (conversationKind !== null && conversationKind !== 'direct' && conversationKind !== 'group' && conversationKind !== 'channel') {
    throw new Error('channel-policy-invalid')
  }
  return { subjectType: policy.subjectType, key: policy.key.trim(), conversationKind }
}
