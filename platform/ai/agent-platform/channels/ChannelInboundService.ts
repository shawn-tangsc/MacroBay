import { randomUUID } from 'node:crypto'

import type { ChannelInboundDisposition } from './channelContracts'
import {
  assertChannelInboundFacts,
  createChannelDispatchId,
  encodeChannelInboundPayload,
  type ChannelContentGuard,
  type ChannelInboundEncryption,
  type ChannelExecutionClaim,
  type ChannelInboundRequest,
  type ChannelInboundResult,
  type ChannelSessionFactory
} from './ChannelInboundContracts'
import { ChannelInboundRepository, type ChannelInboundAuditCode, type ChannelConversationRecord } from './ChannelInboundRepository'

export type ChannelInboundServiceDependencies = {
  repository: ChannelInboundRepository
  encryption: ChannelInboundEncryption
  sessions: ChannelSessionFactory
  // Required on purpose: an optional boundary hook means the default behaviour is "no boundary".
  contentGuard: ChannelContentGuard
  now?: () => Date
  leaseMs?: number
  beforeAcknowledge?: () => Promise<void>
  // Private composition callback: adapters receive only ChannelInboundResult, never a claim.
  onInitialClaimAvailable?: (dispatchId: string) => void
  /**
   * 跟这条通道说过话的对话，自动记成投递目标（**已有目标时不许覆盖**）。
   * 界面上没有绑定入口，所以这一步不能指望读者动手。
   */
  bindAutoTarget?: (input: { channelId: string; conversationId: string }) => void
  /** 「没有权限」那句人话（按界面语言给）；缺省时只记审计、不回话。 */
  deniedReplyText?: () => Promise<string>
}

export class ChannelInboundService {
  private readonly conversationResolutions = new Map<string, Promise<{ record: ChannelConversationRecord; created: boolean }>>()
  /** 「拒绝回话」的限频：每 (频道, 会话) 十分钟最多一次，免得对方狂发变成我们刷屏。 */
  private readonly deniedReplies = new Map<string, number>()
  // This queue is main-process-only; provider-facing results never expose execution ownership.
  private readonly initialClaims = new Map<string, ChannelExecutionClaim>()
  private readonly deps: ChannelInboundServiceDependencies

  constructor(deps: ChannelInboundServiceDependencies) {
    this.deps = deps
  }

