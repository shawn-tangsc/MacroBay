import { TelegramOffsetRepository } from './TelegramOffsetRepository'

/** Bounded cleanup is independent from polling so a busy maintenance slice cannot block ingress. */
export class TelegramRuntimeMaintenance {
  constructor(private readonly repository: TelegramOffsetRepository) {}

  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }

  start(intervalMs = 15 * 60_000, timers: {
    setInterval?: (callback: () => void, interval: number) => ReturnType<typeof setInterval>
    clearInterval?: (timer: ReturnType<typeof setInterval>) => void
  } = {}): () => void {
    this.runOnce()
    const timer = (timers.setInterval ?? setInterval)(() => this.runOnce(), intervalMs)
    return () => (timers.clearInterval ?? clearInterval)(timer)
  }
}
