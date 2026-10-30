import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

import type { JobLogEntry, JobProgress, JobRunPage, JobRunQuery, JobRunRecord, JobStatus } from '../contracts/jobTypes'

// Platform-owned read budget: retain default/zero semantics; oversized pages use cursors.
export const JOB_RUN_PAGE_POLICY = { defaultLimit: 20, maximumLimit: 1000 } as const
const JOB_RUN_SEQUENCE_POLICY = { rowId: 1, firstId: 1, prefix: 'run-sqlite-' } as const

type JobRunRow = {
  id: string
  definition_id: string
  handler_id: string
  owner: JobRunRecord['owner']
  product_id: string | null
  title: string
  status: JobStatus
  trigger_json: string
  payload_json: string
  concurrency_key: string | null
  attempt: number
  max_attempts: number
  created_at: string
  started_at: string | null
  completed_at: string | null
  last_error: string | null
  progress_json: string | null
  logs_json: string
}

/** One day of history for one definition, kept after the run details are dropped. */
export type JobRunDailyAggregate = Readonly<{
  day: string
  definitionId: string
  runs: number
  failures: number
}>

export type JobRunRetentionSweep = Readonly<{
  /** Number of run details removed by this sweep. */
  deletedRuns: number
  /** True when the batch limit was reached and more work remains. */
  hasMore: boolean
}>

export type JobRunSqliteRepository = {
  upsertRun: (run: JobRunRecord) => void
  getRun: (runId: string) => JobRunRecord | null
  listRunPage: (query?: JobRunQuery) => JobRunPage
  allocateRunId: () => string
  /** Aggregates runs older than `cutoff` into daily counters, then removes them. */
  purgeRunsOlderThan: (cutoff: string, batchLimit: number) => JobRunRetentionSweep
  listRunAggregates: () => readonly JobRunDailyAggregate[]
  close: () => void
}

