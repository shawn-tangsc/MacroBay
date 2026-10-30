import { createHash } from 'node:crypto'

import { createPolicyPathFactStore, type PolicyPathFactStore } from '../policy-path/policyPathFactStore'
import { createPolicyPathObservationStore, type PolicyPathObservationStore } from '../policy-path/policyPathObservationStore'
import { statSync } from 'node:fs'

import { MACRO_CALENDAR_SCHEMA_VERSION, type MacroCalendarRevision, type MacroCalendarValue } from './macroCalendarContracts'
import { isMacroCalendarVisibleAsOf, macroCalendarStoragePolicy } from './macroCalendarPolicy'
import { createMacroCalendarSqlite, type MacroCalendarSqlite } from './macroCalendarSqlite'
import { isValidIsoTime } from '../public-query/asOfVisibility'

export type MacroCalendarRepository = {
  appendIfNew: (revision: MacroCalendarRevision) => { inserted: boolean; revision: MacroCalendarRevision }
  appendManyIfNew: (revisions: readonly MacroCalendarRevision[]) => { insertedCount: number; dedupedCount: number }
  listEffectiveMonthAsOf: (input: { monthStart: string; monthEndExclusive: string; asOf: string; limit: number }) => MacroCalendarRevision[]
  getEffectiveEventAsOf: (input: { eventKey: string; asOf: string }) => MacroCalendarRevision | undefined
  listVisibleProviderFactsAsOf: (input: { providerIds: string[]; asOf: string }) => MacroCalendarRevision[]
  getBeaObservation: (releaseGroupKey: string) => { scheduleFingerprint: string; lastAttemptAt: string } | undefined
  recordBeaObservationAttemptIfDue: (input: { releaseGroupKey: string; scheduleFingerprint: string; now: string; minimumIntervalMs: number }) => boolean
  clearBeaObservation: (releaseGroupKey: string) => boolean
  clearExpiredBeaObservations: (input: { before: string }) => number
  inspectStorage: () => { rowCount: number; databaseBytes: number; oldestDetectedAt?: string; newestDetectedAt?: string }
  /** Official policy readings; same database, outside the revision chain. */
  policyFacts: PolicyPathFactStore
  /** Market-implied odds per meeting, kept as a series. */
  policyObservations: PolicyPathObservationStore
  close: () => void
}

export const macroCalendarAtomicWritePolicy = {
  beginStatement: 'begin immediate',
  commitStatement: 'commit',
  rollbackStatement: 'rollback'
} as const

const macroCalendarAppendOnlyProviderId = 'macro-calendar-fed'
// FedFomcOfficialRevisionPolicy: receipt ties use append order, never hash lexical order.
const macroCalendarEffectiveOrderSql = `detected_at_ms desc, recorded_at desc, case when provider_id = '${macroCalendarAppendOnlyProviderId}' then rowid end desc, revision_id desc`

const macroCalendarCurrentStatePolicy = {
  automaticBlsDescriptorIds: ['macro-calendar-bls-python-schedule', 'macro-calendar-bls-calendar-family-refresh-api-v2'],
  manualBlsDescriptorId: 'macro-calendar-bls-ics-manual',
  obsoleteBlsFamilies: ['cpi', 'core-cpi'],
  obsoleteManualValueDescriptorId: 'macro-calendar-bls-employment-refresh-api'
} as const

type Row = Record<string, string | null>

type RepositoryInput = ({ filePath: string; storage?: never } | { storage: MacroCalendarSqlite; filePath?: never }) & {
  migrationExecutor?: (sql: string) => void
}

export function createMacroCalendarRepository(input: RepositoryInput): MacroCalendarRepository {
  const owned = input.storage === undefined
  const sqlite = input.storage ?? createMacroCalendarSqlite(input.filePath!)
  try {
    return initializeRepository(sqlite, input.migrationExecutor, owned)
  } catch (error) {
    if (owned) sqlite.close()
    throw error
  }
}

