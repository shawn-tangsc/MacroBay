import { randomUUID } from 'node:crypto'

import type { ChannelCredentialVault, ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import {
  assertIdentifier,
  assertBoundedInteger,
  type ChannelManagementCatalogEntry,
  type ChannelManagementResult,
  type SecureHandoffSubmit
} from './ChannelManagementContracts'
import { ChannelManagementCredentialService } from './ChannelManagementCredentialService'
import { ChannelManagementRepository } from './ChannelManagementRepository'
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
  runtime?: {
    start: (channelId: string, generation: number, ownerToken: string) => Promise<boolean>
    stop: (channelId: string, ownerToken?: string) => void
  }
  now?: () => Date
}

type MutationInput = { id: unknown; actorId: unknown }

export class ChannelManagementService {
  private readonly credentials: ChannelManagementCredentialService
  private readonly channelMutations = new Map<string, Promise<void>>()

  constructor(private readonly deps: ManagementDependencies) {
    this.credentials = new ChannelManagementCredentialService({
      repository: deps.repository,
      vault: deps.vault,
      cipher: deps.cipher,
      handoff: deps.handoff,
      now: () => this.now()
    })
  }

  setRuntime(runtime: NonNullable<ManagementDependencies['runtime']>): void {
    this.deps.runtime = runtime
  }

  catalog(): ChannelManagementCatalogEntry[] {
    return this.deps.registry.list().map((entry) => {
      const descriptor = channelAdapterDescriptor(channelAdapterKeyForType(entry.adapterType))
      return {
        type: entry.adapterType,
        status: entry.status === 'supported' ? 'supported' : entry.status === 'planned' ? 'planned' : 'blocked',
        reason: entry.status === 'supported' ? 'evidence-complete' : entry.status === 'planned' ? 'release-a-pending' : 'adapter-blocked',
        implemented: descriptor.implemented,
        credentialFields: descriptor.credentialFields
      }
    })
  }

  list() {
    return this.deps.repository.query.list()
  }

  listAudits(input: { id: unknown; limit?: unknown; offset?: unknown }) {
    return this.deps.repository.query.audits(
      this.requireChannel(input.id),
      assertBoundedInteger(input.limit, 50, 100) || 1,
      assertBoundedInteger(input.offset, 0, 10_000)
    )
  }

  listPolicies(input: { id: unknown; limit?: unknown }) {
    const id = this.requireChannel(input.id)
    if (this.deps.repository.channelType(id) === 'wechat') return []
    return this.deps.repository.query.policies(id, assertBoundedInteger(input.limit, 50, 100) || 1)
  }

  listConversations(input: { id: unknown; limit?: unknown }) {
    const id = this.requireChannel(input.id)
    if (this.deps.repository.channelType(id) === 'wechat') return []
    return this.deps.repository.query.conversations(id, assertBoundedInteger(input.limit, 50, 100) || 1)
  }

  runtimeStatus(input: { id: unknown }) {
    const id = this.requireChannel(input.id)
    return this.deps.repository.query.runtime(id)
  }

  listDeliveryAttempts(input: { id: unknown; limit?: unknown; offset?: unknown }) {
    const id = this.requireChannel(input.id)
    if (this.deps.repository.channelType(id) === 'wechat') return []
    return this.deps.repository.query.deliveryAttempts(
      id,
      assertBoundedInteger(input.limit, 50, 100) || 1,
      assertBoundedInteger(input.offset, 0, 10_000)
    )
  }

  listDeliveryAudits(input: { id: unknown; limit?: unknown; offset?: unknown }) {
    const id = this.requireChannel(input.id)
    if (this.deps.repository.channelType(id) === 'wechat') return []
    return this.deps.repository.query.deliveryAudits(
      id,
      assertBoundedInteger(input.limit, 50, 100) || 1,
      assertBoundedInteger(input.offset, 0, 10_000)
    )
  }

  get(id: unknown) {
    return this.deps.repository.query.get(assertIdentifier(id))
  }

