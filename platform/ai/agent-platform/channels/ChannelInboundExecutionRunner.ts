import { ChannelInboundExecutionCoordinator } from './ChannelInboundExecutionCoordinator'
import { ChannelInboundRepository } from './ChannelInboundRepository'
import type { ChannelInboundService } from './ChannelInboundService'

// Bounded main-process runner. It sees opaque claims only and never exposes them to adapters.
export class ChannelInboundExecutionRunner {
  constructor(private readonly deps: {
    inbound: ChannelInboundRepository
    coordinator: ChannelInboundExecutionCoordinator
    reclaimLimit?: number
  }) {}

  onInitialClaim(inbound: Pick<ChannelInboundService, 'takeInitialExecutionClaim'>, dispatchId: string): void {
    void this.deps.coordinator.executeInitial(inbound, dispatchId).catch(() => undefined)
  }

  async recoverOnce(): Promise<void> {
    try {
      const claims = this.deps.inbound.reclaimExpired(new Date(), 60_000, this.deps.reclaimLimit ?? 500)
      await this.deps.coordinator.executeRecovery(claims)
    } catch {
      // Recovery is background maintenance: a busy/corrupt SQLite slice must not become an
      // unhandled Electron rejection or imply a successful acknowledgement/dispatch.
    }
  }

  startRecovery(intervalMs = 15 * 60_000, timers: {
    setInterval?: (callback: () => void, interval: number) => ReturnType<typeof setInterval>
    clearInterval?: (timer: ReturnType<typeof setInterval>) => void
  } = {}): () => void {
    void this.recoverOnce()
    const timer = (timers.setInterval ?? setInterval)(() => { void this.recoverOnce() }, intervalMs)
    return () => (timers.clearInterval ?? clearInterval)(timer)
  }
}
