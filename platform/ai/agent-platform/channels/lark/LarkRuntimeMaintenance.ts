import { LarkRuntimeRepository } from './LarkRuntimeRepository'

export class LarkRuntimeMaintenance {
  constructor(private readonly repository: LarkRuntimeRepository) {}
  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }
  start(intervalMs = 15 * 60_000, timers: { setInterval?: typeof setInterval; clearInterval?: typeof clearInterval } = {}): () => void {
    this.runOnce()
    const timer = (timers.setInterval ?? setInterval)(() => this.runOnce(), intervalMs)
    return () => (timers.clearInterval ?? clearInterval)(timer)
  }
}
