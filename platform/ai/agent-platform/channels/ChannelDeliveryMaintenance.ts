import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'

type Timer = ReturnType<typeof setInterval>

// Deliberately bounded: one pass touches at most 500 channels and one 500-row cleanup page each.
export class ChannelDeliveryMaintenance {
  private cursor: string | null = null

  constructor(private readonly deps: {
    repository: ChannelDeliveryRepository
    retryDue?: () => Promise<void>
    now?: () => Date
    setInterval?: (callback: () => void, intervalMs: number) => Timer
    clearInterval?: (timer: Timer) => void
  }) {}

  runSlice(): void {
    try { this.cursor = this.deps.repository.cleanupChannelsPage(this.cursor, this.deps.now?.() ?? new Date(), 500).nextCursor } catch {}
  }

  start(): () => void {
    this.runSlice()
    void this.retrySlice()
    const cleanup = (this.deps.setInterval ?? setInterval)(() => this.runSlice(), 15 * 60_000)
    const retries = (this.deps.setInterval ?? setInterval)(() => { void this.retrySlice() }, 30_000)
    return () => {
      ;(this.deps.clearInterval ?? clearInterval)(cleanup)
      ;(this.deps.clearInterval ?? clearInterval)(retries)
    }
  }

  private async retrySlice(): Promise<void> {
    try { await this.deps.retryDue?.() } catch { /* bounded maintenance; never surface as an unhandled rejection */ }
  }
}
