import { WechatEnrollmentRepository } from './WechatEnrollmentRepository'
import { WechatRuntimeRepository } from './WechatRuntimeRepository'

export class WechatRuntimeMaintenance {
  constructor(private readonly enrollments: WechatEnrollmentRepository, private readonly runtime: WechatRuntimeRepository) {}
  runOnce(): void { try { this.enrollments.expire(); this.enrollments.cleanupTerminal(); this.runtime.cleanupAudits() } catch {} }
}
