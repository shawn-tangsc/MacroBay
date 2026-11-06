import type { DatabaseSync } from 'node:sqlite'

import { analysisConclusionRetentionPolicy } from '../retention/analysisConclusionRetention'
import { analysisTriggerLedgerRetentionPolicy } from '../retention/analysisTriggerLedgerRetention'
import { predictionLedgerRetentionPolicy } from '../retention/predictionLedgerRetention'

/**
 * The analysis database's daily pass, in one place.
 *
 * Four windows share one clock:
 *
 * - a conclusion is kept fourteen days, and its graph leaves with it in dependency order;
 * - a prediction verdict is kept a hundred and eighty days, on a clock of its own;
 * - a signal ledger row is kept fifteen days — one more than its conclusion, so the reader can still
 *   read why a run happened while the conclusion exists;
 * - a model call is kept by `marketAnalysisIoStore`, in its own store id, because its thirty days and
 *   its hundred-megabyte ceiling are a different promise and a failure there must not mark the
 *   conclusion store failed.
 *
 * Every edge below is a foreign key the database enforces, not a convention: rows leave child first,
 * and a group leaves only when nothing names it. The signal ledger segment is deliberately first and
 * in its own transaction — it must age on a night when no conclusion happens to expire, and its
 * refusal must not read as a failed conclusion store.
 */

export type MarketAnalysisRetentionInput = Readonly<{
  conclusionCutoffIso: string
  ledgerCutoffIso: string
  triggerLedgerCutoffIso: string
}>

export type MarketAnalysisRetentionResult = Readonly<{
  deleted: number
  ledgerDeleted: number
  /** Absent when the ledger segment could not run; the caller's ledger keeps that fact under its own key. */
  triggerLedgerDeleted?: number
  oldestKeptAtMs: number | null
}>

const TRIGGER_LEDGER_FAILURE_KEY = 'analysis.retention.triggerLedgerFailureCode'