function initializeRepository(sqlite: MacroCalendarSqlite, migrationExecutor: RepositoryInput['migrationExecutor'], owned: boolean): MacroCalendarRepository {
  migrate(sqlite.database, migrationExecutor)
  const insert = sqlite.database.prepare('insert into mi_macro_calendar_revisions (revision_id,event_key,release_group_key,event_family,event_name_key,country_code,importance,period_key,lifecycle_state,revision_kind,scheduled_date,scheduled_at,published_at,detected_at,detected_at_ms,recorded_at,actual_json,previous_json,consensus_json,provider_id,descriptor_id,source_url,raw_record_id,evidence_hash,evidence_refs_json,snapshot_hash,replaces_revision_id,parser_version,caveats_json,schema_version) values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
  const currentByEvent = sqlite.database.prepare(`select * from mi_macro_calendar_revisions where event_key = ? order by ${macroCalendarEffectiveOrderSql} limit 1`)
  const fedSnapshot = sqlite.database.prepare('select * from mi_macro_calendar_revisions where event_key = ? and snapshot_hash = ? limit 1')
  const revisionById = sqlite.database.prepare('select * from mi_macro_calendar_revisions where revision_id = ? limit 1')
  const visibleByEvent = sqlite.database.prepare(`select * from mi_macro_calendar_revisions where event_key = ? and detected_at_ms <= ? order by ${macroCalendarEffectiveOrderSql} limit 1`)
  const automaticBlsMetricExists = sqlite.database.prepare('select 1 from mi_macro_calendar_revisions where provider_id = ? and event_family = ? and event_name_key = ? and scheduled_date = ? and descriptor_id in (?,?) limit 1')
  const deleteByEvent = sqlite.database.prepare('delete from mi_macro_calendar_revisions where event_key = ?')
  const deleteManualBlsMetric = sqlite.database.prepare('delete from mi_macro_calendar_revisions where provider_id = ? and descriptor_id = ? and event_family = ? and event_name_key = ? and scheduled_date = ?')
  const visibleByMonth = sqlite.database.prepare(`select * from mi_macro_calendar_revisions where scheduled_date >= ? and scheduled_date < ? and detected_at_ms <= ? order by event_key, ${macroCalendarEffectiveOrderSql}`)
  const beaObservation = sqlite.database.prepare('select schedule_fingerprint, last_attempt_at from mi_bea_release_observation_state where release_group_key = ?')
  const beaObservationUpsert = sqlite.database.prepare('insert into mi_bea_release_observation_state (release_group_key,schedule_fingerprint,last_attempt_at) values (?,?,?) on conflict(release_group_key) do update set schedule_fingerprint=excluded.schedule_fingerprint,last_attempt_at=excluded.last_attempt_at')
  const deleteBeaObservation = sqlite.database.prepare('delete from mi_bea_release_observation_state where release_group_key = ?')
  const deleteExpiredBeaObservations = sqlite.database.prepare('delete from mi_bea_release_observation_state where last_attempt_at < ?')

  return {
    appendIfNew(revision) {
      const stored = prepareRevision(revision)
      return replaceCurrent(stored)
    },
    appendManyIfNew(revisions) {
      const prepared = revisions.map(prepareRevision)
      let insertedCount = 0
      sqlite.database.exec(macroCalendarAtomicWritePolicy.beginStatement)
      try {
        for (const revision of prepared) insertedCount += replaceCurrent(revision).inserted ? 1 : 0
        sqlite.database.exec(macroCalendarAtomicWritePolicy.commitStatement)
        return { insertedCount, dedupedCount: prepared.length - insertedCount }
      } catch (error) {
        try { sqlite.database.exec(macroCalendarAtomicWritePolicy.rollbackStatement) } catch { /* Preserve the write failure. */ }
        throw error
      }
    },
    listEffectiveMonthAsOf({ monthStart, monthEndExclusive, asOf, limit }) {
      const asOfMs = epochTime(asOf)
      if (asOfMs === undefined) return []
      return effective(visibleByMonth.all(monthStart, monthEndExclusive, asOfMs) as Row[])
        .slice(0, Math.min(limit, macroCalendarStoragePolicy.monthQueryMaxEvents))
    },
    getEffectiveEventAsOf({ eventKey, asOf }) {
      const asOfMs = epochTime(asOf)
      if (asOfMs === undefined) return undefined
      const row = visibleByEvent.get(eventKey, asOfMs) as Row | undefined
      return row ? fromRow(row) : undefined
    },
    listVisibleProviderFactsAsOf({ providerIds, asOf }) {
      const asOfMs = epochTime(asOf)
      if (asOfMs === undefined || providerIds.length === 0) return []
      const placeholders = providerIds.map(() => '?').join(',')
      const rows = sqlite.database.prepare(`select * from mi_macro_calendar_revisions where provider_id in (${placeholders}) and detected_at_ms <= ? order by event_key, ${macroCalendarEffectiveOrderSql}`).all(...providerIds, asOfMs) as Row[]
      return effective(rows)
    },
    getBeaObservation(releaseGroupKey) {
      const row = beaObservation.get(releaseGroupKey) as Row | undefined
      return row?.schedule_fingerprint && row.last_attempt_at ? { scheduleFingerprint: row.schedule_fingerprint, lastAttemptAt: row.last_attempt_at } : undefined
    },
    recordBeaObservationAttemptIfDue({ releaseGroupKey, scheduleFingerprint, now, minimumIntervalMs }) {
      if (!releaseGroupKey || !scheduleFingerprint || persistedEpochTime(now) === undefined || !Number.isSafeInteger(minimumIntervalMs) || minimumIntervalMs < 0) return false
      sqlite.database.exec(macroCalendarAtomicWritePolicy.beginStatement)
      try {
        const current = beaObservation.get(releaseGroupKey) as Row | undefined
        const repeated = current?.schedule_fingerprint === scheduleFingerprint && current.last_attempt_at && Date.parse(now) - Date.parse(current.last_attempt_at) < minimumIntervalMs
        if (repeated) { sqlite.database.exec(macroCalendarAtomicWritePolicy.rollbackStatement); return false }
        beaObservationUpsert.run(releaseGroupKey, scheduleFingerprint, now)
        sqlite.database.exec(macroCalendarAtomicWritePolicy.commitStatement)
        return true
      } catch (error) {
        try { sqlite.database.exec(macroCalendarAtomicWritePolicy.rollbackStatement) } catch { /* Preserve write failure. */ }
        return false
      }
    },
    clearBeaObservation(releaseGroupKey) { return deleteBeaObservation.run(releaseGroupKey).changes > 0 },
    clearExpiredBeaObservations({ before }) {
      if (persistedEpochTime(before) === undefined) return 0
      return Number(deleteExpiredBeaObservations.run(before).changes)
    },
    policyFacts: createPolicyPathFactStore(sqlite.database),
    policyObservations: createPolicyPathObservationStore(sqlite.database),
    inspectStorage() {
      const aggregate = sqlite.database.prepare('select count(*) as count, min(detected_at) as oldest, max(detected_at) as newest from mi_macro_calendar_revisions').get() as Row
      return { rowCount: Number(aggregate.count), databaseBytes: sqlite.filePath === ':memory:' ? 0 : statSync(sqlite.filePath).size, oldestDetectedAt: aggregate.oldest ?? undefined, newestDetectedAt: aggregate.newest ?? undefined }
    },
    close() {
      if (owned) sqlite.close()
    }
  }

  function replaceCurrent(stored: MacroCalendarRevision): { inserted: boolean; revision: MacroCalendarRevision } {
    const current = currentByEvent.get(stored.eventKey) as Row | undefined
    if (isFedOfficialRecord(stored)) {
      const sameRevision = revisionById.get(stored.revisionId) as Row | undefined
      if (sameRevision) return { inserted: false, revision: fromRow(sameRevision) }
      const sameSnapshot = fedSnapshot.get(stored.eventKey, stored.snapshotHash) as Row | undefined
      if (sameSnapshot) return { inserted: false, revision: fromRow(sameSnapshot) }
      if (current && isFedOfficialRecord(fromRow(current)) && fedOfficialContentHash(fromRow(current)) === fedOfficialContentHash(stored)) {
        return { inserted: false, revision: fromRow(current) }
      }
      insert.run(...values(stored))
      return { inserted: true, revision: stored }
    }
    if (current && isFedOfficialRecord(fromRow(current)) && isFedSchedule(stored)) return { inserted: false, revision: fromRow(current) }
    if (current && macroCalendarCurrentHash(fromRow(current)) === macroCalendarCurrentHash(stored)) return { inserted: false, revision: fromRow(current) }
    if (current && currentRecordPriority(fromRow(current)) > currentRecordPriority(stored)) return { inserted: false, revision: fromRow(current) }
    if (isManualBlsSchedule(stored) && automaticBlsMetricExists.get(
      stored.providerId, stored.eventFamily, stored.eventNameKey, stored.scheduledDate,
      ...macroCalendarCurrentStatePolicy.automaticBlsDescriptorIds
    )) return { inserted: false, revision: stored }
    deleteByEvent.run(stored.eventKey)
    if (isAutomaticBlsRecord(stored)) deleteManualBlsMetric.run(
      stored.providerId, macroCalendarCurrentStatePolicy.manualBlsDescriptorId,
      stored.eventFamily, stored.eventNameKey, stored.scheduledDate
    )
    insert.run(...values(stored))
    return { inserted: true, revision: stored }
  }
}

function migrate(database: ReturnType<typeof createMacroCalendarSqlite>['database'], migrationExecutor?: (sql: string) => void): void {
  const execute = migrationExecutor ?? ((sql: string) => database.exec(sql))
  execute('begin')
  try {
    execute('create table if not exists mi_macro_calendar_migrations (version integer primary key); create table if not exists mi_macro_calendar_revisions (revision_id text primary key, event_key text not null, release_group_key text not null, event_family text not null, event_name_key text not null, country_code text not null, importance text not null, period_key text not null, lifecycle_state text not null, revision_kind text not null, scheduled_date text not null, scheduled_at text, published_at text, detected_at text not null, detected_at_ms integer not null, recorded_at text not null, actual_json text, previous_json text, consensus_json text, provider_id text not null, descriptor_id text not null, source_url text not null, raw_record_id text, evidence_hash text not null, evidence_refs_json text not null, snapshot_hash text not null, replaces_revision_id text, parser_version text not null, caveats_json text not null, schema_version integer not null, unique(event_key, snapshot_hash)); create index if not exists idx_mi_calendar_event_visible on mi_macro_calendar_revisions(event_key, detected_at_ms desc, recorded_at desc); create index if not exists idx_mi_calendar_month on mi_macro_calendar_revisions(scheduled_date, detected_at_ms desc); insert or ignore into mi_macro_calendar_migrations(version) values (1)')
    execute(`delete from mi_macro_calendar_revisions as old where old.provider_id != 'macro-calendar-fed' and exists (select 1 from mi_macro_calendar_revisions as current where current.event_key = old.event_key and ((case when current.provider_id = 'macro-calendar-bls' and current.descriptor_id = 'macro-calendar-bls-calendar-family-refresh-api-v2' and current.revision_kind in ('official-release','official-revision') then 3 when current.provider_id = 'macro-calendar-bls' and current.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2') then 2 else 1 end) > (case when old.provider_id = 'macro-calendar-bls' and old.descriptor_id = 'macro-calendar-bls-calendar-family-refresh-api-v2' and old.revision_kind in ('official-release','official-revision') then 3 when old.provider_id = 'macro-calendar-bls' and old.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2') then 2 else 1 end) or ((case when current.provider_id = 'macro-calendar-bls' and current.descriptor_id = 'macro-calendar-bls-calendar-family-refresh-api-v2' and current.revision_kind in ('official-release','official-revision') then 3 when current.provider_id = 'macro-calendar-bls' and current.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2') then 2 else 1 end) = (case when old.provider_id = 'macro-calendar-bls' and old.descriptor_id = 'macro-calendar-bls-calendar-family-refresh-api-v2' and old.revision_kind in ('official-release','official-revision') then 3 when old.provider_id = 'macro-calendar-bls' and old.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2') then 2 else 1 end) and (current.detected_at_ms > old.detected_at_ms or (current.detected_at_ms = old.detected_at_ms and (current.recorded_at > old.recorded_at or (current.recorded_at = old.recorded_at and current.revision_id > old.revision_id))))))); delete from mi_macro_calendar_revisions where provider_id = 'macro-calendar-bls' and (descriptor_id = 'macro-calendar-bls-employment-refresh-api' or (descriptor_id = 'macro-calendar-bls-ics-manual' and event_family in ('cpi','core-cpi'))); delete from mi_macro_calendar_revisions as manual where manual.provider_id = 'macro-calendar-bls' and manual.descriptor_id = 'macro-calendar-bls-ics-manual' and exists (select 1 from mi_macro_calendar_revisions as automatic where automatic.provider_id = 'macro-calendar-bls' and automatic.event_family = manual.event_family and automatic.event_name_key = manual.event_name_key and automatic.scheduled_date = manual.scheduled_date and automatic.descriptor_id in ('macro-calendar-bls-python-schedule','macro-calendar-bls-calendar-family-refresh-api-v2')); insert or ignore into mi_macro_calendar_migrations(version) values (2)`)
    execute("create table if not exists mi_bea_release_observation_state (release_group_key text primary key, schedule_fingerprint text not null, last_attempt_at text not null); create index if not exists idx_mi_bea_release_observation_attempt on mi_bea_release_observation_state(last_attempt_at); insert or ignore into mi_macro_calendar_migrations(version) values (3)")
    execute("create table if not exists mi_policy_path_facts (meeting_date text primary key, has_projection_materials integer not null default 0, target_lower real, target_upper real, vote_for integer, vote_against integer, dissents_json text, statement_url text, detected_at text not null, constraint mi_policy_path_facts_meeting_date check (meeting_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')); insert or ignore into mi_macro_calendar_migrations(version) values (4)")
    execute("create table if not exists mi_policy_path_observations (meeting_date text not null, at text not null, values_json text not null, quote_json text, primary key (meeting_date, at), constraint mi_policy_path_observations_meeting_date check (meeting_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')); create index if not exists idx_mi_policy_path_observations_at on mi_policy_path_observations(meeting_date, at desc); insert or ignore into mi_macro_calendar_migrations(version) values (5)")
    execute("create table if not exists mi_policy_path_sep (meeting_date text primary key, sep_json text not null, detected_at text not null, constraint mi_policy_path_sep_meeting_date check (meeting_date glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')); insert or ignore into mi_macro_calendar_migrations(version) values (6)")
    execute('commit')
  } catch (error) {
    try { execute('rollback') } catch { /* Preserve the migration failure. */ }
    throw error
  }
}

export function macroCalendarSnapshotHash(revision: MacroCalendarRevision): string {
  const { revisionId: _revisionId, recordedAt: _recordedAt, snapshotHash: _snapshotHash, rawRecordId: _rawRecordId, ...semantic } = revision
  const evidenceRefs = semantic.evidenceRefs
    .map(normalizeEvidenceRef)
    .sort((left, right) => evidenceIdentity(left).localeCompare(evidenceIdentity(right)))
  return createHash('sha256').update(JSON.stringify({ ...semantic, evidenceRefs })).digest('hex')
}

function macroCalendarCurrentHash(revision: MacroCalendarRevision): string {
  const {
    revisionId: _revisionId,
    detectedAt: _detectedAt,
    recordedAt: _recordedAt,
    rawRecordId: _rawRecordId,
    evidenceHash: _evidenceHash,
    evidenceRefs: _evidenceRefs,
    snapshotHash: _snapshotHash,
    replacesRevisionId: _replacesRevisionId,
    ...content
  } = revision
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

function isAutomaticBlsRecord(revision: MacroCalendarRevision): boolean {
  return revision.providerId === 'macro-calendar-bls' &&
    (macroCalendarCurrentStatePolicy.automaticBlsDescriptorIds as readonly string[]).includes(revision.descriptorId)
}

function isFedOfficialRecord(revision: MacroCalendarRevision): boolean {
  return revision.providerId === macroCalendarAppendOnlyProviderId &&
    (revision.revisionKind === 'official-release' || revision.revisionKind === 'official-revision')
}

/** FedFomcOfficialRevisionPolicy: only the chain tail dedupes; evidence changes remain auditable. */
function fedOfficialContentHash(revision: MacroCalendarRevision): string {
  const value = (input: MacroCalendarValue | undefined) => input ? [input.displayValue, input.numericValue, input.numericLowerBound, input.numericUpperBound, input.unit] : null
  return JSON.stringify([revision.eventKey, revision.publishedAt, value(revision.actual), value(revision.previous), revision.evidenceHash])
}

function isFedSchedule(revision: MacroCalendarRevision): boolean {
  return revision.providerId === macroCalendarAppendOnlyProviderId && revision.revisionKind === 'schedule'
}

function isManualBlsSchedule(revision: MacroCalendarRevision): boolean {
  return revision.providerId === 'macro-calendar-bls' && revision.revisionKind === 'schedule' &&
    revision.descriptorId === macroCalendarCurrentStatePolicy.manualBlsDescriptorId &&
    revision.eventFamily !== 'cpi' && revision.eventFamily !== 'core-cpi'
}

function currentRecordPriority(revision: MacroCalendarRevision): number {
  if (isAutomaticBlsRecord(revision) && (revision.revisionKind === 'official-release' || revision.revisionKind === 'official-revision')) return 3
  if (isAutomaticBlsRecord(revision)) return 2
  return 1
}

function prepareRevision(revision: MacroCalendarRevision): MacroCalendarRevision {
  if (persistedEpochTime(revision.detectedAt) === undefined) throw new Error('invalid detectedAt')
  return { ...revision, snapshotHash: macroCalendarSnapshotHash(revision) }
}

function values(revision: MacroCalendarRevision): Array<string | number | null> {
  const detectedAtMs = persistedEpochTime(revision.detectedAt)
  if (detectedAtMs === undefined) throw new Error('invalid detectedAt')
  return [revision.revisionId, revision.eventKey, revision.releaseGroupKey, revision.eventFamily, revision.eventNameKey, revision.countryCode, revision.importance, revision.periodKey, revision.lifecycleState, revision.revisionKind, revision.scheduledDate, revision.scheduledAt ?? null, revision.publishedAt ?? null, revision.detectedAt, detectedAtMs, revision.recordedAt, json(revision.actual), json(revision.previous), json(revision.consensus), revision.providerId, revision.descriptorId, revision.sourceUrl, revision.rawRecordId ?? null, revision.evidenceHash, JSON.stringify(revision.evidenceRefs), revision.snapshotHash, revision.replacesRevisionId ?? null, revision.parserVersion, JSON.stringify(revision.caveats), MACRO_CALENDAR_SCHEMA_VERSION]
}

function effective(rows: Row[]): MacroCalendarRevision[] {
  const seen = new Set<string>()
  return rows.map(fromRow).filter((revision) => !seen.has(revision.eventKey) && Boolean(seen.add(revision.eventKey)))
}

function fromRow(row: Row): MacroCalendarRevision {
  return { revisionId: required(row, 'revision_id'), eventKey: required(row, 'event_key'), releaseGroupKey: required(row, 'release_group_key'), eventFamily: required(row, 'event_family') as MacroCalendarRevision['eventFamily'], eventNameKey: required(row, 'event_name_key'), countryCode: 'US', importance: 'high', periodKey: required(row, 'period_key'), lifecycleState: required(row, 'lifecycle_state') as MacroCalendarRevision['lifecycleState'], revisionKind: required(row, 'revision_kind') as MacroCalendarRevision['revisionKind'], scheduledDate: required(row, 'scheduled_date'), scheduledAt: row.scheduled_at ?? undefined, publishedAt: row.published_at ?? undefined, detectedAt: required(row, 'detected_at'), recordedAt: required(row, 'recorded_at'), actual: parseValue(row.actual_json), previous: parseValue(row.previous_json), consensus: parseValue(row.consensus_json), providerId: required(row, 'provider_id') as MacroCalendarRevision['providerId'], descriptorId: required(row, 'descriptor_id'), sourceUrl: required(row, 'source_url'), rawRecordId: row.raw_record_id ?? undefined, evidenceHash: required(row, 'evidence_hash'), evidenceRefs: JSON.parse(required(row, 'evidence_refs_json')), snapshotHash: required(row, 'snapshot_hash'), replacesRevisionId: row.replaces_revision_id ?? undefined, parserVersion: required(row, 'parser_version'), caveats: JSON.parse(required(row, 'caveats_json')) }
}

function required(row: Row, name: string): string { return row[name] ?? '' }
function json(value: MacroCalendarValue | undefined): string | null { return value ? JSON.stringify(value) : null }
function parseValue(value: string | null): MacroCalendarValue | undefined { return value ? JSON.parse(value) : undefined }
function normalizeEvidenceRef(value: MacroCalendarRevision['evidenceRefs'][number]): Omit<MacroCalendarRevision['evidenceRefs'][number], 'rawRecordId'> {
  const { rawRecordId: _rawRecordId, ...stable } = value
  return { ...stable, fieldKinds: [...stable.fieldKinds].sort() }
}
function evidenceIdentity(value: Omit<MacroCalendarRevision['evidenceRefs'][number], 'rawRecordId'>): string {
  return JSON.stringify([value.providerId, value.descriptorId, value.sourceUrl, value.evidenceHash, value.detectedAt, value.fieldKinds])
}
function epochTime(value: string): number | undefined { return isValidIsoTime(value) ? Date.parse(value) : undefined }
function persistedEpochTime(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return undefined
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value ? milliseconds : undefined
}
