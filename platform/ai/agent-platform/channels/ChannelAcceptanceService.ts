import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { AgentChannelType } from '../schemas/channelSchemas'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import { ChannelAdapterEvidenceRepository } from './ChannelAdapterEvidenceRepository'
import type { ChannelAdapterAcceptanceEntry } from './channelContracts'
import type { ChannelAdapterKey } from './ChannelManagementPredicates'

export type ChannelAdapterSupportRow = {
  adapterKey: ChannelAdapterKey
  status: 'supported' | 'blocked'
  adapterVersion: string
  evidenceRecordedAt: string | null
  updatedAt: string
}

/**
 * The only supported way to change runtime authorization. It wraps the evidence ledger and the
 * `channel_adapter_support` projection so callers cannot update one without the other.
 */
export class ChannelAcceptanceService {
  private readonly evidence: ChannelAdapterEvidenceRepository

  constructor(private readonly database: AgentPlatformDatabase) {
    this.evidence = new ChannelAdapterEvidenceRepository(database)
  }

  load(registry: ChannelAdapterAcceptanceRegistry): void {
    this.evidence.load(registry)
  }

  recordSuccessfulSmoke(input: {
    entry: ChannelAdapterAcceptanceEntry
    actor: string
    realSmokeAt: string
    now?: Date
  }): void {
    this.evidence.recordSuccessfulSmoke(input)
  }

  revokeCurrent(adapterType: AgentChannelType, now = new Date()): void {
    this.evidence.revokeCurrent(adapterType, now)
  }

  isSupported(adapterType: AgentChannelType): boolean {
    return this.evidence.isSupported(adapterType)
  }

  listSupport(): ChannelAdapterSupportRow[] {
    const rows = this.database.connection.prepare(
      'select adapter_key,status,adapter_version,evidence_recorded_at,updated_at from channel_adapter_support order by adapter_key'
    ).all() as Array<{
      adapter_key: ChannelAdapterKey
      status: 'supported' | 'blocked'
      adapter_version: string
      evidence_recorded_at: string | null
      updated_at: string
    }>
    return rows.map((row) => ({
      adapterKey: row.adapter_key,
      status: row.status,
      adapterVersion: row.adapter_version,
      evidenceRecordedAt: row.evidence_recorded_at,
      updatedAt: row.updated_at
    }))
  }
}
