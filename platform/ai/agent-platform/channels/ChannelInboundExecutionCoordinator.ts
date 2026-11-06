import type { ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import type { AgentChatRuntimeResult } from '../runtime/agentChatRuntime'
import { getAgentTextParts } from '../schemas/messageDataHelpers'
import type { ChannelExecutionClaim, ChannelInboundPayload } from './ChannelInboundContracts'
import { ChannelInboundRepository } from './ChannelInboundRepository'
import type { ChannelInboundService } from './ChannelInboundService'
import { ChannelDeliveryService } from './ChannelDeliveryService'
import type { ChannelDispatchRunRepository } from './ChannelDispatchRunRepository'
import { markChannelSession } from '../runtime/channelToolApproval'

type Timer = ReturnType<typeof setInterval>

/**
 * 助手那一轮跑不起来的原因，必须可分辨：用户 2026-11-04 连收四句「处理失败，请稍后重试。」，
 * 而库里只有 `status=failed`，真正的原因（会话不属于新助手）从头到尾没留下。
 */
export type DispatchFailureReason =
  | 'dispatch-session-agent-mismatch'
  | 'dispatch-session-missing'
  | 'dispatch-model-missing'
  | 'dispatch-quota-exhausted'
  | 'dispatch-network-unavailable'
  | 'dispatch-payload-invalid'
  | 'dispatch-conversation-unbound'
  | 'dispatch-failed-unknown'

/** 把运行时抛出的错误归到闭集：先看最具体的，最后才是兜底（并标明是兜底）。 */
export function classifyDispatchFailure(error: unknown): DispatchFailureReason {
  const text = error instanceof Error ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}` : String(error)
  if (/does not belong to agent|不属于这个助手/i.test(text)) return 'dispatch-session-agent-mismatch'
  if (/Session .* was not found|会话.*(不存在|找不到)/i.test(text)) return 'dispatch-session-missing'
  if (/quota|额度|budget|insufficient/i.test(text)) return 'dispatch-quota-exhausted'
  if (/model|模型/i.test(text)) return 'dispatch-model-missing'
  if (/workspace|工作目录|工作区/i.test(text)) return 'dispatch-model-missing'
  if (/fetch|network|ECONN|ENOTFOUND|timeout|timed out|网络/i.test(text)) return 'dispatch-network-unavailable'
  if (/payload|decrypt|ciphertext|解密/i.test(text)) return 'dispatch-payload-invalid'
  return 'dispatch-failed-unknown'
}

// The sole main-process bridge from durable inbound ownership to Agent execution and delivery.
export class ChannelInboundExecutionCoordinator {
  constructor(private readonly deps: {
    inbound: ChannelInboundRepository
    delivery: ChannelDeliveryService
    cipher: ChannelPayloadCipher
    runtime: { sendMessage: (request: { agentId: string; sessionId: string; text: string; runId: string }) => Promise<AgentChatRuntimeResult> }
    runs?: ChannelDispatchRunRepository
    /** 失败原因码闭集之一；界面据此说人话。`dispatch-failed-unknown` 是**兜底**，不是解释。 */
    failureText?: (kind: 'run-failed' | 'run-interrupted', reason?: DispatchFailureReason) => string | Promise<string>
    now?: () => Date
    leaseMs?: number
    setInterval?: (callback: () => void, intervalMs: number) => Timer
    clearInterval?: (timer: Timer) => void
  }) {}

  /** 每个对话一条串行队列：上一轮没结束时又来消息，排队而不是并发各跑一遍（并发会重复耗额度）。 */
  private readonly conversationQueues = new Map<string, Promise<unknown>>()

  async execute(claim: ChannelExecutionClaim): Promise<'completed' | 'failed' | 'deferred'> {
    const conversationId = this.conversationOf(claim)
    const previous = this.conversationQueues.get(conversationId) ?? Promise.resolve()
    const next = previous.then(() => this.executeSerial(claim), () => this.executeSerial(claim))
    this.conversationQueues.set(conversationId, next.then(() => undefined, () => undefined))
    try {
      return await next
    } finally {
      if (this.conversationQueues.get(conversationId) === next) this.conversationQueues.delete(conversationId)
    }
  }

  /** 队列键：优先用运行台账里的对话 id（admit 之前就要拿到，所以先查台账/工单）。 */
  private conversationOf(claim: ChannelExecutionClaim): string {
    const run = this.deps.runs?.get(claim.dispatchId)
    if (run?.conversationId) return run.conversationId
    // 台账还没写时按工单反查；两者都拿不到就退回 dispatch id（最坏只是少一次合并，不会并发失控）。
    const lookup = this.deps.inbound.dispatchConversationId
    const found = typeof lookup === 'function' ? lookup.call(this.deps.inbound, claim.dispatchId) : null
    return found ?? claim.dispatchId
  }

  private async executeSerial(claim: ChannelExecutionClaim): Promise<'completed' | 'failed' | 'deferred'> {
    const admitted = this.deps.inbound.admitDispatch(claim, this.now())
    if (!admitted) return 'deferred'
    let owner = claim
    let renewalFailed = false
    const heartbeat = this.startHeartbeat(() => {
      try {
        const renewed = this.deps.inbound.renewDispatchLease(owner, this.now(), this.leaseMs())
        if (!renewed) { renewalFailed = true; return }
        owner = renewed
      } catch {
        renewalFailed = true
      }
    })
    try {
      const binding = this.deps.inbound.getConversationBinding({ claim: owner, conversationId: admitted.conversationId, now: this.now() })
      if (!binding) {
        this.deps.runs?.fail(owner.dispatchId, 'failed', this.now(), { code: 'dispatch-conversation-unbound' })
        return this.finalize(owner, 'failed')
      }

      const existing = this.deps.runs?.get(owner.dispatchId) ?? null
      if (existing?.status === 'started') {
        this.deps.runs?.fail(owner.dispatchId, 'interrupted', this.now())
        await this.deliverFailure(owner, admitted.conversationId, binding.agentId, 'run-interrupted')
        return this.finalize(owner, 'failed')
      }
      if (existing?.status === 'completed') {
        return this.deliverStoredResult(owner, admitted.conversationId, binding.agentId)
      }
      if (existing?.status === 'failed' || existing?.status === 'interrupted') {
        return this.finalize(owner, 'failed')
      }
      if (this.deps.runs && !this.deps.runs.start({
        dispatchId: owner.dispatchId,
        channelId: owner.channelId,
        workItemId: owner.workItemId,
        conversationId: admitted.conversationId,
        now: this.now()
      })) {
        return 'deferred'
      }

      const payload = await this.decrypt(admitted)
      // 手机通道没有确认卡：分发前标记这个会话，工具审批直接收口，不排队等界面。
      markChannelSession(binding.sessionId)
      const runtime = await this.deps.runtime.sendMessage({ agentId: binding.agentId, sessionId: binding.sessionId, text: payload.text ?? '', runId: owner.dispatchId })
      if (this.deps.runs) {
        const text = getAgentTextParts(runtime.assistantMessage.data).join('\n')
        const encrypted = await this.deps.cipher.encrypt(owner.channelId, new TextEncoder().encode(text))
        this.deps.runs.complete({
          dispatchId: owner.dispatchId,
          channelId: owner.channelId,
          conversationId: admitted.conversationId,
          textCiphertext: encrypted.ciphertext,
          textKeyRef: encrypted.keyRef,
          textKeyRevision: encrypted.keyRevision,
          now: this.now()
        })
      }
      if (renewalFailed) return 'deferred'
      const status = await this.deliverFinal(owner, admitted.conversationId, binding.agentId, runtime)
      if (this.deps.runs && status === 'delivered') this.deps.runs.markResult(owner.dispatchId, 'delivered', this.now())
      if (renewalFailed || status === 'unknown-after-send') return 'deferred'
      return this.finalize(owner, status === 'delivered' ? 'completed' : 'failed')
    } catch (error) {
      if (!renewalFailed) {
        const reason = classifyDispatchFailure(error)
        this.deps.runs?.fail(owner.dispatchId, 'failed', this.now(), {
          code: reason,
          detail: error instanceof Error ? error.message : String(error)
        })
        const binding = this.deps.inbound.getConversationBinding({ claim: owner, conversationId: admitted.conversationId, now: this.now() })
        if (binding) await this.deliverFailure(owner, admitted.conversationId, binding.agentId, 'run-failed', reason)
      }
      return renewalFailed ? 'deferred' : this.finalize(owner, 'failed')
    } finally {
      this.stopHeartbeat(heartbeat)
    }
  }

  async executeInitial(inbound: Pick<ChannelInboundService, 'takeInitialExecutionClaim'>, dispatchId: string): Promise<'completed' | 'failed' | 'deferred'> {
    const claim = inbound.takeInitialExecutionClaim(dispatchId)
    return claim ? this.execute(claim) : 'deferred'
  }

  async executeRecovery(claims: readonly ChannelExecutionClaim[]): Promise<Array<'completed' | 'failed' | 'deferred'>> {
    return Promise.all(claims.map((claim) => this.execute(claim)))
  }

  private finalize(claim: ChannelExecutionClaim, status: 'completed' | 'failed'): 'completed' | 'failed' | 'deferred' {
    return this.deps.inbound.finalizeDispatch(claim, status, this.now()) ? status : 'deferred'
  }

  private async decrypt(admission: { channelId: string; ciphertext: Uint8Array; keyRef: string; keyRevision: number }): Promise<ChannelInboundPayload> {
    const plaintext = await this.deps.cipher.decrypt(admission)
    const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as ChannelInboundPayload
    if (!parsed || typeof parsed !== 'object' || (parsed.text !== null && typeof parsed.text !== 'string')) throw new Error('Channel inbound payload is invalid.')
    return parsed
  }

  private async deliverFailure(
    claim: ChannelExecutionClaim,
    conversationId: string,
    agentId: string,
    kind: 'run-failed' | 'run-interrupted',
    reason?: DispatchFailureReason
  ): Promise<void> {
    if (!this.deps.failureText) return
    try {
      const text = await this.deps.failureText(kind, reason)
      if (!text.trim()) return
      await this.deps.delivery.deliverStreamFinal({
        channelId: claim.channelId, agentId, conversationId, source: 'inbound-reply',
        sourceId: claim.dispatchId, executionClaim: claim, text
      }, [text])
    } catch { /* Best-effort user notice; the failed run is still finalized. */ }
  }

  private async deliverStoredResult(claim: ChannelExecutionClaim, conversationId: string, agentId: string): Promise<'completed' | 'failed' | 'deferred'> {
    const result = this.deps.runs?.getResult(claim.dispatchId) ?? null
    if (!result) return this.finalize(claim, 'failed')
    const plaintext = await this.deps.cipher.decrypt({
      channelId: claim.channelId,
      ciphertext: result.textCiphertext,
      keyRef: result.textKeyRef,
      keyRevision: result.textKeyRevision
    })
    const text = new TextDecoder().decode(plaintext)
    const status = (await this.deps.delivery.deliverStreamFinal({
      channelId: claim.channelId, agentId, conversationId, source: 'inbound-reply', sourceId: claim.dispatchId, executionClaim: claim, text
    }, [text])).status
    if (status === 'delivered') this.deps.runs?.markResult(claim.dispatchId, 'delivered', this.now())
    return this.finalize(claim, status === 'delivered' ? 'completed' : 'failed')
  }

  private async deliverFinal(claim: ChannelExecutionClaim, conversationId: string, agentId: string, runtime: AgentChatRuntimeResult) {
    const text = getAgentTextParts(runtime.assistantMessage.data).join('\n')
    return (await this.deps.delivery.deliverStreamFinal({
      channelId: claim.channelId, agentId, conversationId, source: 'inbound-reply', sourceId: claim.dispatchId, executionClaim: claim, text
    }, [text])).status
  }

  private startHeartbeat(renew: () => void): Timer {
    const interval = Math.max(1_000, Math.floor(this.leaseMs() / 3))
    return (this.deps.setInterval ?? setInterval)(renew, interval)
  }

  private stopHeartbeat(timer: Timer): void { (this.deps.clearInterval ?? clearInterval)(timer) }
  private leaseMs(): number { return this.deps.leaseMs ?? 60_000 }
  private now(): Date { return this.deps.now?.() ?? new Date() }
}