  create(input: { type?: unknown; name: unknown; agentId: unknown; actorId: unknown }): ChannelManagementResult {
    if (Object.hasOwn(input, 'id')) throw new Error('channel-input-invalid')
    const id = randomUUID()
    const type = assertManagedChannelType(input.type)
    const agentId = assertIdentifier(input.agentId)
    const actorId = assertIdentifier(input.actorId)
    if (!this.deps.repository.agentExists(agentId)) return { ok: false, code: 'channel-agent-missing' }

    const now = this.now()
    if (!this.deps.repository.create({ id, type, name: assertIdentifier(input.name, 120), agentId, now })) {
      return { ok: false, code: 'channel-not-found' }
    }
    this.deps.repository.audit(id, actorId, 'create', null, now)
    return { ok: true, code: 'configuration-ready', channel: this.deps.repository.query.get(id) ?? undefined }
  }

  update(input: { id: unknown; name: unknown; agentId: unknown; actorId: unknown }): ChannelManagementResult {
    const id = this.requireMutableChannel(input.id)
    const actorId = assertIdentifier(input.actorId)
    const agentId = assertIdentifier(input.agentId)
    if (!this.deps.repository.agentExists(agentId)) return { ok: false, code: 'channel-agent-missing' }

    const ok = this.deps.repository.update(id, { name: assertIdentifier(input.name, 120), agentId, now: this.now() })
    if (ok) this.deps.runtime?.stop(id)
    this.deps.repository.audit(id, actorId, 'update', ok ? null : 'channel-not-found', this.now())
    return ok ? { ok: true, code: 'updated', channel: this.deps.repository.query.get(id) ?? undefined } : { ok: false, code: 'channel-not-found' }
  }

  disable(input: MutationInput): ChannelManagementResult {
    const id = this.requireMutableChannel(input.id)
    const ok = this.deps.repository.disable(id, this.now())
    if (ok) this.deps.runtime?.stop(id)
    this.deps.repository.audit(id, assertIdentifier(input.actorId), 'disable', ok ? null : 'channel-not-found', this.now())
    return ok ? { ok: true, code: 'disabled', channel: this.deps.repository.query.get(id) ?? undefined } : { ok: false, code: 'channel-not-found' }
  }

  requestEnable(input: MutationInput): ChannelManagementResult | Promise<ChannelManagementResult> {
    const id = this.requireMutableChannel(input.id)
    const channel = this.deps.repository.query.get(id)
    if (!channel) return { ok: false, code: 'channel-not-found' }
    if (!this.canEnableAdapter(channel.type)) return this.enableRejected(id, input.actorId, channel)
    const owner = this.deps.repository.beginLifecycleOwner(id, 'enable', randomUUID(), this.now())
    if (owner) return this.enableRuntime(id, input.actorId, channel, owner)
    // A running Channel keeps its existing runtime owner; repeated enable is intentionally idempotent.
    if (channel.state === 'runtime-ready' && channel.requestedEnabled) return { ok: true, code: 'runtime-ready', channel }
    return this.enableRejected(id, input.actorId, channel, 'adapter-runtime-start-failed')
  }

  restart(input: MutationInput): ChannelManagementResult | Promise<ChannelManagementResult> {
    const id = this.requireMutableChannel(input.id)
    const channel = this.deps.repository.query.get(id)
    if (!channel) return { ok: false, code: 'channel-not-found' }
    if (!this.canEnableAdapter(channel.type)) return this.enableRejected(id, input.actorId, channel)
    const owner = this.deps.repository.beginLifecycleOwner(id, 'restart', randomUUID(), this.now())
    if (owner) this.deps.runtime?.stop(id)
    return owner ? this.startRestart(id, input.actorId, channel, owner) : this.enableRejected(id, input.actorId, channel, 'adapter-runtime-start-failed')
  }

