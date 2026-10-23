import { WechatEnrollmentRepository } from './WechatEnrollmentRepository'
import { WechatRuntimeRepository } from './WechatRuntimeRepository'

export class WechatRuntimeMaintenance {
  constructor(private readonly enrollments: WechatEnrollmentRepository, private readonly runtime: WechatRuntimeRepository) {}
  runOnce(): void { try { this.enrollments.expire(); this.enrollments.cleanupTerminal(); this.runtime.cleanupAudits() } catch {} }
  start(intervalMs = 15 * 60_000, timers: { setInterval?: typeof setInterval; clearInterval?: typeof clearInterval } = {}): () => void {
    this.runOnce()
    const timer = (timers.setInterval ?? setInterval)(() => this.runOnce(), intervalMs)
    return () => (timers.clearInterval ?? clearInterval)(timer)
  }
}
