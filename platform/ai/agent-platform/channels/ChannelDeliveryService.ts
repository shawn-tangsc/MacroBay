import type { ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import { sanitizeChannelOutput } from './OutputSanitizer'
import type {
  ChannelDeliveryRequest,
  ChannelDeliveryResult,
  ChannelDeliveryTransport,
  ChannelImageDeliveryRequest,
  ChannelImageTransport
} from './ChannelDeliveryContracts'
import { validateChannelImageDelivery } from './channelImageDelivery'
import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'

export class ChannelDeliveryService {
  constructor(private readonly deps: {
    repository: ChannelDeliveryRepository
    cipher: ChannelPayloadCipher
    transport: ChannelDeliveryTransport
    /**
     * 图片通道（可选）：没接图片能力的通道直接判 `delivery-image-unsupported`，
     * 不把字节交给只会发文本的适配器。router 必须是**同一个实例**同时实现两个接口。
     */
    imageTransport?: ChannelImageTransport
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
      if (request.source !== 'inbound-reply') {
        const encrypted = await this.deps.cipher.encrypt(request.channelId, new TextEncoder().encode(output))
        this.deps.repository.setRetryPayload({
          attemptId: attempt.id,
          ciphertext: encrypted.ciphertext,
          keyRef: encrypted.keyRef,
          keyRevision: encrypted.keyRevision
        })
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
      const detail = 'detail' in result ? result.detail : undefined
      const committed = this.deps.repository.finish({
        owner, status, errorCode, detail, retryable: isRetryableDeliveryError(errorCode), executionClaim: request.executionClaim, now: this.now()
      })
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

  /**
   * 发一张图 + caption（P2：仅应用生成的图；适配器实现了 `sendImage` 的平台就能发）。
   *
   * 三条纪律：
   * - 与文本**共用**投递尝试表，但 `sourceId` 必须错开（图用 `<recordId>:image`），否则第二次 claim
   *   命中文本那条已送达的记录、返回成功而图没发；
   * - 判定在 `beginSend` 之前：格式（字节签名）/上限/caption 任一不过就记 `failed`，一次网络都不发；
   * - 字节不落库；重投需要发起方重新读盘（`delivery-image-unavailable` 分 missing / read-failed）。
   */
  async deliverImage(request: ChannelImageDeliveryRequest): Promise<ChannelDeliveryResult> {
    const now = this.now()
    const attempt = this.deps.repository.claim({
      channelId: request.channelId,
      agentId: request.agentId,
      conversationId: request.conversationId,
      source: request.source,
      sourceId: request.sourceId,
      requireTarget: request.source !== 'inbound-reply',
      now
    })
    if (!attempt) return { status: 'skipped', attemptId: null, errorCode: 'delivery-not-authorized' }
    if (attempt.status === 'delivered' || attempt.status === 'failed' || attempt.status === 'skipped') {
      // 幂等：同一 `<recordId>:image` 已有终态，直接还回去，不会再发第二张。
      return { status: attempt.status, attemptId: attempt.id, errorCode: null }
    }

    const validation = validateChannelImageDelivery({
      bytes: request.image.bytes,
      caption: request.caption,
      declaredMime: request.image.mime
    })
    if (!validation.ok) {
      // 终态：重试不会变，不写 next_attempt_at（`retryDue()` 扫不到它）。
      this.deps.repository.markRetryTerminal(attempt.id, validation.code, now)
      return { status: 'failed', attemptId: attempt.id, errorCode: validation.code }
    }

    const imageTransport = this.deps.imageTransport
    if (!imageTransport || !imageTransport.supportsImage(request.channelId)) {
      this.deps.repository.markRetryTerminal(attempt.id, 'delivery-image-unsupported', now)
      return { status: 'failed', attemptId: attempt.id, errorCode: 'delivery-image-unsupported' }
    }

    const key = this.deps.repository.getConversationKeyCipher(request.conversationId)
    if (!key || key.channelId !== request.channelId) return { status: 'skipped', attemptId: null, errorCode: 'delivery-not-authorized' }
    let owner: import('./ChannelDeliveryRepository').ChannelDeliverySendOwner | null = null
    try {
      owner = this.deps.repository.beginSend({ attempt, retryUnknown: Boolean(request.retryUnknown), now })
      if (!owner) return { status: 'skipped', attemptId: attempt.id, errorCode: 'delivery-not-authorized' }
      const providerConversationKey = new TextDecoder().decode(await this.deps.cipher.decrypt({
        channelId: key.channelId, ciphertext: key.ciphertext, keyRef: key.keyRef, keyRevision: key.keyRevision
      }))
      if (!this.deps.repository.admitSend({ attempt, owner, now: this.now() })) {
        this.deps.repository.finish({ owner, status: 'unknown-after-send', errorCode: 'delivery-lifecycle-fenced', now: this.now() })
        return { status: 'skipped', attemptId: attempt.id, errorCode: 'delivery-not-authorized' }
      }
      const result = await imageTransport.sendImage({
        channelId: request.channelId,
        providerConversationKey,
        image: { mime: validation.mime, bytes: request.image.bytes },
        caption: request.caption,
        idempotencyKey: attempt.idempotencyKey
      })
      const errorCode = result.kind === 'failed' ? result.code : null
      const detail = 'detail' in result ? result.detail : undefined
      const committed = this.deps.repository.finish({
        owner,
        status: result.kind,
        errorCode,
        detail,
        // **图片不自动重试**（架构师 2026-11-12）：重试 payload 里不写 fileName，自动重试器扫到也
        // 不能盲发；可重试的终态只留给「仍持有 {messageId, fileName} 的调用点」去重新驱动。
        retryable: false,
        now: this.now()
      })
      // 上游说的「等多久再试」原样交出去（只有限流会带）：调用点据此内联重发一次，不自己编退避。
      const retryAfterMs = result.kind === 'failed' ? result.retryAfterMs : undefined
      return committed
        ? { status: result.kind, attemptId: attempt.id, errorCode, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) }
        : { status: 'unknown-after-send', attemptId: attempt.id, errorCode: 'delivery-lifecycle-fenced' }
    } catch {
      if (owner) {
        this.deps.repository.finish({ owner, status: 'unknown-after-send', errorCode: 'delivery-transport-unknown', now: this.now() })
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

  /**
   * 图片版的目标解析：与文本 `deliverToEnabledTargets` **同一处**取目标、同一套跳过码。
   * 不另写一套判断——两套判据迟早一个说能发、一个说没目标。
   */
  async deliverImageToEnabledTargets(
    input: Omit<ChannelImageDeliveryRequest, 'conversationId'>
  ): Promise<ChannelDeliveryResult[]> {
    const targets = this.deps.repository.listEnabledTargets(input.channelId, input.agentId)
    if (targets.length === 0) {
      return [{
        status: 'skipped',
        attemptId: null,
        errorCode: this.deps.repository.hasAnyTarget(input.channelId, input.agentId)
          ? 'delivery-target-disabled'
          : 'delivery-no-target-bound'
      }]
    }
    return Promise.all(targets.map((target) => this.deliverImage({ ...input, conversationId: target.conversationId })))
  }

  async deliverToEnabledTargets(input: Omit<ChannelDeliveryRequest, 'conversationId'>): Promise<ChannelDeliveryResult[]> {
    const targets = this.deps.repository.listEnabledTargets(input.channelId, input.agentId)
    if (targets.length === 0) {
      return [{
        status: 'skipped',
        attemptId: null,
        errorCode: this.deps.repository.hasAnyTarget(input.channelId, input.agentId)
          ? 'delivery-target-disabled'
          : 'delivery-no-target-bound'
      }]
    }
    return Promise.all(targets.map((target) => this.deliver({ ...input, conversationId: target.conversationId })))
  }

  /** Sends due retryable attempts from their encrypted payload; inbound replies use the run ledger. */
  async retryDue(limit = 20): Promise<void> {
    const due = this.deps.repository.listDueRetries(this.now(), limit)
    for (const row of due) {
      try {
        const plaintext = await this.deps.cipher.decrypt({
          channelId: row.channelId,
          ciphertext: row.ciphertext,
          keyRef: row.keyRef,
          keyRevision: row.keyRevision
        })
        const result = await this.deliver({
          channelId: row.channelId,
          agentId: row.agentId,
          conversationId: row.conversationId,
          source: row.source,
          sourceId: row.sourceId,
          text: new TextDecoder().decode(plaintext)
        })
        if (result.status === 'skipped' && result.errorCode === 'delivery-not-authorized') {
          this.deps.repository.markRetryTerminal(row.attemptId, 'delivery-not-authorized', this.now())
        }
      } catch { /* The next maintenance pass retries or the attempt stays terminal. */ }
    }
  }

  private now(): Date { return this.deps.now?.() ?? new Date() }
}

function isRetryableDeliveryError(code: string | null): boolean {
  return code === 'delivery-rate-limited' || code === 'delivery-host-unavailable'
}