  private async enableRuntime(id: string, actorId: unknown, channel: NonNullable<ReturnType<ChannelManagementService['get']>>, owner: import('./ChannelManagementRepository').TelegramLifecycleOwner): Promise<ChannelManagementResult> {
    const credentialCode = await this.verifyCredential(id)
    if (credentialCode) {
      this.deps.repository.failPendingLifecycleOwner(id, owner, this.now())
      return this.enableRejected(id, actorId, channel, credentialCode)
    }
    const activeOwner = this.deps.repository.activateOwnedRuntime(id, owner, this.now())
    if (!activeOwner?.generation) {
      this.deps.repository.clearPendingLifecycleOwner(id, owner)
      return this.enableRejected(id, actorId, channel, 'channel-agent-missing')
    }
    this.deps.runtime?.stop(id)
    let started = false
    try { started = Boolean(this.deps.runtime && await this.deps.runtime.start(id, activeOwner.generation, owner.token)) } catch {}
    if (!started || !this.deps.repository.ownsLifecycleOwner(id, activeOwner)) {
      this.deps.runtime?.stop(id, owner.token)
      this.deps.repository.failOwnedRuntime(id, activeOwner, this.now())
      return this.enableRejected(id, actorId, channel, 'adapter-runtime-start-failed')
    }
    this.deps.repository.audit(id, assertIdentifier(actorId), 'request-enable', null, this.now())
    return { ok: true, code: 'runtime-ready', channel: this.deps.repository.query.get(id) ?? undefined }
  }

  private async startRestart(id: string, actorId: unknown, channel: NonNullable<ReturnType<ChannelManagementService['get']>>, owner: import('./ChannelManagementRepository').TelegramLifecycleOwner): Promise<ChannelManagementResult> {
    const credentialCode = await this.verifyCredential(id)
    if (credentialCode) {
      this.deps.repository.failPendingLifecycleOwner(id, owner, this.now())
      return this.enableRejected(id, actorId, channel, credentialCode)
    }
    const activeOwner = this.deps.repository.activateOwnedRuntime(id, owner, this.now())
    if (!activeOwner?.generation) {
      this.deps.repository.clearPendingLifecycleOwner(id, owner)
      return this.enableRejected(id, actorId, channel, 'adapter-runtime-start-failed')
    }
    this.deps.runtime?.stop(id)
    let started = false
    try { started = Boolean(this.deps.runtime && await this.deps.runtime.start(id, activeOwner.generation, owner.token)) } catch {}
    if (!started || !this.deps.repository.ownsLifecycleOwner(id, activeOwner)) {
      this.deps.runtime?.stop(id, owner.token)
      this.deps.repository.failOwnedRuntime(id, activeOwner, this.now())
      return this.enableRejected(id, actorId, channel, 'adapter-runtime-start-failed')
    }
    this.deps.repository.audit(id, assertIdentifier(actorId), 'restart', null, this.now())
    return { ok: true, code: 'restarted', channel: this.deps.repository.query.get(id) ?? undefined }
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

  /** Restarts channels whose intent survived a graceful quit; unsupported/broken rows are disabled. */
  async resumeRequested(): Promise<void> {
    for (const id of this.deps.repository.resumableChannelIds()) {
      const result = await this.restart({ id, actorId: 'channel-startup' })
      if (!result.ok) this.disable({ id, actorId: 'channel-startup' })
    }
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

  private requireChannel(id: unknown): string {
    const normalized = assertIdentifier(id)
    if (!this.deps.repository.query.get(normalized)) throw new Error('channel-not-found')
    return normalized
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
    this.channelMutations.set(channelId, prior.then(() => current))
    await prior
    try {
      return await action()
    } finally {
      release()
      if (this.channelMutations.get(channelId) === current) this.channelMutations.delete(channelId)
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

  private enableRejected(id: string, actorId: unknown, channel: NonNullable<ReturnType<ChannelManagementService['get']>>, code: ChannelManagementResult['code'] = 'adapter-not-supported'): ChannelManagementResult {
    this.deps.repository.audit(id, assertIdentifier(actorId), 'request-enable', code, this.now())
    return { ok: false, code, channel }
  }
}

function assertManagedChannelType(value: unknown): 'telegram' | 'slack' | 'feishu' | 'qq' | 'discord' | 'wechat' {
  if (value === undefined || value === 'telegram') return 'telegram'
  if (value === 'slack') return 'slack'
  if (value === 'feishu') return 'feishu'
  if (value === 'qq') return 'qq'
  if (value === 'discord') return 'discord'
  if (value === 'wechat') return 'wechat'
  throw new Error('channel-input-invalid')
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
