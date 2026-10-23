import type { ChannelPayloadCipher } from '../../../secrets/channels/channelCredentialContracts'
import type { AgentChatRuntimeResult } from '../runtime/agentChatRuntime'
import { getAgentTextParts } from '../schemas/messageDataHelpers'
import type { ChannelExecutionClaim, ChannelInboundPayload } from './ChannelInboundContracts'
import { ChannelInboundRepository } from './ChannelInboundRepository'
import type { ChannelInboundService } from './ChannelInboundService'
import { ChannelDeliveryService } from './ChannelDeliveryService'

type Timer = ReturnType<typeof setInterval>

// The sole main-process bridge from durable inbound ownership to Agent execution and delivery.
export class ChannelInboundExecutionCoordinator {
  constructor(private readonly deps: {
    inbound: ChannelInboundRepository
    delivery: ChannelDeliveryService
    cipher: ChannelPayloadCipher
    runtime: { sendMessage: (request: { agentId: string; sessionId: string; text: string; runId: string }) => Promise<AgentChatRuntimeResult> }
    now?: () => Date
    leaseMs?: number
    setInterval?: (callback: () => void, intervalMs: number) => Timer
    clearInterval?: (timer: Timer) => void
  }) {}

  async execute(claim: ChannelExecutionClaim): Promise<'completed' | 'failed' | 'deferred'> {
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
      if (!binding) return this.finalize(owner, 'failed')
      const payload = await this.decrypt(admitted)
      const runtime = await this.deps.runtime.sendMessage({ agentId: binding.agentId, sessionId: binding.sessionId, text: payload.text ?? '', runId: owner.dispatchId })
      if (renewalFailed) return 'deferred'
      const status = await this.deliverFinal(owner, admitted.conversationId, binding.agentId, runtime)
      if (renewalFailed || status === 'unknown-after-send') return 'deferred'
      return this.finalize(owner, status === 'delivered' ? 'completed' : 'failed')
    } catch {
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