export function createJobRunSqliteRepository(path: string): JobRunSqliteRepository {
  const db = new DatabaseSync(path)
  db.exec('pragma foreign_keys = on;')
  db.exec('pragma journal_mode = wal;')
  db.exec('pragma synchronous = full;')
  applySchema(db)

  return {
    upsertRun(run) {
      db.prepare(
        `insert into job_runs (
          id, definition_id, handler_id, owner, product_id, title, status, trigger_json, payload_json,
          concurrency_key, attempt, max_attempts, created_at, started_at, completed_at, last_error, progress_json,
          logs_json
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(id) do update set
          definition_id = excluded.definition_id,
          handler_id = excluded.handler_id,
          owner = excluded.owner,
          product_id = excluded.product_id,
          title = excluded.title,
          status = excluded.status,
          trigger_json = excluded.trigger_json,
          payload_json = excluded.payload_json,
          concurrency_key = excluded.concurrency_key,
          attempt = excluded.attempt,
          max_attempts = excluded.max_attempts,
          created_at = excluded.created_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          last_error = excluded.last_error,
          progress_json = excluded.progress_json,
          logs_json = excluded.logs_json`
      ).run(
        run.id,
        run.definitionId,
        run.handlerId,
        run.owner,
        run.productId ?? null,
        run.title,
        run.status,
        stringifyJson(run.trigger),
        stringifyJson(run.payload),
        run.concurrencyKey ?? null,
        run.attempt,
        run.maxAttempts,
        run.createdAt,
        run.startedAt ?? null,
        run.completedAt ?? null,
        run.lastError ?? null,
        run.progress ? stringifyJson(run.progress) : null,
        stringifyJson(run.logs)
      )
    },
    getRun(runId) {
      const row = db
        .prepare(
          `select
             id, definition_id, handler_id, owner, product_id, title, status, trigger_json, payload_json,
             concurrency_key, attempt, max_attempts, created_at, started_at, completed_at, last_error,
             progress_json, logs_json
           from job_runs
           where id = ?`
        )
        .get(runId) as JobRunRow | undefined
      return row ? mapJobRun(row) : null
    },
    purgeRunsOlderThan(cutoff, batchLimit) {
      // Aggregate and delete in one transaction: the counters and the rows they
      // describe can never disagree, and a crash rolls the whole batch back.
      db.exec('begin immediate')
      try {
        const candidates = db.prepare(
          'select id, definition_id, status, created_at from job_runs where created_at < ? order by created_at asc, id asc limit ?'
        ).all(cutoff, batchLimit) as { id: string; definition_id: string; status: string; created_at: string }[]
        if (candidates.length === 0) {
          db.exec('commit')
          return { deletedRuns: 0, hasMore: false }
        }
        const grouped = new Map<string, { day: string; definitionId: string; runs: number; failures: number }>()
        for (const row of candidates) {
          const day = String(row.created_at).slice(0, 10)
          const key = `${day}\u0000${row.definition_id}`
          const bucket = grouped.get(key) ?? { day, definitionId: row.definition_id, runs: 0, failures: 0 }
          bucket.runs += 1
          if (row.status === 'failed') bucket.failures += 1
          grouped.set(key, bucket)
        }
        const upsert = db.prepare(
          `insert into job_run_daily_aggregates (id, day, definition_id, runs, failures) values (?, ?, ?, ?, ?)
           on conflict(id) do update set runs = runs + excluded.runs, failures = failures + excluded.failures`
        )
        for (const bucket of grouped.values()) {
          upsert.run(`${bucket.day}:${bucket.definitionId}`, bucket.day, bucket.definitionId, bucket.runs, bucket.failures)
        }
        const remove = db.prepare('delete from job_runs where id = ?')
        for (const row of candidates) remove.run(row.id)
        // A batch that filled the limit probably has more behind it.
        db.exec('commit')
        return { deletedRuns: candidates.length, hasMore: candidates.length === batchLimit }
      } catch (error) {
        try { db.exec('rollback') } catch { /* preserve original failure */ }
        throw error
      }
    },
    listRunAggregates() {
      return db.prepare(
        'select day, definition_id, runs, failures from job_run_daily_aggregates order by day asc, definition_id asc'
      ).all().map((row) => {
        const value = row as { day: string; definition_id: string; runs: number; failures: number }
        return { day: String(value.day), definitionId: String(value.definition_id), runs: Number(value.runs), failures: Number(value.failures) }
      })
    },
    listRunPage(query = {}) {
      const limit = normalizeLimit(query.limit)
      if (limit === 0) return { runs: [], nextCursor: null }
      const records = queryRows(db, query, limit)
      const pageRuns = records.slice(0, limit).map(mapJobRun)
      return {
        runs: pageRuns,
        nextCursor: records.length > pageRuns.length ? pageRuns.at(-1)?.id ?? null : null
      }
    },
    allocateRunId() {
      db.exec('begin immediate')
      try {
        db.prepare(`insert or ignore into job_run_sequence(id, next_id)
          select ?, ? where not exists (select 1 from job_run_sequence where id = ?)
          and not exists (select 1 from job_runs where id glob ? limit 1)`)
          .run(JOB_RUN_SEQUENCE_POLICY.rowId, JOB_RUN_SEQUENCE_POLICY.firstId,
            JOB_RUN_SEQUENCE_POLICY.rowId, `${JOB_RUN_SEQUENCE_POLICY.prefix}*`)
        const row = db.prepare(`update job_run_sequence set next_id = next_id + 1 where id = ?
          returning cast(next_id - 1 as text) as allocated`).get(JOB_RUN_SEQUENCE_POLICY.rowId) as { allocated: string } | undefined
        if (!row) throw new Error('Job run sequence unavailable.')
        db.exec('commit')
        return `${JOB_RUN_SEQUENCE_POLICY.prefix}${row.allocated}`
      } catch (error) {
        db.exec('rollback')
        throw error
      }
    },
    close() {
      try {
        db.exec('pragma wal_checkpoint(truncate);')
      } catch {
        // Ignore when the database is already closed or WAL is unavailable.
      }
      db.close()
    }
  }
}

function applySchema(db: DatabaseSync): void {
  db.exec(`
    create table if not exists job_runs (
      id text primary key,
      definition_id text not null,
      handler_id text not null,
      owner text not null,
      product_id text,
      title text not null,
      status text not null,
      trigger_json text not null,
      payload_json text not null,
      concurrency_key text,
      attempt integer not null,
      max_attempts integer not null,
      created_at text not null,
      started_at text,
      completed_at text,
      last_error text,
      progress_json text,
      logs_json text not null
    );

    create index if not exists idx_job_runs_owner_status_id
      on job_runs(owner, status, id desc);

    create index if not exists idx_job_runs_definition_id
      on job_runs(definition_id, id desc);

    create index if not exists idx_job_runs_handler_id
      on job_runs(handler_id, id desc);

    create index if not exists idx_job_runs_status_id
      on job_runs(status, id desc);

    create table if not exists job_run_daily_aggregates (
      id text primary key,
      day text not null,
      definition_id text not null,
      runs integer not null check (runs >= 0),
      failures integer not null check (failures >= 0),
      unique(day, definition_id)
    );

    create index if not exists idx_job_run_daily_aggregates_day
      on job_run_daily_aggregates(day desc);

    create table if not exists job_run_sequence (
      id integer primary key check (id = ${JOB_RUN_SEQUENCE_POLICY.rowId}),
      next_id integer not null check (typeof(next_id) = 'integer' and next_id >= ${JOB_RUN_SEQUENCE_POLICY.firstId})
    );
  `)
}

