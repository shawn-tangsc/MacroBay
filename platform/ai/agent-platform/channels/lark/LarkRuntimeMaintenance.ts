import { LarkRuntimeRepository } from './LarkRuntimeRepository'

export class LarkRuntimeMaintenance {
  constructor(private readonly repository: LarkRuntimeRepository) {}
  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }
}