  async receive(request: ChannelInboundRequest): Promise<ChannelInboundResult> {
    try {
      assertChannelInboundFacts(request)
      const agentId = this.deps.repository.getCurrentAgentId(request.channelId, request.generation)
      if (!agentId) {
        this.deps.repository.recordRejectedLifecycle(request.channelId, request.generation, 'channel-agent-missing', this.now())
        return retry()
      }
      const eventHash = await this.deps.encryption.cipher.keyedHash(request.channelId, bytes(request.providerEventKey))
      const existing = this.deps.repository.existingReceiptOutcome(request.channelId, eventHash, this.now())
      if (existing === 'retry') return retry()
      if (existing === 'duplicate') {
        await this.deps.beforeAcknowledge?.()
        if (!this.deps.repository.acknowledgeIfCurrent(request.channelId, request.generation)) return retry()
        await request.acknowledge()
        this.enqueueInitialClaim(this.deps.repository.findInitialClaim(request.channelId, eventHash, this.now()))
        return { disposition: 'duplicate' }
      }
      // Guard before the payload is encrypted: what the agent later reads is already protected,
      // so replaying stored work cannot reintroduce raw external text.
      const guarded = this.deps.contentGuard(request)
      const [event, encryptedConversation, encryptedUser, payload] = await Promise.all([
        this.deps.encryption.cipher.encrypt(request.channelId, bytes(request.providerEventKey)),
        this.deps.encryption.cipher.encrypt(request.channelId, bytes(request.providerConversationKey)),
        this.deps.encryption.cipher.encrypt(request.channelId, bytes(request.providerUserKey)),
        this.deps.encryption.cipher.encrypt(request.channelId, encodeChannelInboundPayload({ ...request, text: guarded.text ?? undefined }))
      ])
      const [conversationHash, userHash] = await Promise.all([
        this.deps.encryption.cipher.keyedHash(request.channelId, bytes(request.providerConversationKey)),
        this.deps.encryption.cipher.keyedHash(request.channelId, bytes(request.providerUserKey))
      ])
      const now = this.now()
      const decision = guarded.rejection ?? await this.policyDecision(request, userHash, conversationHash)
      if (decision === 'channel-policy-denied') {
        this.recordCandidate(request, { encryptedUser, encryptedConversation, userHash, conversationHash, now })
        // 静默忽略是装死：明确回一句拒绝，但**限频**——同一个人十分钟内只回一次。
        await this.replyDeniedOnce(request, conversationHash, now)
      } else if (decision === null && this.deps.repository.allowList(request.channelId).length === 0) {
        // 「允许所有」时把见过的会话记进**候选表**，方便读者以后照着填允许列表。
        // 绝不写进允许列表本身：一写，列表就非空，语义会在第一条消息后静默收紧成「只允许这一个」。
        this.recordCandidate(request, { encryptedUser, encryptedConversation, userHash, conversationHash, now })
      }
      const isNewCommand = request.text?.trim() === '/new'
      const admissionId = decision ? null : this.deps.repository.reserveAdmission(request.channelId, request.generation, now)
      if (!decision && !admissionId) return retry()
      let conversation: { record: ChannelConversationRecord; created: boolean } | null = null
      try {
        conversation = decision ? null : await this.resolveConversation(request, agentId, conversationHash, encryptedConversation)
        if (!decision && conversation && !request.text?.trim().startsWith('/new')) {
          // 跟这条通道说过话的对话就是投递目标：界面上没有绑定入口，不能指望读者自己去绑。
          this.deps.bindAutoTarget?.({ channelId: request.channelId, conversationId: conversation.record.id })
        }
        // /new is a durable provider event but never Agent work. Replacement remains generation-bound.
        // The first /new creates its initial binding only; replacing that just-created session would orphan it.
        if (!decision && isNewCommand && conversation && !conversation.created) {
          await this.startNewConversation({
            channelId: request.channelId,
            generation: request.generation,
            providerConversationKey: request.providerConversationKey
          })
        }
        if (!decision && !isNewCommand && conversation && !conversation.record.sessionId) {
          conversation = {
            record: await this.ensureConversationSession({
              channelId: request.channelId,
              generation: request.generation,
              keyHash: conversationHash,
              agentId
            }),
            created: conversation.created
          }
        }
        const result = this.deps.repository.handleClaim({
          channelId: request.channelId,
          generation: request.generation,
          eventCiphertext: event.ciphertext,
          eventKeyRef: event.keyRef,
          eventKeyRevision: event.keyRevision,
          eventHash,
          decision: decision || isNewCommand ? 'ignored' : 'processing',
          ...(decision ? { auditCode: decision } : {}),
          ...(conversation && !isNewCommand ? {
            work: {
              channelId: request.channelId,
              conversationId: conversation.record.id,
              dispatchId: createChannelDispatchId(),
              ciphertext: payload.ciphertext,
              keyRef: payload.keyRef,
              keyRevision: payload.keyRevision,
              leaseExpiresAt: new Date(now.getTime() + (this.deps.leaseMs ?? 60_000)).toISOString()
            }
          } : {}),
          ...(admissionId ? { admissionId } : {}),
          now
        })
        if (result.outcome === 'retry' || result.outcome === 'capacity') {
          await this.discardConversationIfUnadmitted(request.channelId, conversationHash, conversation)
          return retry()
        }
        await this.deps.beforeAcknowledge?.()
        if (!this.deps.repository.acknowledgeIfCurrent(request.channelId, request.generation)) return retry()
        await request.acknowledge()
        if (result.outcome === 'duplicate') return { disposition: 'duplicate' }
        this.enqueueInitialClaim(result.claim)
        return decision || isNewCommand
          ? { disposition: 'ignored' }
          : { disposition: 'acknowledged', dispatchId: result.dispatchId }
      } finally {
        if (admissionId) this.deps.repository.releaseAdmission(admissionId)
      }
    } catch {
      // Preserve the provider retry contract, but leave a bounded audit trail for persistent failures.
      try { this.deps.repository.recordInboundFailure(request.channelId, request.generation, this.now()) } catch {}
      return retry()
    }
  }

