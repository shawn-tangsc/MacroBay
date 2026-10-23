import { QqRuntimeRepository } from './QqRuntimeRepository'

export class QqRuntimeMaintenance {
  constructor(private readonly repository: QqRuntimeRepository) {}
  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }
  start(intervalMs = 15 * 60_000, timers: { setInterval?: typeof setInterval; clearInterval?: typeof clearInterval } = {}): () => void {
    this.runOnce()
    const timer = (timers.setInterval ?? setInterval)(() => this.runOnce(), intervalMs)
    return () => (timers.clearInterval ?? clearInterval)(timer)
  }
}
