import { DiscordRuntimeRepository } from './DiscordRuntimeRepository'

export class DiscordRuntimeMaintenance {
  constructor(private readonly repository: DiscordRuntimeRepository) {}
  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }
}
