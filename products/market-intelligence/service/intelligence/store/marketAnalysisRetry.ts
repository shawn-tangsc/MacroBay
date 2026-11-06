import type { DatabaseSync } from 'node:sqlite'

import type { AnalysisRetryResult } from '../../../contracts/marketAnalysisContracts'

/**
 * The one transport retry a run may take, read from the run rows themselves.
 *
 * Two columns, not a counter: `retry_used_at` is claimed **before** the second call, so a crash in
 * between still spends the day's chance (fail-closed — better one retry too few than ten a day), and
 * `retry_result` is filled when it ends. A week's success rate then comes from the same pair, with no
 * second tally to drift from the rows the run log shows.
 *
 * The day boundary is UTC and is decided here, once: the orchestrator asks `usedOn` and does not
 * compare dates itself. A second date comparison would be a second judgement, and the two would
 * eventually disagree about which day a claim belongs to.
 */
export type AnalysisRetryUsage = Readonly<{
  attempts: number
  succeeded: number
  failed: number
  /** Claimed, then cancelled: still spent. A missing result would make the day look free. */
  cancelled: number
  /** Claimed but not resolved yet: counted as attempts, not as outcomes. */
  unfinished: number
  byTrigger: readonly Readonly<{ triggerKey: string; attempts: number; succeeded: number }>[]
  /**
   * Runs where the same release used a retry twice (two trigger keys, each with its own chance).
   * One is the documented §4.1 shape; more than one would be the signal to switch the reduction to
   * `event_group_id`.
   */
  groupsWithMoreThanOneRetry: number
}>

export type AnalysisRetryStore = Readonly<{
  /**
   * The instant this trigger key last claimed a retry on the UTC day containing `nowIso`, or null.
   *
   * Null means "this key still has its chance today" — not "no retry ever happened". The caller must
   * not compare dates again.
   */
  usedOn: (triggerKey: string, nowIso: string) => string | null
  /** Claim the run's one retry. True only when this call changed the row (`retry_used_at` was null). */
  claim: (runId: string, nowIso: string) => boolean
  /** Record how a claimed retry ended. False when the run never claimed one. */
  record: (runId: string, result: AnalysisRetryResult) => boolean
  /** Attempts and outcomes since `sinceIso`, for the one-week judgement. */
  usage: (sinceIso: string) => AnalysisRetryUsage
}>

const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export function createAnalysisRetryStore(database: DatabaseSync): AnalysisRetryStore {
  return Object.freeze({
    usedOn(triggerKey, nowIso) {
      assertText(triggerKey, 'analysis-retry-trigger-invalid')
      const [dayStart, nextDay] = utcDayBounds(nowIso)
      const row = database.prepare(`select retry_used_at from mi_analysis_runs
        where trigger_key = ? and retry_used_at is not null and retry_used_at >= ? and retry_used_at < ?
        order by retry_used_at desc limit 1`).get(triggerKey, dayStart, nextDay) as { retry_used_at: string } | undefined
      return row?.retry_used_at == null ? null : String(row.retry_used_at)
    },
    claim(runId, nowIso) {
      assertText(runId, 'analysis-retry-run-invalid')
      assertUtcIso(nowIso, 'analysis-retry-time-invalid')
      return Number(database.prepare('update mi_analysis_runs set retry_used_at = ? where id = ? and retry_used_at is null').run(nowIso, runId).changes) === 1
    },
    record(runId, result) {
      assertText(runId, 'analysis-retry-run-invalid')
      if (result !== 'succeeded' && result !== 'failed' && result !== 'cancelled') throw new Error('analysis-retry-result-invalid')
      return Number(database.prepare('update mi_analysis_runs set retry_result = ? where id = ? and retry_used_at is not null').run(result, runId).changes) === 1
    },
    usage(sinceIso) {
      assertUtcIso(sinceIso, 'analysis-retry-window-invalid')
      const totals = database.prepare(`select count(*) as attempts,
        coalesce(sum(case when retry_result = 'succeeded' then 1 else 0 end), 0) as succeeded,
        coalesce(sum(case when retry_result = 'failed' then 1 else 0 end), 0) as failed,
        coalesce(sum(case when retry_result = 'cancelled' then 1 else 0 end), 0) as cancelled
        from mi_analysis_runs where retry_used_at is not null and retry_used_at >= ?`).get(sinceIso) as { attempts: number; succeeded: number; failed: number; cancelled: number } | undefined
      const byTrigger = (database.prepare(`select trigger_key as triggerKey, count(*) as attempts,
        coalesce(sum(case when retry_result = 'succeeded' then 1 else 0 end), 0) as succeeded
        from mi_analysis_runs where retry_used_at is not null and retry_used_at >= ?
        group by trigger_key order by attempts desc, trigger_key asc`).all(sinceIso) as Array<{ triggerKey: string; attempts: number; succeeded: number }>)
        .map(row => Object.freeze({ triggerKey: String(row.triggerKey), attempts: Number(row.attempts), succeeded: Number(row.succeeded) }))
      const groupRow = database.prepare(`select count(*) as count from (
        select event_group_id from mi_analysis_runs where retry_used_at is not null and retry_used_at >= ?
        group by event_group_id having count(*) > 1)`).get(sinceIso) as { count: number } | undefined
      const attempts = Number(totals?.attempts ?? 0)
      const succeeded = Number(totals?.succeeded ?? 0)
      const failed = Number(totals?.failed ?? 0)
      const cancelled = Number(totals?.cancelled ?? 0)
      return Object.freeze({
        attempts,
        succeeded,
        failed,
        cancelled,
        unfinished: attempts - succeeded - failed - cancelled,
        byTrigger: Object.freeze(byTrigger),
        groupsWithMoreThanOneRetry: Number(groupRow?.count ?? 0)
      })
    }
  })
}

/**
 * The UTC day's bounds containing `atIso`, from a parsed instant — never from the first ten
 * characters of the string. A time with an offset (`2026-11-06T20:00:00+08:00`) is refused rather
 * than quietly read as another day, which would let the same key retry twice.
 */
export function utcDayBounds(atIso: string): readonly [string, string] {
  const instant = parseUtcIso(atIso)
  instant.setUTCHours(0, 0, 0, 0)
  const start = instant.toISOString()
  return Object.freeze([start, new Date(Date.parse(start) + 24 * 3_600_000).toISOString()])
}

function parseUtcIso(value: string): Date {
  assertUtcIso(value, 'analysis-retry-time-invalid')
  const instant = new Date(value)
  // Date.parse rolls an impossible date into the next month; requiring round-trip equality keeps
  // "2026-02-31T00:00:00.000Z" from being accepted as a real instant.
  if (instant.toISOString() !== value) throw new Error('analysis-retry-time-invalid')
  return instant
}

function assertText(value: string, code: string): void {
  if (typeof value !== 'string' || value.length === 0) throw new Error(code)
}

function assertUtcIso(value: string, code: string): void {
  if (typeof value !== 'string' || !UTC_ISO_PATTERN.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(code)
}