  takeInitialExecutionClaim(dispatchId: string): ChannelExecutionClaim | null {
    this.pruneInitialClaims()
    const claim = this.initialClaims.get(dispatchId) ?? null
    if (!claim) return null
    this.initialClaims.delete(dispatchId)
    // SQL revalidation prevents stale memory ownership from crossing a fence/restart.
    return this.deps.repository.isCurrentActive(claim.channelId, claim.generation) &&
      this.deps.repository.findInitialClaimByOwner(claim, this.now())
      ? claim
      : null
  }

  private enqueueInitialClaim(claim: ChannelExecutionClaim | null | undefined): void {
    this.pruneInitialClaims()
    if (!claim) return
    this.initialClaims.set(claim.dispatchId, claim)
    // Deliberately pass only an opaque dispatch id to the main-process runner.
    try { this.deps.onInitialClaimAvailable?.(claim.dispatchId) } catch {}
  }

  private pruneInitialClaims(): void {
    const now = this.now().getTime()
    for (const [dispatchId, claim] of this.initialClaims) {
      if (Date.parse(claim.leaseExpiresAt) <= now) this.initialClaims.delete(dispatchId)
    }
  }

  async allow(input: { channelId: string; subjectType: 'user' | 'conversation'; key: string; conversationKind?: 'direct' | 'group' | 'channel' }): Promise<void> {
    const encrypted = await this.deps.encryption.cipher.encrypt(input.channelId, bytes(input.key))
    this.deps.repository.allow(input.channelId, {
      subjectType: input.subjectType,
      keyCiphertext: encrypted.ciphertext,
      keyRef: encrypted.keyRef,
      keyRevision: encrypted.keyRevision,
      keyHash: await this.deps.encryption.cipher.keyedHash(input.channelId, bytes(input.key)),
      conversationKind: input.conversationKind
    }, this.now())
  }

  async startNewConversation(input: { channelId: string; generation: number; providerConversationKey: string }): Promise<string> {
    const keyHash = await this.deps.encryption.cipher.keyedHash(input.channelId, bytes(input.providerConversationKey))
    const existing = this.deps.repository.getConversation(input.channelId, keyHash)
    if (!existing) throw new Error('Channel conversation is not registered.')
    const agentId = this.deps.repository.getCurrentAgentId(input.channelId, input.generation)
    const operationId = agentId
      ? this.deps.repository.reserveConversationOperation(input.channelId, keyHash, input.generation, agentId, this.now())
      : null
    if (!agentId || !operationId) {
      throw new Error('Channel lifecycle is not active.')
    }
    let sessionId: string | null = null
    let bound = false
    try {
      sessionId = await this.deps.sessions.createForConversation({
        channelId: input.channelId,
        agentId,
        providerConversationKey: input.providerConversationKey,
        disambiguate: this.deps.repository.countConversations(input.channelId) > 0
      })
      if (!sessionId.trim() || !this.deps.repository.replaceConversationSession(input.channelId, keyHash, sessionId, input.generation, agentId, this.now())) {
        throw new Error('Channel conversation session replacement failed.')
      }
      bound = true
      return sessionId
    } finally {
      if (sessionId && !bound) {
        await this.deps.sessions.discardUnbound(sessionId)
      }
      this.deps.repository.releaseConversationOperation(input.channelId, keyHash, operationId)
    }
  }

  listCandidates(channelId: string, limit = 100) {
    return this.deps.repository.listCandidates(channelId, limit)
  }

  allowCandidate(input: { channelId: string; candidateId: string; enableTarget: boolean }): string | null {
    if (!this.deps.repository.managedChannelExists(input.channelId)) return null
    return this.deps.repository.allowCandidate(input)
  }

  ignoreCandidate(channelId: string, candidateId: string): boolean {
    return this.deps.repository.ignoreCandidate(channelId, candidateId)
  }

