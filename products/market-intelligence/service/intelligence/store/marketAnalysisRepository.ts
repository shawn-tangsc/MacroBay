import { createHash, randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import type {
  AnalysisRun,
  AnalysisSummary,
  EvidenceSnapshot,
  EventGroup,
  Prediction,
  PredictionVerification,
  TimelineEntry
} from '../../../contracts/marketAnalysisContracts'
import { buildAnalysisSnapshotHash, canonicalizeMarketAnalysisJson, snapshotHashInput } from '../analysis/analysisHash'
import { analysisConclusionRetentionPolicy } from '../retention/analysisConclusionRetention'
import { marketAnalysisSqlitePolicy, createMarketAnalysisSqlite, type MarketAnalysisSqlite } from './marketAnalysisSqlite'

const MARKET_ANALYSIS_SCHEMA_VERSION = 2
const DEFAULT_TIMELINE_PAGE_SIZE = 50
const MAX_TIMELINE_PAGE_SIZE = 50
const CURSOR_TTL_MS = 15 * 60 * 1000
const ARCHIVE_REF_PATTERN = /^[a-f0-9]{64}\.json\.gz$/
const ARCHIVE_STATUS = Object.freeze({ readable: 'readable', unavailable: 'unavailable' } as const)

export const marketAnalysisStoragePolicy = Object.freeze({
  owner: 'products/market-intelligence/service/intelligence/store',
  schemaVersion: MARKET_ANALYSIS_SCHEMA_VERSION,
  defaultTimelinePageSize: DEFAULT_TIMELINE_PAGE_SIZE,
  maximumTimelinePageSize: MAX_TIMELINE_PAGE_SIZE,
  cursorTtlMs: CURSOR_TTL_MS
})

export type MarketAnalysisTimelinePage = Readonly<{ items: TimelineEntry[]; nextCursor: string | null }>
export type MarketAnalysisArchiveMetadata = Readonly<{
  archiveRef: string
  archiveHash: string
  archiveBytes: number
  archiveSchemaVersion: number
  archiveStatus: keyof typeof ARCHIVE_STATUS
}>
export type MarketAnalysisRepository = Readonly<ReturnType<typeof createRepository>>
type Row = Record<string, unknown>
type RepositoryInput = ({ filePath: string; storage?: never } | { storage: MarketAnalysisSqlite; filePath?: never })

export function createMarketAnalysisRepository(input: RepositoryInput): MarketAnalysisRepository {
  const owned = !input.storage
  const sqlite = input.storage ?? createMarketAnalysisSqlite(input.filePath!)
  try {
    return createRepository(sqlite, owned)
  } catch (error) {
    if (owned) sqlite.close()
    throw error
  }
}

function createRepository(sqlite: MarketAnalysisSqlite, owned: boolean) {
  const cursors = new Map<string, Readonly<{ eventGroupId?: string; occurredAt: string; id: string; expiresAt: number }>>()
  migrate(sqlite.database)

  return {
    migrate() { migrate(sqlite.database) },
    inspectSchema() {
      const tables = (sqlite.database.prepare("select name from sqlite_schema where type = 'table' and name like 'mi_analysis_%' order by name").all() as Row[]).map(row => String(row.name))
      const migrationRows = Number((sqlite.database.prepare('select count(*) as count from mi_analysis_migrations').get() as Row).count)
      return { tables, migrationRows }
    },
    appendEventGroup(value: EventGroup) {
      validateEventGroup(value)
      if (value.currentSummaryId && !exists(sqlite, 'mi_analysis_summaries', value.currentSummaryId)) throw new Error('analysis-summary-not-found')
      if (value.supersededByGroupId && !exists(sqlite, 'mi_analysis_event_groups', value.supersededByGroupId)) throw new Error('analysis-event-group-not-found')
      sqlite.database.prepare(`insert into mi_analysis_event_groups (id,schema_version,status,group_type,merge_key,first_observed_at,last_observed_at,review_deadline_at,event_refs_json,trigger_count,review_count,current_summary_id,superseded_by_group_id,revision,created_at,updated_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) on conflict(id) do update set status=excluded.status, last_observed_at=excluded.last_observed_at, review_deadline_at=excluded.review_deadline_at, event_refs_json=excluded.event_refs_json, trigger_count=excluded.trigger_count, review_count=excluded.review_count, current_summary_id=excluded.current_summary_id, superseded_by_group_id=excluded.superseded_by_group_id, revision=excluded.revision, updated_at=excluded.updated_at`).run(
        value.id, value.schemaVersion, value.status, value.groupType, value.mergeKey, value.firstObservedAt, value.lastObservedAt, value.reviewDeadlineAt, json(value.eventRefs), value.triggerCount, value.reviewCount, value.currentSummaryId, value.supersededByGroupId, value.revision, value.createdAt, value.updatedAt)
    },
    getEventGroup(id: string) { const row = sqlite.database.prepare('select * from mi_analysis_event_groups where id = ?').get(id) as Row | undefined; return row ? fromEventGroup(row) : undefined },
    listEventGroups() { return (sqlite.database.prepare('select * from mi_analysis_event_groups order by updated_at desc, id desc').all() as Row[]).map(fromEventGroup) },
    findEventGroupByMergeKey(mergeKey: string) {
      const stableKey = stableMergeKey(mergeKey)
      const rows = sqlite.database.prepare("select * from mi_analysis_event_groups where status in ('open','monitoring') order by updated_at desc, revision desc").all() as Row[]
      const row = rows.find(candidate => stableMergeKey(String(candidate.merge_key)) === stableKey)
      return row ? fromEventGroup(row) : undefined
    },
    appendSnapshot(value: EvidenceSnapshot, archive?: MarketAnalysisArchiveMetadata) {
      validateSnapshot(value)
      validateArchiveMetadata(archive)
      if (!exists(sqlite, 'mi_analysis_event_groups', value.eventGroupId)) throw new Error('analysis-event-group-not-found')
      sqlite.database.prepare(`insert into mi_analysis_snapshots (id,schema_version,event_group_id,as_of,data_cutoff,snapshot_hash,profile_id,facts_json,missing_domains_json,caveats_json,evidence_refs_json,source_health_json,created_at,policy_version,archive_ref,archive_hash,archive_bytes,archive_schema_version,archive_status)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.id, value.schemaVersion, value.eventGroupId, value.asOf, value.dataCutoff, value.snapshotHash, value.profileId, json(value.facts), json(value.missingDomains), json(value.caveats), json(value.evidenceRefs), json(value.sourceHealth), value.createdAt, value.policyVersion, archive?.archiveRef ?? null, archive?.archiveHash ?? null, archive?.archiveBytes ?? null, archive?.archiveSchemaVersion ?? null, archive?.archiveStatus ?? null)
    },
    listSnapshots(eventGroupId: string) {
      return (sqlite.database.prepare('select * from mi_analysis_snapshots where event_group_id = ? order by rowid asc').all(eventGroupId) as Row[]).map(fromSnapshot)
    },
    getSnapshot(id: string) {
      const row = sqlite.database.prepare('select * from mi_analysis_snapshots where id = ?').get(id) as Row | undefined
      return row ? fromSnapshot(row) : undefined
    },
    enqueueRun(value: AnalysisRun) {
      validateRun(value)
      const existing = sqlite.database.prepare('select * from mi_analysis_runs where idempotency_key = ?').get(value.idempotencyKey) as Row | undefined
      if (existing) return { created: false, run: fromRun(existing) }
      const snapshot = sqlite.database.prepare('select event_group_id, snapshot_hash from mi_analysis_snapshots where id=?').get(value.snapshotId) as Row | undefined
      if (!exists(sqlite, 'mi_analysis_event_groups', value.eventGroupId) || !snapshot || snapshot.event_group_id !== value.eventGroupId || snapshot.snapshot_hash !== value.snapshotHash) throw new Error('analysis-reference-not-found')
      sqlite.database.prepare(`insert into mi_analysis_runs (id,schema_version,event_group_id,snapshot_id,snapshot_hash,analysis_phase,trigger_key,idempotency_key,status,attempt,retry_of_run_id,model_provider_id,model_id,policy_version,prompt_version,skill_version,output_schema_version,job_run_id,trace_id,failure_code,failure_detail_code,queued_at,started_at,completed_at)
        values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.id, value.schemaVersion, value.eventGroupId, value.snapshotId, value.snapshotHash, value.analysisPhase, value.triggerKey, value.idempotencyKey, value.status, value.attempt, value.retryOfRunId, value.modelProviderId, value.modelId, value.policyVersion, value.promptVersion, value.skillVersion, value.outputSchemaVersion, value.jobRunId, value.traceId, value.failureCode, value.failureDetailCode, value.queuedAt, value.startedAt, value.completedAt)
      return { created: true, run: value }
    },
    getRun(id: string) { const row = sqlite.database.prepare('select * from mi_analysis_runs where id = ?').get(id) as Row | undefined; return row ? fromRun(row) : undefined },
    listRuns() { return (sqlite.database.prepare('select * from mi_analysis_runs order by queued_at desc, id desc').all() as Row[]).map(fromRun) },
    getSnapshotArchive(id: string) {
      const row = sqlite.database.prepare('select archive_ref,archive_hash,archive_bytes,archive_schema_version,archive_status from mi_analysis_snapshots where id=?').get(id) as Row | undefined
      return row?.archive_ref ? { archiveRef: String(row.archive_ref), archiveHash: String(row.archive_hash), archiveBytes: Number(row.archive_bytes), archiveSchemaVersion: Number(row.archive_schema_version), archiveStatus: row.archive_status as MarketAnalysisArchiveMetadata['archiveStatus'] } : undefined
    },
    getSummaryArchive(id: string) {
      const row = sqlite.database.prepare('select archive_ref,archive_hash,archive_bytes,archive_schema_version,archive_status from mi_analysis_summaries where id=?').get(id) as Row | undefined
      return row?.archive_ref ? { archiveRef: String(row.archive_ref), archiveHash: String(row.archive_hash), archiveBytes: Number(row.archive_bytes), archiveSchemaVersion: Number(row.archive_schema_version), archiveStatus: row.archive_status as MarketAnalysisArchiveMetadata['archiveStatus'] } : undefined
    },
    updateRunStatus(value: Readonly<{ id: string; status: AnalysisRun['status']; completedAt?: string; failureCode?: string; failureDetailCode?: string }>) {
      if (value.status === 'queued' || value.status === 'running' || value.status === 'succeeded') throw new Error('analysis-run-status-transition-invalid')
      const result = sqlite.database.prepare('update mi_analysis_runs set status=?, completed_at=coalesce(?,completed_at), failure_code=coalesce(?,failure_code), failure_detail_code=coalesce(?,failure_detail_code) where id=? and status not in (\'succeeded\',\'failed\',\'cancelled\',\'invalid-output\',\'stale\',\'superseded\')').run(value.status, value.completedAt ?? null, value.failureCode ?? null, value.failureDetailCode ?? null, value.id)
      return Number(result.changes) === 1
    },
    claimRun(id: string, startedAt: string) {
      return Number(sqlite.database.prepare("update mi_analysis_runs set status='running', started_at=? where id=? and status='queued'").run(startedAt, id).changes) === 1
    },
    commitSuccessfulAnalysis(value: Readonly<{ runId: string; summary: AnalysisSummary; predictions: readonly Prediction[]; timeline: TimelineEntry; archive?: MarketAnalysisArchiveMetadata }>) {
      const database = sqlite.database
      database.exec('begin immediate')
      try {
        const runRow = database.prepare('select * from mi_analysis_runs where id = ?').get(value.runId) as Row | undefined
        if (!runRow || runRow.status !== 'running') throw new Error('analysis-run-not-running')
        const run = fromRun(runRow)
        const snapshotRow = database.prepare('select * from mi_analysis_snapshots where id = ?').get(run.snapshotId) as Row | undefined
        if (!snapshotRow || snapshotRow.snapshot_hash !== run.snapshotHash) throw new Error('analysis-snapshot-changed')
        if (value.summary.analysisRunId !== run.id || value.summary.eventGroupId !== run.eventGroupId) throw new Error('analysis-summary-reference-invalid')
        const snapshot = fromSnapshot(snapshotRow)
        validateSummaryReferences(value.summary, snapshot)
        validateArchiveMetadata(value.archive)
        database.prepare(`insert into mi_analysis_summaries (id,schema_version,analysis_run_id,event_group_id,version,payload_json,evidence_refs_json,created_at,archive_ref,archive_hash,archive_bytes,archive_schema_version,archive_status) values (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(value.summary.id, value.summary.schemaVersion, value.summary.analysisRunId, value.summary.eventGroupId, value.summary.version, json(value.summary), json(value.summary.evidenceRefs), value.summary.createdAt, value.archive?.archiveRef ?? null, value.archive?.archiveHash ?? null, value.archive?.archiveBytes ?? null, value.archive?.archiveSchemaVersion ?? null, value.archive?.archiveStatus ?? null)
        for (const predictionValue of value.predictions) {
          if (predictionValue.summaryId !== value.summary.id || Date.parse(predictionValue.horizonEnd) <= Date.parse(predictionValue.horizonStart)) throw new Error('analysis-prediction-invalid')
          database.prepare(`insert into mi_analysis_predictions (id,schema_version,summary_id,asset,horizon_start,horizon_end,payload_json,status,verification_due_at,created_at) values (?,?,?,?,?,?,?,?,?,?)`).run(predictionValue.id, predictionValue.schemaVersion, predictionValue.summaryId, predictionValue.asset, predictionValue.horizonStart, predictionValue.horizonEnd, json(predictionValue), predictionValue.status, predictionValue.verificationDueAt, predictionValue.createdAt)
        }
        if (value.timeline.eventGroupId !== run.eventGroupId || value.timeline.analysisRunId !== run.id || value.timeline.summaryRef !== value.summary.id) throw new Error('analysis-timeline-reference-invalid')
        insertTimeline(database, value.timeline)
        const current = database.prepare('select current_summary_id from mi_analysis_event_groups where id = ?').get(run.eventGroupId) as Row | undefined
        const currentSummaryId = typeof current?.current_summary_id === 'string' ? current.current_summary_id : null
        const currentSummary = currentSummaryId ? database.prepare('select version,created_at from mi_analysis_summaries where id = ?').get(currentSummaryId) as Row | undefined : undefined
        const currentVersion = Number(currentSummary?.version ?? 0)
        const currentCreatedAt = typeof currentSummary?.created_at === 'string' ? currentSummary.created_at : ''
        if (value.summary.version > currentVersion && value.summary.createdAt > currentCreatedAt) database.prepare('update mi_analysis_event_groups set current_summary_id=?, updated_at=?, revision=revision+1 where id=?').run(value.summary.id, value.summary.createdAt, run.eventGroupId)
        database.prepare("update mi_analysis_runs set status='succeeded', completed_at=? where id=?").run(value.summary.createdAt, run.id)
        database.exec('commit')
      } catch (error) {
        try { database.exec('rollback') } catch { /* preserve original failure */ }
        throw error
      }
    },
    appendTimeline(value: TimelineEntry) {
      if (!exists(sqlite, 'mi_analysis_event_groups', value.eventGroupId)) throw new Error('analysis-event-group-not-found')
      if (value.analysisRunId) {
        const run = sqlite.database.prepare('select event_group_id from mi_analysis_runs where id=?').get(value.analysisRunId) as Row | undefined
        if (!run || run.event_group_id !== value.eventGroupId) throw new Error('analysis-run-not-found')
      }
      if (value.summaryRef) {
        const summary = sqlite.database.prepare('select event_group_id from mi_analysis_summaries where id=?').get(value.summaryRef) as Row | undefined
        if (!summary || summary.event_group_id !== value.eventGroupId) throw new Error('analysis-summary-not-found')
      }
      insertTimeline(sqlite.database, value)
    },
    listTimeline(input: Readonly<{ eventGroupId?: string; cursor?: string | null; limit?: number }>): MarketAnalysisTimelinePage {
      const limit = Number.isSafeInteger(input.limit) ? Math.max(1, Math.min(marketAnalysisStoragePolicy.maximumTimelinePageSize, input.limit!)) : marketAnalysisStoragePolicy.defaultTimelinePageSize
      let position: Readonly<{ occurredAt: string; id: string }> | undefined
      if (input.cursor) {
        const context = cursors.get(input.cursor)
        if (!context || context.expiresAt < Date.now() || context.eventGroupId !== input.eventGroupId) throw new Error('analysis-invalid-cursor')
        position = context
        cursors.delete(input.cursor)
      }
      const filters = [input.eventGroupId ? 'event_group_id = ?' : '', position ? '(occurred_at < ? or (occurred_at = ? and id < ?))' : ''].filter(Boolean)
      const where = filters.length ? `where ${filters.join(' and ')}` : ''
      const parameters = [
        ...(input.eventGroupId ? [input.eventGroupId] : []),
        ...(position ? [position.occurredAt, position.occurredAt, position.id] : []),
        limit + 1
      ]
      const rows = sqlite.database.prepare(`select * from mi_analysis_timeline ${where} order by occurred_at desc, id desc limit ?`).all(...parameters) as Row[]
      const items = rows.slice(0, limit).map(fromTimeline)
      const hasMore = rows.length > limit
      const nextCursor = hasMore ? randomUUID() : null
      const last = items.at(-1)
      if (nextCursor && last) cursors.set(nextCursor, { eventGroupId: input.eventGroupId, occurredAt: last.occurredAt, id: last.id, expiresAt: Date.now() + marketAnalysisStoragePolicy.cursorTtlMs })
      return { items, nextCursor }
    },
    getSummary(id: string) { const row = sqlite.database.prepare('select payload_json from mi_analysis_summaries where id=?').get(id) as Row | undefined; return row ? JSON.parse(String(row.payload_json)) as AnalysisSummary : undefined },
    getSummaryForRun(analysisRunId: string) { const row = sqlite.database.prepare('select payload_json from mi_analysis_summaries where analysis_run_id=?').get(analysisRunId) as Row | undefined; return row ? JSON.parse(String(row.payload_json)) as AnalysisSummary : undefined },
    listPredictions(summaryId: string) { return (sqlite.database.prepare('select payload_json from mi_analysis_predictions where summary_id=? order by rowid asc').all(summaryId) as Row[]).map(row => JSON.parse(String(row.payload_json)) as Prediction) },
    listDuePredictions(asOf: string) { return (sqlite.database.prepare("select payload_json from mi_analysis_predictions where status='pending' and verification_due_at <= ? order by verification_due_at asc, id asc").all(asOf) as Row[]).map(row => JSON.parse(String(row.payload_json)) as Prediction) },
    hasPredictionVerificationAt(predictionId: string, evaluatedAt: string) { return Boolean(sqlite.database.prepare('select 1 from mi_analysis_prediction_verifications where prediction_id=? and evaluated_at=?').get(predictionId, evaluatedAt)) },
    updatePredictionStatus(value: Readonly<{ id: string; status: Prediction['status'] }>) { return Number(sqlite.database.prepare('update mi_analysis_predictions set status=?, payload_json=json_set(payload_json, \'$.status\', ?) where id=?').run(value.status, value.status, value.id).changes) === 1 },
    appendPredictionVerificationAndUpdateStatus(value: PredictionVerification) {
      const database = sqlite.database
      database.exec('begin immediate')
      try {
        if (!exists(sqlite, 'mi_analysis_predictions', value.predictionId)) throw new Error('analysis-prediction-not-found')
        database.prepare(`insert into mi_analysis_prediction_verifications (id,prediction_id,status,evaluated_at,rule_version,evidence_refs_json,reason_code,reason,schema_version) values (?,?,?,?,?,?,?,?,?)`).run(value.id, value.predictionId, value.status, value.evaluatedAt, value.ruleVersion, json(value.evidenceRefs), value.reasonCode, value.reason, 1)
        const updated = Number(database.prepare('update mi_analysis_predictions set status=?, payload_json=json_set(payload_json, \'$.status\', ?) where id=? and status=\'pending\'').run(value.status, value.status, value.predictionId).changes) === 1
        if (!updated) throw new Error('analysis-prediction-status-not-pending')
        database.exec('commit')
      } catch (error) {
        try { database.exec('rollback') } catch { /* preserve original failure */ }
        throw error
      }
    },
    getTimelineEntry(id: string) { const row = sqlite.database.prepare('select * from mi_analysis_timeline where id=?').get(id) as Row | undefined; return row ? fromTimeline(row) : undefined },
    appendPredictionVerification(value: PredictionVerification) {
      if (!exists(sqlite, 'mi_analysis_predictions', value.predictionId)) throw new Error('analysis-prediction-not-found')
      sqlite.database.prepare(`insert into mi_analysis_prediction_verifications (id,prediction_id,status,evaluated_at,rule_version,evidence_refs_json,reason_code,reason,schema_version) values (?,?,?,?,?,?,?,?,?)`).run(value.id, value.predictionId, value.status, value.evaluatedAt, value.ruleVersion, json(value.evidenceRefs), value.reasonCode, value.reason, 1)
    },
    appendTriggerLedger(value: Readonly<{ id: string; eventGroupId: string; triggerKey: string; changeHash: string; decision: string; reasonCode: string; snapshotHash: string | null; analysisRunId: string | null; createdAt: string }>) {
      if (!exists(sqlite, 'mi_analysis_event_groups', value.eventGroupId)) throw new Error('analysis-event-group-not-found')
      if (value.analysisRunId && !exists(sqlite, 'mi_analysis_runs', value.analysisRunId)) throw new Error('analysis-run-not-found')
      sqlite.database.prepare(`insert into mi_analysis_trigger_ledger (id,schema_version,event_group_id,trigger_key,change_hash,decision,reason_code,snapshot_hash,analysis_run_id,created_at) values (?,?,?,?,?,?,?,?,?,?) on conflict(event_group_id,trigger_key,change_hash) do update set
        decision = excluded.decision, reason_code = excluded.reason_code, snapshot_hash = excluded.snapshot_hash, analysis_run_id = excluded.analysis_run_id`).run(value.id, 1, value.eventGroupId, value.triggerKey, value.changeHash, value.decision, value.reasonCode, value.snapshotHash, value.analysisRunId, value.createdAt)
    },
    listTriggerLedger(eventGroupId: string) {
      return (sqlite.database.prepare('select id,event_group_id,trigger_key,change_hash,decision,reason_code,snapshot_hash,analysis_run_id,created_at from mi_analysis_trigger_ledger where event_group_id=? order by created_at asc,id asc').all(eventGroupId) as Row[]).map(row => ({ id: String(row.id), eventGroupId: String(row.event_group_id), triggerKey: String(row.trigger_key), changeHash: String(row.change_hash), decision: String(row.decision), reasonCode: String(row.reason_code), snapshotHash: row.snapshot_hash as string | null, analysisRunId: row.analysis_run_id as string | null, createdAt: String(row.created_at) }))
    },
    inspectStorage() { return { rowCount: Number((sqlite.database.prepare('select count(*) as count from mi_analysis_event_groups').get() as Row).count), databaseBytes: sqlite.filePath === ':memory:' ? 0 : statSync(sqlite.filePath).size } },
    /**
     * Drop the conclusions that have outlived their window, and the graph hanging off each of them.
     *
     * Rows leave in dependency order — verifications, then the predictions they verified, then the
     * timeline entries that point at a conclusion, then the conclusion itself, then the run and snapshot
     * it was built from, then the ledger lines and the event group once nothing is left under it — because
     * every one of those edges is a foreign key the database enforces rather than a convention. The guard
     * is the policy's own: a conclusion with a prediction **not yet due** for verification is skipped, so
     * a verdict the product still intends to reach cannot lose the evidence it needs. One transaction,
     * one batch of conclusions per pass, and a second pass finds nothing left to do.
     */
    retention(cutoffIso: string): Readonly<{ deleted: number; oldestKeptAtMs: number | null }> {
      const database = sqlite.database
      const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(',')
      let deleted = 0
      database.exec('begin')
      try {
        for (;;) {
          const eligible = database.prepare(`select id, analysis_run_id from mi_analysis_summaries
            where created_at < ?
              and not exists (select 1 from mi_analysis_predictions p
                where p.summary_id = mi_analysis_summaries.id and p.verification_due_at > ?)
            order by created_at limit ${analysisConclusionRetentionPolicy.batchSize}`).all(cutoffIso, cutoffIso) as Row[]
          if (eligible.length === 0) break
          const ids = eligible.map(row => String(row.id))
          const list = placeholders(ids.length)
          const runIds = [...new Set(eligible.map(row => row.analysis_run_id).filter((id): id is string => typeof id === 'string'))]
          database.prepare(`delete from mi_analysis_prediction_verifications where prediction_id in (
            select id from mi_analysis_predictions where summary_id in (${list}))`).run(...ids)
          database.prepare(`delete from mi_analysis_predictions where summary_id in (${list})`).run(...ids)
          database.prepare(`delete from mi_analysis_timeline where summary_ref in (${list})`).run(...ids)
          database.prepare(`delete from mi_analysis_summaries where id in (${list})`).run(...ids)
          if (runIds.length > 0) {
            const runList = placeholders(runIds.length)
            // A run another conclusion still cites stays: this deletes the run, not the history of it.
            database.prepare(`delete from mi_analysis_runs where id in (${runList})
              and id not in (select analysis_run_id from mi_analysis_timeline where analysis_run_id is not null)`).run(...runIds)
            database.prepare('delete from mi_analysis_snapshots where id not in (select snapshot_id from mi_analysis_runs)').run()
          }
          // Ledger lines first, then the group — and the group only once nothing references it at all.
          // A group with no conclusions left can still be named by a snapshot, by a surviving conclusion's
          // timeline entry, or by a later group's `superseded_by_group_id`, and deleting it then is a
          // foreign key violation: the over-eager predicate here failed exactly that way when the pass was
          // replayed against a copy of the real database with a three-day window.
          database.prepare(`delete from mi_analysis_trigger_ledger where event_group_id in (
            select id from mi_analysis_event_groups g
            where not exists (select 1 from mi_analysis_summaries s where s.event_group_id = g.id))`).run()
          database.prepare(`delete from mi_analysis_event_groups
            where not exists (select 1 from mi_analysis_summaries s where s.event_group_id = mi_analysis_event_groups.id)
              and not exists (select 1 from mi_analysis_snapshots n where n.event_group_id = mi_analysis_event_groups.id)
              and not exists (select 1 from mi_analysis_timeline t where t.event_group_id = mi_analysis_event_groups.id)
              and not exists (select 1 from mi_analysis_trigger_ledger l where l.event_group_id = mi_analysis_event_groups.id)
              and not exists (select 1 from mi_analysis_event_groups o where o.superseded_by_group_id = mi_analysis_event_groups.id)`).run()
          deleted += ids.length
          if (ids.length < analysisConclusionRetentionPolicy.batchSize) break
        }
        database.exec('commit')
      } catch (error) { database.exec('rollback'); throw error }
      const oldest = database.prepare('select min(created_at) as created_at from mi_analysis_summaries').get() as Row | undefined
      return Object.freeze({ deleted, oldestKeptAtMs: oldest?.created_at == null ? null : Date.parse(String(oldest.created_at)) })
    },
    /** The retention pass's ledger, in this file's own meta table: additive, so no migration is needed. */
    note(key: string, value: string) {
      const db = sqlite.database
      db.exec('create table if not exists mi_analysis_meta(key text primary key, value text not null)')
      db.prepare('insert into mi_analysis_meta(key,value) values(?,?) on conflict(key) do update set value=excluded.value').run(key, value)
    },
    readNote(key: string): string | undefined {
      const db = sqlite.database
      db.exec('create table if not exists mi_analysis_meta(key text primary key, value text not null)')
      const row = db.prepare('select value from mi_analysis_meta where key=?').get(key) as Row | undefined
      return row?.value === undefined ? undefined : String(row.value)
    },
    close() { if (owned) sqlite.close() }
  }
}

function migrate(database: MarketAnalysisSqlite['database']): void {
  // A schema migration must be self-contained: it owns its own bounded wait so
  // two connections opening the same file cannot fail on each other, and any
  // failure rolls the transaction back. Leaving it open would lock the whole
  // database and every later read would fail as "table is locked".
  database.exec(`pragma busy_timeout = ${marketAnalysisSqlitePolicy.busyTimeoutMs}`)
  database.exec('begin')
  try {
    database.exec(`create table if not exists mi_analysis_migrations (version integer primary key); create table if not exists mi_analysis_event_groups (id text primary key, schema_version integer not null, status text not null, group_type text not null, merge_key text not null, first_observed_at text not null, last_observed_at text not null, review_deadline_at text not null, event_refs_json text not null, trigger_count integer not null, review_count integer not null, current_summary_id text, superseded_by_group_id text, revision integer not null, created_at text not null, updated_at text not null, unique(merge_key,status)); create table if not exists mi_analysis_snapshots (id text primary key, schema_version integer not null, event_group_id text not null references mi_analysis_event_groups(id), as_of text not null, data_cutoff text not null, snapshot_hash text not null, profile_id text not null, facts_json text not null, missing_domains_json text not null, caveats_json text not null, evidence_refs_json text not null, source_health_json text not null, created_at text not null, policy_version text not null, archive_ref text, archive_hash text, archive_bytes integer, archive_schema_version integer, archive_status text); create table if not exists mi_analysis_runs (id text primary key, schema_version integer not null, event_group_id text not null references mi_analysis_event_groups(id), snapshot_id text not null references mi_analysis_snapshots(id), snapshot_hash text not null, analysis_phase text not null, trigger_key text not null, idempotency_key text not null unique, status text not null, attempt integer not null, retry_of_run_id text, model_provider_id text, model_id text, policy_version text not null, prompt_version text not null, skill_version text not null, output_schema_version integer not null, job_run_id text, trace_id text, failure_code text, failure_detail_code text, queued_at text not null, started_at text, completed_at text); create table if not exists mi_analysis_summaries (id text primary key, schema_version integer not null, analysis_run_id text not null unique references mi_analysis_runs(id), event_group_id text not null references mi_analysis_event_groups(id), version integer not null, payload_json text not null, evidence_refs_json text not null, created_at text not null, archive_ref text, archive_hash text, archive_bytes integer, archive_schema_version integer, archive_status text, unique(event_group_id,version)); create table if not exists mi_analysis_predictions (id text primary key, schema_version integer not null, summary_id text not null references mi_analysis_summaries(id), asset text not null, horizon_start text not null, horizon_end text not null, payload_json text not null, status text not null, verification_due_at text not null, created_at text not null, check(horizon_end > horizon_start)); create table if not exists mi_analysis_prediction_verifications (id text primary key, prediction_id text not null references mi_analysis_predictions(id), status text not null, evaluated_at text not null, rule_version text not null, evidence_refs_json text not null, reason_code text not null, reason text not null, schema_version integer not null); create table if not exists mi_analysis_timeline (id text primary key, schema_version integer not null, event_group_id text not null references mi_analysis_event_groups(id), analysis_run_id text references mi_analysis_runs(id), kind text not null, status text not null, occurred_at text not null, summary_ref text references mi_analysis_summaries(id), safe_title text not null, safe_excerpt text, direction text, version integer not null); create table if not exists mi_analysis_trigger_ledger (id text primary key, schema_version integer not null, event_group_id text not null references mi_analysis_event_groups(id), trigger_key text not null, change_hash text not null, decision text not null, reason_code text not null, snapshot_hash text, analysis_run_id text references mi_analysis_runs(id), created_at text not null, unique(event_group_id,trigger_key,change_hash)); create index if not exists idx_mi_analysis_snapshot_hash on mi_analysis_snapshots(snapshot_hash); create index if not exists idx_mi_analysis_snapshot_group_asof on mi_analysis_snapshots(event_group_id,as_of desc); create index if not exists idx_mi_analysis_run_group_queued on mi_analysis_runs(event_group_id,queued_at desc); create index if not exists idx_mi_analysis_run_status_queued on mi_analysis_runs(status,queued_at); create index if not exists idx_mi_analysis_summary_group_version on mi_analysis_summaries(event_group_id,version); create index if not exists idx_mi_analysis_prediction_due on mi_analysis_predictions(status,verification_due_at); create index if not exists idx_mi_analysis_verification_prediction on mi_analysis_prediction_verifications(prediction_id,evaluated_at desc); create index if not exists idx_mi_analysis_timeline_group_occurred on mi_analysis_timeline(event_group_id,occurred_at desc,id desc); create index if not exists idx_mi_analysis_event_updated on mi_analysis_event_groups(updated_at desc); create index if not exists idx_mi_analysis_trigger_group_key_hash on mi_analysis_trigger_ledger(event_group_id,trigger_key,change_hash); insert or ignore into mi_analysis_migrations(version) values (${MARKET_ANALYSIS_SCHEMA_VERSION});`)
    // Additive migration for databases created before the timeline carried a direction: the
    // column is what lets a language-neutral row render its own chip without parsing prose.
    const timelineColumns = (database.prepare('pragma table_info(mi_analysis_timeline)').all() as Row[]).map(row => String(row.name))
    if (!timelineColumns.includes('direction')) database.exec('alter table mi_analysis_timeline add column direction text')
    database.exec('commit')
  } catch (error) {
    try { database.exec('rollback') } catch { /* preserve original failure */ }
    throw error
  }
}

function insertTimeline(database: MarketAnalysisSqlite['database'], value: TimelineEntry): void {
  database.prepare('insert into mi_analysis_timeline (id,schema_version,event_group_id,analysis_run_id,kind,status,occurred_at,summary_ref,safe_title,safe_excerpt,direction,version) values (?,?,?,?,?,?,?,?,?,?,?,?)').run(value.id, value.schemaVersion, value.eventGroupId, value.analysisRunId, value.kind, value.status, value.occurredAt, value.summaryRef, value.safeTitle, value.safeExcerpt, value.direction ?? null, value.version)
}
function exists(sqlite: MarketAnalysisSqlite, table: string, id: string): boolean { return Boolean(sqlite.database.prepare(`select 1 from ${table} where id=?`).get(id)) }
function json(value: unknown): string { return canonicalizeMarketAnalysisJson(value) }
function validateEventGroup(value: EventGroup): void { if (!value.id.startsWith('mi-eg-') || value.schemaVersion !== 1) throw new Error('analysis-event-group-invalid') }
function validateSnapshot(value: EvidenceSnapshot): void {
  if (!value.id.startsWith('mi-es-') || (value.schemaVersion !== 1 && value.schemaVersion !== 2) || value.snapshotHash !== buildAnalysisSnapshotHash(snapshotHashInput(value))) throw new Error('analysis-snapshot-invalid')
}
function validateRun(value: AnalysisRun): void { if (!value.id.startsWith('mi-ar-') || value.schemaVersion !== 1) throw new Error('analysis-run-invalid') }
function validateArchiveMetadata(value: MarketAnalysisArchiveMetadata | undefined): void {
  if (!value) return
  if (!ARCHIVE_REF_PATTERN.test(value.archiveRef) || !/^[a-f0-9]{64}$/.test(value.archiveHash) || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes <= 0 || !Number.isSafeInteger(value.archiveSchemaVersion) || value.archiveSchemaVersion < 1 || !Object.values(ARCHIVE_STATUS).includes(value.archiveStatus)) throw new Error('analysis-archive-metadata-invalid')
  if (value.archiveRef.slice(0, 64) !== value.archiveHash) throw new Error('analysis-archive-metadata-invalid')
}
function validateSummaryReferences(summary: AnalysisSummary, snapshot: EvidenceSnapshot): void {
  const facts = new Set(snapshot.facts.map(value => value.factId))
  const evidence = new Set(snapshot.evidenceRefs.map(value => value.evidenceRefId))
  const factRefs = [...summary.knownFacts.map(value => value.factId), ...summary.marketReaction.flatMap(value => value.factIds)]
  const evidenceRefs = [
    ...summary.knownFacts.flatMap(value => value.evidenceRefIds),
    ...summary.transmissionHypotheses.flatMap(value => value.evidenceRefIds),
    ...summary.marketReaction.flatMap(value => value.evidenceRefIds),
    ...summary.supportingEvidence.map(value => value.evidenceRefId),
    ...summary.counterEvidence.map(value => value.evidenceRefId),
    ...summary.nextCatalysts.flatMap(value => value.evidenceRefIds),
    ...(summary.directions ?? []).flatMap(value => value.evidenceRefIds),
    ...summary.evidenceRefs
  ]
  if (factRefs.some(value => !facts.has(value)) || evidenceRefs.some(value => !evidence.has(value))) throw new Error('analysis-missing-evidence')
}
function fromEventGroup(row: Row): EventGroup { return { id: String(row.id), schemaVersion: Number(row.schema_version) as 1, status: row.status as EventGroup['status'], groupType: row.group_type as EventGroup['groupType'], mergeKey: String(row.merge_key), firstObservedAt: String(row.first_observed_at), lastObservedAt: String(row.last_observed_at), reviewDeadlineAt: String(row.review_deadline_at), eventRefs: JSON.parse(String(row.event_refs_json)), triggerCount: Number(row.trigger_count), reviewCount: Number(row.review_count), currentSummaryId: row.current_summary_id as string | null, supersededByGroupId: row.superseded_by_group_id as string | null, revision: Number(row.revision), createdAt: String(row.created_at), updatedAt: String(row.updated_at) } }
function fromSnapshot(row: Row): EvidenceSnapshot { return { id: String(row.id), schemaVersion: Number(row.schema_version) as 1 | 2, eventGroupId: String(row.event_group_id), asOf: String(row.as_of), dataCutoff: String(row.data_cutoff), snapshotHash: String(row.snapshot_hash), profileId: 'crypto-market-analysis-v1', facts: JSON.parse(String(row.facts_json)), missingDomains: JSON.parse(String(row.missing_domains_json)), caveats: JSON.parse(String(row.caveats_json)), evidenceRefs: JSON.parse(String(row.evidence_refs_json)), sourceHealth: JSON.parse(String(row.source_health_json)), createdAt: String(row.created_at), policyVersion: 'cryptoMarketAnalysisTriggerPolicy.v1' } }
function fromRun(row: Row): AnalysisRun { return { id: String(row.id), schemaVersion: Number(row.schema_version) as 1, eventGroupId: String(row.event_group_id), snapshotId: String(row.snapshot_id), snapshotHash: String(row.snapshot_hash), analysisPhase: row.analysis_phase as AnalysisRun['analysisPhase'], triggerKey: String(row.trigger_key), idempotencyKey: String(row.idempotency_key), status: row.status as AnalysisRun['status'], attempt: Number(row.attempt), retryOfRunId: row.retry_of_run_id as string | null, modelProviderId: row.model_provider_id as string | null, modelId: row.model_id as string | null, policyVersion: String(row.policy_version), promptVersion: String(row.prompt_version), skillVersion: String(row.skill_version), outputSchemaVersion: Number(row.output_schema_version) as 1 | 2, jobRunId: row.job_run_id as string | null, traceId: row.trace_id as string | null, failureCode: row.failure_code as string | null, failureDetailCode: row.failure_detail_code as string | null, queuedAt: String(row.queued_at), startedAt: row.started_at as string | null, completedAt: row.completed_at as string | null } }
function fromTimeline(row: Row): TimelineEntry { return { id: String(row.id), schemaVersion: Number(row.schema_version) as 1, eventGroupId: String(row.event_group_id), analysisRunId: row.analysis_run_id as string | null, kind: row.kind as TimelineEntry['kind'], status: row.status as TimelineEntry['status'], occurredAt: String(row.occurred_at), summaryRef: row.summary_ref as string | null, safeTitle: String(row.safe_title), safeExcerpt: row.safe_excerpt as string | null, direction: (row.direction as TimelineEntry['direction']) ?? null, version: Number(row.version) } }
function stableMergeKey(value: string): string { const parts = value.split('|'); return parts.slice(0, -1).join('|') }