function queryRows(db: DatabaseSync, query: JobRunQuery, limit: number): JobRunRow[] {
  const params: SQLInputValue[] = []
  const where: string[] = []

  if (query.owner) {
    where.push('owner = ?')
    params.push(query.owner)
  }
  if (query.productId) {
    where.push('product_id = ?')
    params.push(query.productId)
  }
  if (query.handlerId) {
    where.push('handler_id = ?')
    params.push(query.handlerId)
  }
  if (query.definitionId) {
    where.push('definition_id = ?')
    params.push(query.definitionId)
  }
  if (query.definitionIdPrefix) {
    where.push("definition_id like ? escape '\\'")
    params.push(`${escapeLike(query.definitionIdPrefix)}%`)
  }
  if (query.statuses && query.statuses.length > 0) {
    where.push(`status in (${query.statuses.map(() => '?').join(', ')})`)
    params.push(...query.statuses)
  }

  if (query.payload) {
    where.push("json_type(payload_json) = 'object'")
    for (const [key, expected] of Object.entries(query.payload)) {
      // Bind literal keys through json_each; never interpolate a caller JSON path.
      if (expected === undefined) {
        where.push('not exists (select 1 from json_each(payload_json) p where p.key = ?)')
        params.push(key)
      } else {
        let comparison: string
        const values: SQLInputValue[] = [key]
        if (expected === null) comparison = "p.type = 'null'"
        else if (typeof expected === 'boolean') comparison = expected ? "p.type = 'true'" : "p.type = 'false'"
        else if (typeof expected === 'string') {
          comparison = "p.type = 'text' and p.value = ?"
          values.push(expected)
        } else if (typeof expected === 'number' && Number.isFinite(expected) && !Object.is(expected, -0)) {
          comparison = "p.type in ('integer', 'real') and cast(p.value as real) = cast(? as real)"
          values.push(expected)
        } else return [] // Persisted objects cannot be Object.is-identical to caller objects.
        where.push(`exists (select 1 from json_each(payload_json) p where p.key = ? and ${comparison})`)
        params.push(...values)
      }
    }
  }

  if (query.cursor) {
    if (query.newestFirst) {
      const cursor = db.prepare(`select id, created_at from job_runs where ${[...where, 'id = ?'].join(' and ')}`)
        .get(...params, query.cursor) as { id: string; created_at: string } | undefined
      if (!cursor) return []
      where.push('(created_at < ? or (created_at = ? and id < ?))')
      params.push(cursor.created_at, cursor.created_at, query.cursor)
    } else {
      const cursor = db.prepare(`select id from job_runs where ${[...where, 'id = ?'].join(' and ')}`)
        .get(...params, query.cursor)
      if (!cursor) return []
      where.push('id < ?')
      params.push(query.cursor)
    }
  }

  const rows = db
    .prepare(
      `select
         id, definition_id, handler_id, owner, product_id, title, status, trigger_json, payload_json,
         concurrency_key, attempt, max_attempts, created_at, started_at, completed_at, last_error,
         progress_json, logs_json
       from job_runs
       ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
       order by ${query.newestFirst ? 'created_at desc, id desc' : 'id desc'} limit ?`
    )
    .all(...params, limit + 1) as JobRunRow[]
  return rows
}

function mapJobRun(row: JobRunRow): JobRunRecord {
  return {
    id: row.id,
    definitionId: row.definition_id,
    handlerId: row.handler_id,
    owner: row.owner,
    productId: row.product_id ?? undefined,
    title: row.title,
    status: row.status,
    trigger: cloneJson(parseJson(row.trigger_json)) as JobRunRecord['trigger'],
    payload: cloneJson(parseJson(row.payload_json)),
    concurrencyKey: row.concurrency_key ?? undefined,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    lastError: row.last_error ?? undefined,
    progress: row.progress_json ? (cloneJson(parseJson(row.progress_json)) as JobProgress) : undefined,
    logs: (cloneJson(parseJson(row.logs_json)) as JobLogEntry[]) ?? []
  }
}

function stringifyJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown
}

function cloneJson<T>(value: T): T {
  if (value === undefined || value === null) return value
  return structuredClone(value)
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return JOB_RUN_PAGE_POLICY.defaultLimit
  return Math.min(JOB_RUN_PAGE_POLICY.maximumLimit, Math.max(0, Math.floor(limit)))
}

function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')
}
