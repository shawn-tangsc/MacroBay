import type { AgentPlatformDatabase } from '../db/createAgentPlatformDatabase'
import type { AgentChannelType } from '../schemas/channelSchemas'
import { ChannelAdapterAcceptanceRegistry } from './ChannelAdapterAcceptanceRegistry'
import {
  channelAdapterKeyForType,
  channelAdapterKeys,
  type ChannelAdapterKey
} from './ChannelManagementPredicates'
import type { ChannelAdapterAcceptanceEntry } from './channelContracts'

/** Restricted main-process evidence store. Current pointers make superseded records unable to re-enable adapters. */
export class ChannelAdapterEvidenceRepository {
  constructor(private readonly database: AgentPlatformDatabase) {}

  load(registry: ChannelAdapterAcceptanceRegistry): void {
    registry.reset()
    this.backfillLegacyEvidence()
    const rows = this.database.connection.prepare(
      `select p.adapter_type, p.adapter_version, e.evidence_json, e.recorded_at
       from channel_adapter_acceptance_current p
       join channel_adapter_acceptance_evidence_versions e
         on e.adapter_type = p.adapter_type and e.adapter_version = p.adapter_version
       where e.revoked_at is null and e.superseded_at is null`
    ).all() as Array<{ adapter_type: AgentChannelType; adapter_version: string; evidence_json: string; recorded_at: string }>
    const supported: Array<{ adapterKey: ChannelAdapterKey; adapterVersion: string; realSmokeAt: string }> = []
    for (const row of rows) {
      try {
        const record = JSON.parse(row.evidence_json) as { entry?: ChannelAdapterAcceptanceEntry; realSmokeAt?: unknown }
        if (!isRealSmokeTimestamp(record.realSmokeAt) || !record.entry || !isCompleteEvidence(record.entry) ||
          record.entry.adapterType !== row.adapter_type || record.entry.adapterVersion !== row.adapter_version) continue
        registry.upsert(record.entry)
        supported.push({
          adapterKey: channelAdapterKeyForType(record.entry.adapterType),
          adapterVersion: record.entry.adapterVersion,
          realSmokeAt: record.realSmokeAt
        })
      } catch { /* Corrupt/incomplete evidence is never an enable grant. */ }
    }
    this.syncSupport(supported)
  }

  /** Runtime authorization projection: only the current, unrevoked evidence may open an adapter. */
  isSupported(adapterType: AgentChannelType): boolean {
    const row = this.database.connection.prepare(
      'select status from channel_adapter_support where adapter_key = ?'
    ).get(channelAdapterKeyForType(adapterType)) as { status: 'supported' | 'blocked' } | undefined
    return row?.status === 'supported'
  }

  recordSuccessfulSmoke(input: { entry: ChannelAdapterAcceptanceEntry; actor: string; realSmokeAt: string; now?: Date }): void {
    const checked = new ChannelAdapterAcceptanceRegistry([input.entry]).getRequired(input.entry.adapterType)
    if (checked.status !== 'supported' || !input.actor.trim() || input.actor.length > 120 || !isRealSmokeTimestamp(input.realSmokeAt)) {
      throw new Error('channel-evidence-invalid')
    }
    const now = (input.now ?? new Date()).toISOString()
    this.database.transact(() => {
      const existing = this.database.connection.prepare(
        `select revoked_at, superseded_at from channel_adapter_acceptance_evidence_versions
         where adapter_type = ? and adapter_version = ?`
      ).get(checked.adapterType, checked.adapterVersion) as { revoked_at: string | null; superseded_at: string | null } | undefined
      const current = this.database.connection.prepare(
        'select adapter_version from channel_adapter_acceptance_current where adapter_type = ?'
      ).get(checked.adapterType) as { adapter_version: string } | undefined
      if (existing && (existing.revoked_at !== null || existing.superseded_at !== null || current?.adapter_version !== checked.adapterVersion)) {
        throw new Error('channel-evidence-version-retired')
      }
      if (existing) {
        // A current, non-revoked version may refresh its same-version evidence only.
        this.database.connection.prepare(
          `update channel_adapter_acceptance_evidence_versions
           set evidence_json=?,recorded_at=?,recorded_by=?
           where adapter_type=? and adapter_version=? and revoked_at is null and superseded_at is null`
        ).run(JSON.stringify({ entry: checked, realSmokeAt: input.realSmokeAt }), now, input.actor.trim(), checked.adapterType, checked.adapterVersion)
        this.setSupport(channelAdapterKeyForType(checked.adapterType), 'supported', checked.adapterVersion, input.realSmokeAt, now)
        return
      }
      this.database.connection.prepare(
        `insert into channel_adapter_acceptance_evidence_versions(
           adapter_type, adapter_version, evidence_json, recorded_at, recorded_by, revoked_at, superseded_at
         ) values (?, ?, ?, ?, ?, null, null)`
      ).run(checked.adapterType, checked.adapterVersion, JSON.stringify({ entry: checked, realSmokeAt: input.realSmokeAt }), now, input.actor.trim())
      this.database.connection.prepare(
        `update channel_adapter_acceptance_evidence_versions set superseded_at = ?
         where adapter_type = ? and adapter_version <> ? and superseded_at is null`
      ).run(now, checked.adapterType, checked.adapterVersion)
      this.database.connection.prepare(
        `insert into channel_adapter_acceptance_current(adapter_type, adapter_version, updated_at) values (?, ?, ?)
         on conflict(adapter_type) do update set adapter_version=excluded.adapter_version,updated_at=excluded.updated_at`
      ).run(checked.adapterType, checked.adapterVersion, now)
      this.setSupport(channelAdapterKeyForType(checked.adapterType), 'supported', checked.adapterVersion, input.realSmokeAt, now)
    })
  }

