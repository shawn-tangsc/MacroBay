import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { ChannelAdapterKey } from './ChannelManagementPredicates'

/**
 * Test-only support projection seed. Production support comes exclusively from
 * `ChannelAdapterEvidenceRepository.recordSuccessfulSmoke`.
 */
export function seedChannelAdapterSupport(
  database: AgentPlatformDatabase,
  adapterKeys: readonly ChannelAdapterKey[] = ['telegram'],
  adapterVersion = 'test-support'
): void {
  const now = '2026-07-19T00:00:00.000Z'
  const statement = database.connection.prepare(
    `insert into channel_adapter_support(adapter_key, status, adapter_version, evidence_recorded_at, updated_at)
     values (?, 'supported', ?, ?, ?)
     on conflict(adapter_key) do update set status = 'supported', adapter_version = excluded.adapter_version,
       evidence_recorded_at = excluded.evidence_recorded_at, updated_at = excluded.updated_at`
  )
  for (const adapterKey of adapterKeys) statement.run(adapterKey, adapterVersion, now, now)
}
