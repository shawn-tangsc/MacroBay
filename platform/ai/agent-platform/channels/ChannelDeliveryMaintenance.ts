import { ChannelDeliveryRepository } from './ChannelDeliveryRepository'

// Deliberately bounded: one pass touches at most 500 channels and one 500-row cleanup page each.
export class ChannelDeliveryMaintenance {
  private cursor: string | null = null

  constructor(private readonly deps: {
    repository: ChannelDeliveryRepository
    retryDue?: () => Promise<void>
    now?: () => Date
  }) {}

  runSlice(): void {
    try { this.cursor = this.deps.repository.cleanupChannelsPage(this.cursor, this.deps.now?.() ?? new Date(), 500).nextCursor } catch {}
  }

  /** Scheduled by `channelMaintenanceJobs`; this class owns no timer of its own. */
  async runRetrySlice(): Promise<void> {
    try { await this.deps.retryDue?.() } catch { /* bounded maintenance; never surface as an unhandled rejection */ }
  }
}