  revokeCurrent(adapterType: AgentChannelType, now = new Date()): void {
    const adapterKey = channelAdapterKeyForType(adapterType)
    this.database.transact(() => {
      const current = this.database.connection.prepare(
        'select adapter_version from channel_adapter_acceptance_current where adapter_type = ?'
      ).get(adapterType) as { adapter_version: string } | undefined
      if (current) {
        this.database.connection.prepare(
          `update channel_adapter_acceptance_evidence_versions set revoked_at = ?
           where adapter_type = ? and adapter_version = ?`
        ).run(now.toISOString(), adapterType, current.adapter_version)
        this.database.connection.prepare('delete from channel_adapter_acceptance_current where adapter_type = ?').run(adapterType)
      }
      // Even a partially written ledger must not leave a supported projection behind.
      this.setSupport(adapterKey, 'blocked', current?.adapter_version ?? '', null, now.toISOString())
    })
  }

  private syncSupport(entries: ReadonlyArray<{ adapterKey: ChannelAdapterKey; adapterVersion: string; realSmokeAt: string }>): void {
    const now = new Date().toISOString()
    this.database.transact(() => {
      for (const adapterKey of channelAdapterKeys) this.setSupport(adapterKey, 'blocked', '', null, now)
      for (const entry of entries) {
        this.setSupport(entry.adapterKey, 'supported', entry.adapterVersion, entry.realSmokeAt, now)
      }
    })
  }

  private setSupport(
    adapterKey: ChannelAdapterKey,
    status: 'supported' | 'blocked',
    adapterVersion: string,
    evidenceRecordedAt: string | null,
    now: string
  ): void {
    this.database.connection.prepare(
      `insert into channel_adapter_support(adapter_key, status, adapter_version, evidence_recorded_at, updated_at)
       values (?, ?, ?, ?, ?)
       on conflict(adapter_key) do update set
         status = excluded.status,
         adapter_version = excluded.adapter_version,
         evidence_recorded_at = excluded.evidence_recorded_at,
         updated_at = excluded.updated_at`
    ).run(adapterKey, status, adapterVersion, evidenceRecordedAt, now)
  }

  private backfillLegacyEvidence(): void {
    const legacy = this.database.connection.prepare(
      'select adapter_type, evidence_json, recorded_at, recorded_by from channel_adapter_acceptance_evidence'
    ).all() as Array<{ adapter_type: AgentChannelType; evidence_json: string; recorded_at: string; recorded_by: string }>
    this.database.transact(() => {
      for (const row of legacy) {
        try {
          const record = JSON.parse(row.evidence_json) as { entry?: ChannelAdapterAcceptanceEntry; realSmokeAt?: unknown }
          if (!record.entry || record.entry.adapterType !== row.adapter_type || !record.entry.adapterVersion ||
            !isRealSmokeTimestamp(record.realSmokeAt) || !isCompleteEvidence(record.entry)) continue
          // A revoked or superseded ledger must never be recreated from the legacy
          // one-row source during a later desktop start.
          const hasLedger = this.database.connection.prepare(
            'select 1 from channel_adapter_acceptance_evidence_versions where adapter_type = ? limit 1'
          ).get(row.adapter_type)
          if (hasLedger) continue
          this.database.connection.prepare(
            `insert or ignore into channel_adapter_acceptance_evidence_versions(
               adapter_type,adapter_version,evidence_json,recorded_at,recorded_by,revoked_at,superseded_at
             ) values(?,?,?,?,?,null,null)`
          ).run(row.adapter_type, record.entry.adapterVersion, row.evidence_json, row.recorded_at, row.recorded_by)
          this.database.connection.prepare(
            `insert or ignore into channel_adapter_acceptance_current(adapter_type,adapter_version,updated_at) values(?,?,?)`
          ).run(row.adapter_type, record.entry.adapterVersion, row.recorded_at)
        } catch { /* Legacy rows without complete real smoke never become current. */ }
      }
    })
  }
}

function isRealSmokeTimestamp(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value))
}

function isCompleteEvidence(entry: ChannelAdapterAcceptanceEntry): boolean {
  try {
    return new ChannelAdapterAcceptanceRegistry([entry]).canEnable(entry.adapterType)
  } catch {
    return false
  }
}
