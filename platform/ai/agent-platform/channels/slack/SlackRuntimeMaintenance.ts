import { SlackRuntimeRepository } from './SlackRuntimeRepository'

export class SlackRuntimeMaintenance {
  constructor(private readonly repository: SlackRuntimeRepository) {}
  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }
}
