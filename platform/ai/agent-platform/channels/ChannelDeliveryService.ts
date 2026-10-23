import type { ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import { sanitizeChannelOutput } from './OutputSanitizer'
import type { ChannelDeliveryRequest, ChannelDeliveryResult, ChannelDeliveryTransport } from './ChannelDeliveryContracts'
import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'

export class ChannelDeliveryService {
  constructor(private readonly deps: {
    repository: ChannelDeliveryRepository
    cipher: ChannelPayloadCipher
    transport: ChannelDeliveryTransport
    now?: () => Date
    beforeSendOwnership?: () => Promise<void> | void
    beforeTransport?: () => Promise<void> | void
  }) {}

  async deliver(request: ChannelDeliveryRequest): Promise<ChannelDeliveryResult> {
    const now = this.now()
    if (request.source === 'inbound-reply' && (!request.executionClaim || request.executionClaim.dispatchId !== request.sourceId)) {
      return { status: 'skipped', attemptId: null, errorCode: 'delivery-owner-invalid' }
    }
    const attempt = this.deps.repository.claim({
      channelId: request.channelId, agentId: request.agentId, conversationId: request.conversationId,
      source: request.source, sourceId: request.sourceId, requireTarget: request.source !== 'inbound-reply', executionClaim: request.executionClaim, now
    })
    if (!attempt) return { status: 'skipped', attemptId: null, errorCode: 'delivery-not-authorized' }
    if (attempt.status === 'delivered' || attempt.status === 'failed' || attempt.status === 'skipped') {
      return { status: attempt.status, attemptId: attempt.id, errorCode: null }
    }
    if (attempt.status === 'unknown-after-send') {
      if (!request.retryUnknown || !this.deps.transport.supportsIdempotency(request.channelId)) {
        return { status: 'skipped', attemptId: attempt.id, errorCode: 'delivery-retry-not-permitted' }
      }
    }
    const output = sanitizeChannelOutput(request.text).text.trim()
    if (!output) {
      this.deps.repository.finishSkipped(attempt, 'delivery-empty-output', now)
      return { status: 'skipped', attemptId: attempt.id, errorCode: 'delivery-empty-output' }
    }
    const key = this.deps.repository.getConversationKeyCipher(request.conversationId)
    if (!key || key.channelId !== request.channelId) return { status: 'skipped', attemptId: null, errorCode: 'delivery-not-authorized' }
    let owner: import('./ChannelDeliveryRepository').ChannelDeliverySendOwner | null = null
    try {
      await this.deps.beforeSendOwnership?.()
      owner = this.deps.repository.beginSend({ attempt, retryUnknown: Boolean(request.retryUnknown), executionClaim: request.executionClaim, now })
      if (!owner) {
        return { status: 'skipped', attemptId: attempt.id, errorCode: 'delivery-not-authorized' }
      }
      const providerConversationKey = new TextDecoder().decode(await this.deps.cipher.decrypt({
        channelId: key.channelId, ciphertext: key.ciphertext, keyRef: key.keyRef, keyRevision: key.keyRevision
      }))
      await this.deps.beforeTransport?.()
      if (!this.deps.repository.admitSend({ attempt, owner, executionClaim: request.executionClaim, now: this.now() })) {
        this.deps.repository.finish({ owner, status: 'unknown-after-send', errorCode: 'delivery-lifecycle-fenced', executionClaim: request.executionClaim, now: this.now() })
        return { status: 'skipped', attemptId: attempt.id, errorCode: 'delivery-not-authorized' }
      }
      // Typing is best-effort but still uses the same generation-bound transport owner.
      try { await this.deps.transport.typing?.({ channelId: request.channelId, providerConversationKey }) } catch {}
      const result = await this.deps.transport.send({ channelId: request.channelId, providerConversationKey, text: output, idempotencyKey: attempt.idempotencyKey })
      const status = result.kind
      const errorCode = result.kind === 'failed' ? result.code : null
      const committed = this.deps.repository.finish({ owner, status, errorCode, executionClaim: request.executionClaim, now: this.now() })
      return committed
        ? { status, attemptId: attempt.id, errorCode }
        : { status: 'unknown-after-send', attemptId: attempt.id, errorCode: 'delivery-lifecycle-fenced' }
    } catch {
      if (owner) {
        this.deps.repository.finish({ owner, status: 'unknown-after-send', errorCode: 'delivery-transport-unknown', executionClaim: request.executionClaim, now: this.now() })
      }
      return owner
        ? { status: 'unknown-after-send', attemptId: attempt.id, errorCode: 'delivery-transport-unknown' }
        : { status: 'skipped', attemptId: attempt.id, errorCode: 'delivery-not-authorized' }
    }
  }

  async deliverStreamFinal(request: ChannelDeliveryRequest, chunks: readonly string[]): Promise<ChannelDeliveryResult> {
    // Bound the final aggregation: streaming never creates a row per delta.
    return this.deliver({ ...request, text: chunks.slice(-128).map((chunk) => sanitizeChannelOutput(chunk).text).join('').slice(-64 * 1024) })
  }

  async deliverToEnabledTargets(input: Omit<ChannelDeliveryRequest, 'conversationId'>): Promise<ChannelDeliveryResult[]> {
    const targets = this.deps.repository.listEnabledTargets(input.channelId, input.agentId)
    if (targets.length === 0) return [{ status: 'skipped', attemptId: null, errorCode: 'delivery-no-enabled-target' }]
    return Promise.all(targets.map((target) => this.deliver({ ...input, conversationId: target.conversationId })))
  }

  private now(): Date { return this.deps.now?.() ?? new Date() }
}