export function retainMarketAnalysis(database: DatabaseSync, input: MarketAnalysisRetentionInput): MarketAnalysisRetentionResult {
  const { conclusionCutoffIso: cutoffIso, ledgerCutoffIso, triggerLedgerCutoffIso } = input
  const triggerLedgerDeleted = deleteTriggerLedgerByAge(database, triggerLedgerCutoffIso)
  if (triggerLedgerDeleted === undefined) writeAnalysisMetaNote(database, TRIGGER_LEDGER_FAILURE_KEY, 'retention-failed')
  else clearAnalysisMetaNote(database, TRIGGER_LEDGER_FAILURE_KEY)

  let deleted = 0
  let ledgerDeleted = 0
  database.exec('begin')
  try {
    for (;;) {
      const eligible = database.prepare(`select id, analysis_run_id from mi_analysis_summaries
        where created_at < ?
          and not exists (select 1 from mi_analysis_predictions p
            where p.summary_id = mi_analysis_summaries.id and p.verification_due_at > ?)
        order by created_at limit ${analysisConclusionRetentionPolicy.batchSize}`).all(cutoffIso, cutoffIso) as Array<{ id: string; analysis_run_id: string | null }>
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
        // A run a **signal ledger row still cites** stays too — that row has fifteen days, one more
        // than the conclusion, so at the moment a conclusion expires its run is still referenced.
        // Deleting it then was a foreign-key failure that turned every such night into a red pass;
        // the next pass, after the ledger row ages out, takes the run.
        database.prepare(`delete from mi_analysis_runs where id in (${runList})
          and id not in (select analysis_run_id from mi_analysis_timeline where analysis_run_id is not null)
          and id not in (select analysis_run_id from mi_analysis_trigger_ledger where analysis_run_id is not null)`).run(...runIds)
        database.prepare('delete from mi_analysis_snapshots where id not in (select snapshot_id from mi_analysis_runs)').run()
      }
      deleted += ids.length
      if (ids.length < analysisConclusionRetentionPolicy.batchSize) break
    }
    // Runs that no conclusion, timeline entry or ledger row names go once they are old enough. This
    // is the other half of the fifteen-day ledger window: a run cited by a still-readable ledger row
    // stays one more day, and the next pass takes it. It also collects a run that never produced a
    // conclusion at all, which the summary-driven loop above cannot see and which used to live forever.
    for (;;) {
      const runIds = (database.prepare(`select id from mi_analysis_runs
        where queued_at < ?
          and not exists (select 1 from mi_analysis_summaries s where s.analysis_run_id = mi_analysis_runs.id)
          and not exists (select 1 from mi_analysis_timeline t where t.analysis_run_id = mi_analysis_runs.id)
          and not exists (select 1 from mi_analysis_trigger_ledger l where l.analysis_run_id = mi_analysis_runs.id)
        order by queued_at asc limit ${analysisConclusionRetentionPolicy.batchSize}`).all(cutoffIso) as Array<{ id: string }>).map(row => String(row.id))
      if (runIds.length === 0) break
      database.prepare(`delete from mi_analysis_runs where id in (${placeholders(runIds.length)})`).run(...runIds)
      if (runIds.length < analysisConclusionRetentionPolicy.batchSize) break
    }
    database.prepare('delete from mi_analysis_snapshots where id not in (select snapshot_id from mi_analysis_runs)').run()
    // The verdicts go on their own clock, in their own batches, inside the same transaction: a row whose
    // prediction was just deleted is exactly the row this pass is asked to keep.
    for (;;) {
      const changes = Number(database.prepare(`delete from mi_analysis_prediction_ledger where prediction_id in (
        select prediction_id from mi_analysis_prediction_ledger where evaluated_at < ?
        order by evaluated_at limit ${predictionLedgerRetentionPolicy.batchSize})`).run(ledgerCutoffIso).changes)
      ledgerDeleted += changes
      if (changes < predictionLedgerRetentionPolicy.batchSize) break
    }
    // The group sweep is its own segment, after the conclusions: a group with no conclusions is
    // collected only once nothing else names it — a snapshot, a surviving timeline entry, a ledger
    // row still inside its window, or a later group's `superseded_by_group_id`. Deleting any of those
    // is a foreign-key violation; the ledger's own window is what now makes the collection
    // deterministic (fifteen days) instead of "whenever someone else's conclusion expired".
    for (;;) {
      const ids = (database.prepare(`select id from mi_analysis_event_groups
        where not exists (select 1 from mi_analysis_summaries s where s.event_group_id = mi_analysis_event_groups.id)
          and not exists (select 1 from mi_analysis_snapshots n where n.event_group_id = mi_analysis_event_groups.id)
          and not exists (select 1 from mi_analysis_timeline t where t.event_group_id = mi_analysis_event_groups.id)
          and not exists (select 1 from mi_analysis_trigger_ledger l where l.event_group_id = mi_analysis_event_groups.id)
          and not exists (select 1 from mi_analysis_event_groups o where o.superseded_by_group_id = mi_analysis_event_groups.id)
        limit ${analysisConclusionRetentionPolicy.batchSize}`).all() as Array<{ id: string }>).map(row => String(row.id))
      if (ids.length === 0) break
      database.prepare(`delete from mi_analysis_event_groups where id in (${placeholders(ids.length)})`).run(...ids)
      if (ids.length < analysisConclusionRetentionPolicy.batchSize) break
    }
    database.exec('commit')
  } catch (error) {
    database.exec('rollback')
    throw error
  }
  const oldest = database.prepare('select min(created_at) as created_at from mi_analysis_summaries').get() as { created_at: string | null } | undefined
  return Object.freeze({
    deleted,
    ledgerDeleted,
    ...(triggerLedgerDeleted === undefined ? {} : { triggerLedgerDeleted }),
    oldestKeptAtMs: oldest?.created_at == null ? null : Date.parse(String(oldest.created_at))
  })
}

/**
 * Delete ledger rows older than their own window, in batches, in a transaction of their own.
 *
 * Returns `undefined` when the sweep could not run. The caller records that under its own key and
 * lets the conclusion pass continue: the two windows are independent facts, and a ledger sweep
 * failing must not be reported as a failed conclusion store.
 */
function deleteTriggerLedgerByAge(database: DatabaseSync, cutoffIso: string): number | undefined {
  const batchSize = analysisTriggerLedgerRetentionPolicy.batchSize
  let deleted = 0
  try {
    database.exec('begin immediate')
    for (;;) {
      const ids = (database.prepare(`select id from mi_analysis_trigger_ledger where created_at < ? order by created_at asc, id asc limit ${batchSize}`)
        .all(cutoffIso) as Array<{ id: string }>).map(row => String(row.id))
      if (ids.length === 0) break
      database.prepare(`delete from mi_analysis_trigger_ledger where id in (${placeholders(ids.length)})`).run(...ids)
      deleted += ids.length
      if (ids.length < batchSize) break
    }
    database.exec('commit')
    return deleted
  } catch {
    try { database.exec('rollback') } catch { /* preserve the original failure */ }
    return undefined
  }
}

/** The retention pass's ledger, in the analysis database's own meta table. */
export function writeAnalysisMetaNote(database: DatabaseSync, key: string, value: string): void {
  database.exec('create table if not exists mi_analysis_meta(key text primary key, value text not null)')
  database.prepare('insert into mi_analysis_meta(key,value) values(?,?) on conflict(key) do update set value=excluded.value').run(key, value)
}

function clearAnalysisMetaNote(database: DatabaseSync, key: string): void {
  database.exec('create table if not exists mi_analysis_meta(key text primary key, value text not null)')
  database.prepare('delete from mi_analysis_meta where key=?').run(key)
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(',')
}
