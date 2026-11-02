import { QqRuntimeRepository } from './QqRuntimeRepository'

export class QqRuntimeMaintenance {
  constructor(private readonly repository: QqRuntimeRepository) {}
  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }
}
