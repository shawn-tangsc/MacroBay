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
  contentGuard?: ChannelContentGuard
  now?: () => Date
  leaseMs?: number
  beforeAcknowledge?: () => Promise<void>
  // Private composition callback: adapters receive only ChannelInboundResult, never a claim.
  onInitialClaimAvailable?: (dispatchId: string) => void
}

export class ChannelInboundService {
  private readonly conversationResolutions = new Map<string, Promise<{ record: ChannelConversationRecord; created: boolean }>>()
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
      const [event, encryptedConversation, encryptedUser, payload] = await Promise.all([
        this.deps.encryption.cipher.encrypt(request.channelId, bytes(request.providerEventKey)),
        this.deps.encryption.cipher.encrypt(request.channelId, bytes(request.providerConversationKey)),
        this.deps.encryption.cipher.encrypt(request.channelId, bytes(request.providerUserKey)),
        this.deps.encryption.cipher.encrypt(request.channelId, encodeChannelInboundPayload(request))
      ])
      const [conversationHash, userHash] = await Promise.all([
        this.deps.encryption.cipher.keyedHash(request.channelId, bytes(request.providerConversationKey)),
        this.deps.encryption.cipher.keyedHash(request.channelId, bytes(request.providerUserKey))
      ])
      const now = this.now()
      const decision = this.policyDecision(request, userHash, conversationHash)
      if (decision === 'channel-policy-denied') {
        try {
          this.deps.repository.upsertCandidate({
            channelId: request.channelId,
            kind: request.conversationKind,
            userKeyCiphertext: encryptedUser.ciphertext,
            userKeyRef: encryptedUser.keyRef,
            userKeyRevision: encryptedUser.keyRevision,
            userKeyHash: userHash,
            conversationKeyCiphertext: encryptedConversation.ciphertext,
            conversationKeyRef: encryptedConversation.keyRef,
            conversationKeyRevision: encryptedConversation.keyRevision,
            conversationKeyHash: conversationHash,
            ...(request.providerUserLabel ? { displayLabel: request.providerUserLabel } : {}),
            now
          })
        } catch { /* Discovery is best-effort; the denied message must still be acknowledged. */ }
      }
      const isNewCommand = request.text?.trim() === '/new'
      const admissionId = decision ? null : this.deps.repository.reserveAdmission(request.channelId, request.generation, now)
      if (!decision && !admissionId) return retry()
      let conversation: { record: ChannelConversationRecord; created: boolean } | null = null
      try {
        conversation = decision ? null : await this.resolveConversation(request, agentId, conversationHash, encryptedConversation)
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
      sessionId = await this.deps.sessions.createForConversation({ channelId: input.channelId, agentId })
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

  private policyDecision(request: ChannelInboundRequest, userHash: string, conversationHash: string): ChannelInboundAuditCode | null {
    if ((request.conversationKind === 'group' || request.conversationKind === 'channel') && !request.mentionedBot) return 'channel-mention-required'
    if (!this.deps.repository.isAllowed(request.channelId, userHash, conversationHash, request.conversationKind)) return 'channel-policy-denied'
    return this.deps.contentGuard?.(request) ?? null
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
      sessionId = await this.deps.sessions.createForConversation({ channelId: input.channelId, agentId: input.agentId })
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
      sessionId = await this.deps.sessions.createForConversation({ channelId: request.channelId, agentId })
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
