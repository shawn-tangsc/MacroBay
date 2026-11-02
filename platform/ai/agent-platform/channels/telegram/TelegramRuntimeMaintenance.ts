import { TelegramOffsetRepository } from './TelegramOffsetRepository'

/** Bounded cleanup is independent from polling so a busy maintenance slice cannot block ingress. */
export class TelegramRuntimeMaintenance {
  constructor(private readonly repository: TelegramOffsetRepository) {}

  runOnce(): void { try { this.repository.cleanupAudits() } catch {} }

}
