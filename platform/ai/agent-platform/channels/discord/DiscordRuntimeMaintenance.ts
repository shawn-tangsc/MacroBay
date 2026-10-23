import { DiscordRuntimeRepository } from './DiscordRuntimeRepository'

export class DiscordRuntimeMaintenance {
  constructor(private readonly repository: DiscordRuntimeRepository) {}
  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }
  start(intervalMs = 15 * 60_000, timers: { setInterval?: typeof setInterval; clearInterval?: typeof clearInterval } = {}): () => void {
    this.runOnce()
    const timer = (timers.setInterval ?? setInterval)(() => this.runOnce(), intervalMs)
    return () => (timers.clearInterval ?? clearInterval)(timer)
  }
}
