import type { DatabaseSync } from 'node:sqlite'

import { ensureRunColumns } from './marketAnalysisColumns'
import { migrateAnalysisIo } from './marketAnalysisIoStore'

/**
 * 分析库的建表与增量迁移（R43/A 笔的 `analysis_kind` 也在这里）。
 *
 * 从 `marketAnalysisRepository` 抽出来的原因只有体积：那个文件已经越过 500 行硬线，而这是一段
 * 自包含的 DDL + 幂等 ALTER，没有仓储状态、没有游标，单独读得懂也单独测得动。
 * **行为逐字不变**：同一个事务、同一个建表语句、同一个 `pragma table_info` 守卫与回填。
 */
type Row = Record<string, unknown>

export function migrateAnalysisSchema(database: DatabaseSync, schemaVersion: number): void {
  // A schema migration must be self-contained: the connection already carries the
  // shared bounded wait from `openSqliteDatabase`, so a second opener cannot fail
  // this transaction on a lock, and any failure rolls it back.
  database.exec('begin')
  try {
    database.exec(`create table if not exists mi_analysis_migrations (version integer primary key); create table if not exists mi_analysis_event_groups (id text primary key, schema_version integer not null, status text not null, group_type text not null, merge_key text not null, first_observed_at text not null, last_observed_at text not null, review_deadline_at text not null, event_refs_json text not null, trigger_count integer not null, review_count integer not null, current_summary_id text, superseded_by_group_id text, revision integer not null, created_at text not null, updated_at text not null, unique(merge_key,status)); create table if not exists mi_analysis_snapshots (id text primary key, schema_version integer not null, event_group_id text not null references mi_analysis_event_groups(id), as_of text not null, data_cutoff text not null, snapshot_hash text not null, profile_id text not null, facts_json text not null, missing_domains_json text not null, caveats_json text not null, evidence_refs_json text not null, source_health_json text not null, trigger_json text, created_at text not null, policy_version text not null, archive_ref text, archive_hash text, archive_bytes integer, archive_schema_version integer, archive_status text); create table if not exists mi_analysis_runs (id text primary key, schema_version integer not null, analysis_kind text, event_group_id text not null references mi_analysis_event_groups(id), snapshot_id text not null references mi_analysis_snapshots(id), snapshot_hash text not null, analysis_phase text not null, trigger_key text not null, idempotency_key text not null unique, status text not null, attempt integer not null, retry_of_run_id text, model_provider_id text, model_id text, policy_version text not null, prompt_version text not null, skill_version text not null, output_schema_version integer not null, job_run_id text, trace_id text, failure_code text, failure_detail_code text, validation_mode text, notification_episode_run_id text, retry_used_at text, retry_result text, queued_at text not null, started_at text, completed_at text); create table if not exists mi_analysis_summaries (id text primary key, schema_version integer not null, analysis_kind text, analysis_run_id text not null unique references mi_analysis_runs(id), event_group_id text not null references mi_analysis_event_groups(id), version integer not null, payload_json text not null, evidence_refs_json text not null, created_at text not null, archive_ref text, archive_hash text, archive_bytes integer, archive_schema_version integer, archive_status text, unique(event_group_id,version)); create table if not exists mi_analysis_predictions (id text primary key, schema_version integer not null, summary_id text not null references mi_analysis_summaries(id), asset text not null, horizon_start text not null, horizon_end text not null, payload_json text not null, status text not null, verification_due_at text not null, created_at text not null, check(horizon_end > horizon_start)); create table if not exists mi_analysis_prediction_verifications (id text primary key, prediction_id text not null references mi_analysis_predictions(id), status text not null, evaluated_at text not null, rule_version text not null, evidence_refs_json text not null, reason_code text not null, reason text not null, schema_version integer not null); create table if not exists mi_analysis_prediction_ledger (prediction_id text primary key, schema_version integer not null, asset text not null, horizon_start text not null, horizon_end text not null, predicate text, condition_count integer not null, status text not null, reason_code text not null, rule_version text not null, evidence_refs_json text not null, evidence_ref_count integer not null, prediction_created_at text not null, evaluated_at text not null, check(horizon_end > horizon_start)); create table if not exists mi_analysis_timeline (id text primary key, schema_version integer not null, event_group_id text not null references mi_analysis_event_groups(id), analysis_run_id text references mi_analysis_runs(id), kind text not null, status text not null, occurred_at text not null, summary_ref text references mi_analysis_summaries(id), safe_title text not null, safe_excerpt text, direction text, version integer not null); create table if not exists mi_analysis_trigger_ledger (id text primary key, schema_version integer not null, event_group_id text not null references mi_analysis_event_groups(id), trigger_key text not null, change_hash text not null, decision text not null, reason_code text not null, snapshot_hash text, analysis_run_id text references mi_analysis_runs(id), created_at text not null, evidence_json text, unique(event_group_id,trigger_key,change_hash)); create index if not exists idx_mi_analysis_snapshot_hash on mi_analysis_snapshots(snapshot_hash); create index if not exists idx_mi_analysis_snapshot_group_asof on mi_analysis_snapshots(event_group_id,as_of desc); create index if not exists idx_mi_analysis_run_group_queued on mi_analysis_runs(event_group_id,queued_at desc); create index if not exists idx_mi_analysis_run_status_queued on mi_analysis_runs(status,queued_at); create index if not exists idx_mi_analysis_summary_group_version on mi_analysis_summaries(event_group_id,version); create index if not exists idx_mi_analysis_prediction_due on mi_analysis_predictions(status,verification_due_at); create index if not exists idx_mi_analysis_verification_prediction on mi_analysis_prediction_verifications(prediction_id,evaluated_at desc); create index if not exists idx_mi_analysis_ledger_evaluated on mi_analysis_prediction_ledger(evaluated_at); create index if not exists idx_mi_analysis_timeline_group_occurred on mi_analysis_timeline(event_group_id,occurred_at desc,id desc); create index if not exists idx_mi_analysis_event_updated on mi_analysis_event_groups(updated_at desc); create index if not exists idx_mi_analysis_trigger_group_key_hash on mi_analysis_trigger_ledger(event_group_id,trigger_key,change_hash); create index if not exists idx_mi_analysis_trigger_change_hash on mi_analysis_trigger_ledger(change_hash); create table if not exists mi_analysis_calendar_read_streak(utc_day text not null, side text not null check(side in ('official','provider')), count integer not null, updated_at text not null, primary key(utc_day, side)); insert or ignore into mi_analysis_migrations(version) values (${schemaVersion});`)
    // R39：两表各加一列 `analysis_kind`（可空、只追加）。新装从上面的建表语句拿；旧库在这里补。
    // 回填是主路径，只碰这一列——payload、status、时间列一律不动。读侧 `null → market` 只兜
    // 没有回填机会的行（旧归档还原、回退后旧版写入），见 `fromRun` 与 `analysisRecordReader`。
    // 索引放在 ALTER 之后：旧库在建表语句里还没有这一列，先建索引会直接报错。
    const runKindColumns = (database.prepare('pragma table_info(mi_analysis_runs)').all() as Row[]).map(row => String(row.name))
    if (!runKindColumns.includes('analysis_kind')) database.exec('alter table mi_analysis_runs add column analysis_kind text')
    const summaryKindColumns = (database.prepare('pragma table_info(mi_analysis_summaries)').all() as Row[]).map(row => String(row.name))
    if (!summaryKindColumns.includes('analysis_kind')) database.exec('alter table mi_analysis_summaries add column analysis_kind text')
    database.exec("update mi_analysis_runs set analysis_kind='market' where analysis_kind is null")
    database.exec("update mi_analysis_summaries set analysis_kind='market' where analysis_kind is null")
    database.exec('create index if not exists idx_mi_analysis_run_kind_queued on mi_analysis_runs(analysis_kind, queued_at desc)')
    database.exec('create index if not exists idx_mi_analysis_summary_kind_group on mi_analysis_summaries(analysis_kind, event_group_id)')
    // Additive migration for databases created before the timeline carried a direction: the
    // column is what lets a language-neutral row render its own chip without parsing prose.
    const timelineColumns = (database.prepare('pragma table_info(mi_analysis_timeline)').all() as Row[]).map(row => String(row.name))
    if (!timelineColumns.includes('direction')) database.exec('alter table mi_analysis_timeline add column direction text')
    // Same additive path for the trigger ledger's reading column: a new install gets it from the
    // create statement above, an existing database gets it here, and both end up identical.
    const ledgerColumns = (database.prepare('pragma table_info(mi_analysis_trigger_ledger)').all() as Row[]).map(row => String(row.name))
    if (!ledgerColumns.includes('evidence_json')) database.exec('alter table mi_analysis_trigger_ledger add column evidence_json text')
    // 触发指针列（R37）：新装从建表语句拿，旧库在这里补；可空、不回填，缺列＝「没有触发记录」。
    // 不加库版本号——它是「加了一个可空列」，给列登记编一个版本号没有意义（另两处同类列也没 bump）。
    const snapshotColumns = (database.prepare('pragma table_info(mi_analysis_snapshots)').all() as Row[]).map(row => String(row.name))
    if (!snapshotColumns.includes('trigger_json')) database.exec('alter table mi_analysis_snapshots add column trigger_json text')
    // Columns added after the first release; extras are nullable and never backfilled.
    ensureRunColumns(database)
    // A new table, not a new column: the model's prompt and answer are one row per call, so they
    // cannot ride on the snapshot's six archive columns (a repair or a retry would overwrite the
    // first answer — the one a post-mortem needs). Purely additive, so old databases keep every row.
    migrateAnalysisIo(database)
    database.exec('commit')
  } catch (error) {
    try { database.exec('rollback') } catch { /* preserve original failure */ }
    throw error
  }
}