  setDeliveryTarget(input: { channelId: string; conversationId: string; enabled: boolean }): boolean {
    return this.deps.repository.setDeliveryTarget(input.channelId, input.conversationId, input.enabled, this.now())
  }

  /**
   * 未授权会话的明确拒绝：回一句话、同会话十分钟一次。
   * 正文由组合根按界面语言给，这里不加频道 id、管理员、配置——拒绝句只回答「你没有权限」。
   */
  private async replyDeniedOnce(request: ChannelInboundRequest, conversationHash: string, now: Date): Promise<void> {
    if (!request.reply || !this.deps.deniedReplyText) return
    const key = `${request.channelId}:${conversationHash}`
    const last = this.deniedReplies.get(key)
    const windowMs = 10 * 60_000
    if (last !== undefined && now.getTime() - last < windowMs) return
    this.deniedReplies.set(key, now.getTime())
    try {
      await request.reply(await this.deps.deniedReplyText())
    } catch {
      // 回不出去不影响审计与准入：拒绝句失败不该把一个被挡的消息变成重试风暴。
      this.deniedReplies.delete(key)
    }
  }

  private recordCandidate(
    request: ChannelInboundRequest,
    input: {
      encryptedUser: { ciphertext: Uint8Array; keyRef: string; keyRevision: number }
      encryptedConversation: { ciphertext: Uint8Array; keyRef: string; keyRevision: number }
      userHash: string
      conversationHash: string
      now: Date
    }
  ): void {
    try {
      this.deps.repository.upsertCandidate({
        channelId: request.channelId,
        kind: request.conversationKind,
        userKeyCiphertext: input.encryptedUser.ciphertext,
        userKeyRef: input.encryptedUser.keyRef,
        userKeyRevision: input.encryptedUser.keyRevision,
        userKeyHash: input.userHash,
        conversationKeyCiphertext: input.encryptedConversation.ciphertext,
        conversationKeyRef: input.encryptedConversation.keyRef,
        conversationKeyRevision: input.encryptedConversation.keyRevision,
        conversationKeyHash: input.conversationHash,
        ...(request.providerUserLabel ? { displayLabel: request.providerUserLabel } : {}),
        now: input.now
      })
    } catch { /* Discovery is best-effort; the message must still be acknowledged. */ }
  }

  private async policyDecision(request: ChannelInboundRequest, userHash: string, conversationHash: string): Promise<ChannelInboundAuditCode | null> {
    if ((request.conversationKind === 'group' || request.conversationKind === 'channel') && !request.mentionedBot) return 'channel-mention-required'
    const allowList = this.deps.repository.allowList(request.channelId)
    if (allowList.length > 0) {
      // 读者填了列表：**只放行这些会话**。列表与入站用的是同一个 keyedHash，所以能逐字比。
      const allowed = await Promise.all(
        allowList.map((id) => this.deps.encryption.cipher.keyedHash(request.channelId, bytes(id)))
      )
      return allowed.includes(conversationHash) ? null : 'channel-policy-denied'
    }
    // 列表为空：仍然尊重历史策略行（老数据行为不变）；一条策略都没有才是「允许所有」。
    if (this.deps.repository.hasAnyAllowPolicy(request.channelId)) {
      return this.deps.repository.isAllowed(request.channelId, userHash, conversationHash, request.conversationKind) ? null : 'channel-policy-denied'
    }
    return null
  }

