import { SlackRuntimeRepository } from './SlackRuntimeRepository'

export class SlackRuntimeMaintenance {
  constructor(private readonly repository: SlackRuntimeRepository) {}
  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }
  start(intervalMs = 15 * 60_000, timers: { setInterval?: typeof setInterval; clearInterval?: typeof clearInterval } = {}): () => void {
    this.runOnce()
    const timer = (timers.setInterval ?? setInterval)(() => this.runOnce(), intervalMs)
    return () => (timers.clearInterval ?? clearInterval)(timer)
  }
}