  private async ensureConversationSession(input: {
    channelId: string
    generation: number
    keyHash: string
    agentId: string
  }): Promise<ChannelConversationRecord> {
    const operationId = this.deps.repository.reserveConversationOperation(
      input.channelId, input.keyHash, input.generation, input.agentId, this.now()
    )
    if (!operationId) throw new Error('Channel conversation operation is already active.')
    let sessionId: string | null = null
    let bound = false
    try {
      sessionId = await this.deps.sessions.createForConversation({
        channelId: input.channelId,
        agentId: input.agentId,
        providerConversationKey: input.keyHash,
        disambiguate: this.deps.repository.countConversations(input.channelId) > 0
      })
      if (!sessionId.trim() || !this.deps.repository.replaceConversationSession(
        input.channelId, input.keyHash, sessionId, input.generation, input.agentId, this.now()
      )) {
        throw new Error('Channel conversation session rebind failed.')
      }
      bound = true
      const record = this.deps.repository.getConversation(input.channelId, input.keyHash)
      if (!record) throw new Error('Channel conversation disappeared during session rebind.')
      return record
    } finally {
      if (sessionId && !bound) await this.deps.sessions.discardUnbound(sessionId)
      this.deps.repository.releaseConversationOperation(input.channelId, input.keyHash, operationId)
    }
  }

  private async resolveConversation(request: ChannelInboundRequest, agentId: string, hash: string, encrypted: { ciphertext: Uint8Array; keyRef: string; keyRevision: number }): Promise<{ record: ChannelConversationRecord; created: boolean }> {
    const existing = this.deps.repository.getConversation(request.channelId, hash)
    if (existing) {
      if (existing.sessionId && this.deps.sessions.exists) {
        const alive = await this.deps.sessions.exists(existing.sessionId)
        if (!alive) return { record: { ...existing, sessionId: null }, created: false }
      }
      return { record: existing, created: false }
    }
    const resolutionKey = `${request.channelId}:${hash}`
    const inFlight = this.conversationResolutions.get(resolutionKey)
    if (inFlight) return inFlight
    const resolution = this.createConversation(request, agentId, hash, encrypted)
    this.conversationResolutions.set(resolutionKey, resolution)
    try {
      return await resolution
    } finally {
      this.conversationResolutions.delete(resolutionKey)
    }
  }

  private async createConversation(request: ChannelInboundRequest, agentId: string, hash: string, encrypted: { ciphertext: Uint8Array; keyRef: string; keyRevision: number }): Promise<{ record: ChannelConversationRecord; created: boolean }> {
    const operationId = this.deps.repository.reserveConversationOperation(request.channelId, hash, request.generation, agentId, this.now())
    if (!operationId) {
      throw new Error('Channel conversation operation is already active.')
    }
    let sessionId: string | null = null
    let bound = false
    try {
      sessionId = await this.deps.sessions.createForConversation({
        channelId: request.channelId,
        agentId,
        ...(request.providerUserLabel ? { displayLabel: request.providerUserLabel } : {}),
        providerConversationKey: request.providerConversationKey,
        disambiguate: this.deps.repository.countConversations(request.channelId) > 0
      })
      if (!sessionId.trim()) throw new Error('Channel session factory returned no session.')
      const created = this.deps.repository.createConversation({
        id: randomUUID(), channelId: request.channelId, keyCiphertext: encrypted.ciphertext, keyRef: encrypted.keyRef,
        keyRevision: encrypted.keyRevision, keyHash: hash, kind: request.conversationKind, sessionId
      }, request.generation, agentId, this.now())
      if (!created) {
        throw new Error('Channel conversation lifecycle changed.')
      }
      if (!created.created) {
        return created
      }
      bound = true
      return created
    } finally {
      if (sessionId && !bound) {
        this.deps.repository.deleteUnboundConversation(request.channelId, hash, sessionId)
        await this.deps.sessions.discardUnbound(sessionId)
      }
      this.deps.repository.releaseConversationOperation(request.channelId, hash, operationId)
    }
  }

  private async discardConversationIfUnadmitted(
    channelId: string,
    keyHash: string,
    conversation: { record: ChannelConversationRecord; created: boolean } | null
  ): Promise<void> {
    if (!conversation?.created) return
    const sessionId = conversation.record.sessionId
    if (!sessionId) return
    if (this.deps.repository.deleteUnboundConversation(channelId, keyHash, sessionId)) {
      await this.deps.sessions.discardUnbound(sessionId)
    }
  }

  private now(): Date { return this.deps.now?.() ?? new Date() }
}

function bytes(value: string): Uint8Array { return new TextEncoder().encode(value) }
function retry(): ChannelInboundResult { return { disposition: 'retry' } }
