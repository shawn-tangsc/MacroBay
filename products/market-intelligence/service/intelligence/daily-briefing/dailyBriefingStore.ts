import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

import { DEFAULT_PERIOD_ID, type DailyBriefingAttemptRecord, type DailyBriefingDocument, type DailyBriefingLocale } from '../../../contracts/dailyBriefing'
import { isBriefingGenerationTrace, isDailyBriefingDocumentWithinBudget } from '../../../contracts/dailyBriefing'
import type {
  DailyBriefingAttemptEnd,
  DailyBriefingAttemptStart,
  DailyBriefingPeriodRun,
  DailyBriefingStorageState,
  DailyBriefingStore,
  DailyBriefingStoredEdition
} from './dailyBriefingService'
import {
  DAILY_BRIEFING_STORAGE_VERSION,
  createAttemptsSql,
  createEditionsSql,
  createDeleteAuditSql,
  createPeriodRunsSql,
  migrateDailyBriefingStorage,
  tableColumns,
  type DailyBriefingMigrationOutcome
} from './dailyBriefingStorageMigration'

export const dailyBriefingStoragePolicy = Object.freeze({
  fileName: 'daily-briefings.sqlite',
  schemaVersion: DAILY_BRIEFING_STORAGE_VERSION,
  /** Every edition written before issue numbers existed is issue "default". */
  defaultPeriodId: DEFAULT_PERIOD_ID
})

/**
 * One row per local day per issue per language. Re-generating today replaces that row; history is
 * immutable because nothing writes an older date. The 14-day window is enforced by `prune`, called
 * by the service after a write, so the table can never grow past the retention promise.
 *
 * When the upgrade could not run, this store keeps working on the old shape: the reader still gets
 * their briefs, and `upgradeState` says what happened. Writing a column the old table does not have
 * is never attempted; the single issue is implied instead.
 */
export function createDailyBriefingSqliteStore(filePath: string): DailyBriefingStore {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const db = openSqliteDatabase(filePath)
  db.exec('pragma synchronous = full;')
  let outcome: DailyBriefingMigrationOutcome = migrateDailyBriefingStorage({ db, filePath })
  db.exec(createEditionsSql('daily_briefings'))
  db.exec(createAttemptsSql('daily_briefing_attempts'))
  db.exec(createPeriodRunsSql('daily_briefing_period_runs'))
  // 删除审计：只记录，不还原（用户 2026-11-06）。
  db.exec(createDeleteAuditSql())
  // The run table was introduced one commit ago; adding its two columns is idempotent and stays
  // out of the two migrated tables, whose shape is frozen for this release.
  for (const [column, ddl] of [['direction', "text not null default 'undecided'"], ['edition_rows', "text not null default '[]'"]] as const) {
    if (!tableColumns(db, 'daily_briefing_period_runs').includes(column)) {
      db.exec(`alter table daily_briefing_period_runs add column ${column} ${ddl};`)
    }
  }

  const build = () => {
    const editionPeriod = tableColumns(db, 'daily_briefings').includes('period_id')
    const attemptPeriod = tableColumns(db, 'daily_briefing_attempts').includes('period_id')

    const get = editionPeriod
      ? db.prepare('select * from daily_briefings where edition_date = ? and period_id = ? and locale = ?')
      : db.prepare('select * from daily_briefings where edition_date = ? and locale = ?')
    const list = db.prepare('select * from daily_briefings where locale = ? and edition_date >= ? and edition_date <= ? order by edition_date asc')
    const put = editionPeriod
      ? db.prepare(`insert into daily_briefings (edition_date, period_id, locale, generated_at, window_start, window_end, document_json, schema_version)
        values (?, ?, ?, ?, ?, ?, ?, ?)
        on conflict(edition_date, period_id, locale) do update set
          generated_at = excluded.generated_at, window_start = excluded.window_start,
          window_end = excluded.window_end, document_json = excluded.document_json,
          schema_version = excluded.schema_version`)
      : db.prepare(`insert into daily_briefings (edition_date, locale, generated_at, window_start, window_end, document_json, schema_version)
        values (?, ?, ?, ?, ?, ?, ?)
        on conflict(edition_date, locale) do update set
          generated_at = excluded.generated_at, window_start = excluded.window_start,
          window_end = excluded.window_end, document_json = excluded.document_json,
          schema_version = excluded.schema_version`)
    const prune = db.prepare('delete from daily_briefings where edition_date < ?')
    const pruneAttempts = db.prepare('delete from daily_briefing_attempts where edition_date < ?')
    const pruneRuns = db.prepare('delete from daily_briefing_period_runs where edition_date < ?')
    // One row per period: a regeneration replaces that run, because it replaces the editions the
    // run describes. When both languages are written in one run they share this single record.
    const insertRun = db.prepare(`insert into daily_briefing_period_runs
      (edition_date, period_id, expected_locales, primary_requested, primary_used, fallback_reason,
       snapshot_id, snapshot_hash, content_version, writing_rounds, direction, edition_rows, state, started_at, finished_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)
      on conflict(edition_date, period_id) do update set
        expected_locales = excluded.expected_locales, primary_requested = excluded.primary_requested,
        primary_used = excluded.primary_used, fallback_reason = excluded.fallback_reason,
        snapshot_id = excluded.snapshot_id, snapshot_hash = excluded.snapshot_hash,
        content_version = excluded.content_version, writing_rounds = excluded.writing_rounds,
        direction = excluded.direction, edition_rows = excluded.edition_rows,
        state = excluded.state, started_at = excluded.started_at, finished_at = null`)
    const settleRun = db.prepare(`update daily_briefing_period_runs
      set state = ?, finished_at = ?, writing_rounds = coalesce(?, writing_rounds)
      where edition_date = ? and period_id = ?`)
    const readRun = db.prepare('select * from daily_briefing_period_runs where edition_date = ? and period_id = ?')
    // The list needs the runs of a range, not one known period: a run that wrote no edition at all
    // is invisible through `readRun`, because nothing names its period id.
    const listRuns = db.prepare('select * from daily_briefing_period_runs where edition_date between ? and ? order by edition_date desc, period_id asc')

    const beginAttempt = attemptPeriod
      ? (attempt: DailyBriefingAttemptStart): number => {
          const periodId = attempt.periodId ?? DEFAULT_PERIOD_ID
          const next = db.prepare(`select coalesce(max(attempt_no), 0) + 1 as next from daily_briefing_attempts
            where edition_date = ? and period_id = ? and locale = ?`)
          const insert = db.prepare(`insert into daily_briefing_attempts
            (edition_date, period_id, locale, attempt_no, state, failure_code, started_at, finished_at, trace_json, cleaned_at)
            values (?, ?, ?, ?, 'running', null, ?, null, null, null)`)
          db.exec('begin immediate')
          try {
            const row = next.get(attempt.date, periodId, attempt.locale) as { next?: number } | undefined
            const attemptNo = Number(row?.next ?? 1)
            insert.run(attempt.date, periodId, attempt.locale, attemptNo, attempt.startedAt)
            db.exec('commit')
            return attemptNo
          } catch (error) {
            try { db.exec('rollback') } catch { /* the transaction already ended */ }
            throw error
          }
        }
      // The old table holds one failed attempt per edition and has nowhere to keep a start time, so
      // a pending upgrade settles that row instead of inventing a history it cannot store.
      : (attempt: DailyBriefingAttemptStart): number => {
          db.prepare(`insert into daily_briefing_attempts (edition_date, locale, trace_json, updated_at)
            values (?, ?, '{}', ?)
            on conflict(edition_date, locale) do update set updated_at = excluded.updated_at`)
            .run(attempt.date, attempt.locale, attempt.startedAt)
          return 1
        }

    const finishAttempt = attemptPeriod
      ? (attempt: DailyBriefingAttemptEnd): void => {
          db.prepare(`update daily_briefing_attempts
            set state = ?, failure_code = ?, finished_at = ?, trace_json = ?
            where edition_date = ? and period_id = ? and locale = ? and attempt_no = ?`)
            .run(attempt.state, attempt.failureCode ?? null, attempt.finishedAt, attempt.trace ? JSON.stringify(attempt.trace) : null,
              attempt.date, attempt.periodId ?? DEFAULT_PERIOD_ID, attempt.locale, attempt.attemptNo)
        }
      : (attempt: DailyBriefingAttemptEnd): void => {
          db.prepare('update daily_briefing_attempts set trace_json = ?, updated_at = ? where edition_date = ? and locale = ?')
            .run(attempt.trace ? JSON.stringify(attempt.trace) : null, attempt.finishedAt, attempt.date, attempt.locale)
        }

    const listAttemptsStatement = attemptPeriod
      ? db.prepare(`select attempt_no, state, failure_code, started_at, finished_at, cleaned_at from daily_briefing_attempts
          where edition_date = ? and period_id = ? and locale = ? order by attempt_no desc`)
      : db.prepare('select trace_json, updated_at from daily_briefing_attempts where edition_date = ? and locale = ?')
    const latestAttempt = attemptPeriod
      ? db.prepare(`select trace_json from daily_briefing_attempts
          where edition_date = ? and period_id = ? and locale = ? order by attempt_no desc limit 1`)
      : db.prepare('select trace_json from daily_briefing_attempts where edition_date = ? and locale = ?')

    return {
      get: (date: string, periodId: string, locale: DailyBriefingLocale) =>
        (editionPeriod ? get.get(date, periodId, locale) : get.get(date, locale)) as Row | undefined,
      list: (from: string, to: string, locale: DailyBriefingLocale) => list.all(locale, from, to) as Row[],
      put(edition: DailyBriefingStoredEdition, periodId: string) {
        if (editionPeriod) {
          put.run(edition.date, periodId, edition.locale, edition.generatedAt, edition.windowStart, edition.windowEnd, JSON.stringify(edition.document), dailyBriefingStoragePolicy.schemaVersion)
        } else {
          put.run(edition.date, edition.locale, edition.generatedAt, edition.windowStart, edition.windowEnd, JSON.stringify(edition.document), dailyBriefingStoragePolicy.schemaVersion)
        }
      },
      prune(beforeDate: string) {
        prune.run(beforeDate)
        pruneAttempts.run(beforeDate)
        pruneRuns.run(beforeDate)
      },
      beginAttempt,
      finishAttempt,
      openPeriodRun(run: DailyBriefingPeriodRun) {
        insertRun.run(
          run.date, run.periodId, JSON.stringify(run.expectedLocales), run.primaryRequested,
          run.primaryUsed, run.fallbackReason ?? null, run.snapshotId, run.snapshotHash,
          run.contentVersion, run.writingRounds, run.direction, JSON.stringify(run.editionRows), run.state, run.startedAt
        )
      },
      settlePeriodRun(run: Readonly<{ date: string; periodId: string; state: string; finishedAt: string; writingRounds?: number }>) {
        settleRun.run(run.state, run.finishedAt, run.writingRounds ?? null, run.date, run.periodId)
      },
      periodRun(date: string, periodId: string): DailyBriefingPeriodRun | undefined {
        return parseRun(readRun.get(date, periodId) as RunRow | undefined)
      },
      listPeriodRuns(from: string, to: string): readonly DailyBriefingPeriodRun[] {
        return (listRuns.all(from, to) as RunRow[])
          .map((row) => parseRun(row))
          .filter((run): run is DailyBriefingPeriodRun => run !== undefined)
      },
      publishEdition(edition: DailyBriefingStoredEdition, periodId: string, attempt?: DailyBriefingAttemptEnd) {
        if (!isDailyBriefingDocumentWithinBudget(edition.document)) throw new Error('daily-briefing-document-too-large')
        db.exec('begin immediate')
        try {
          if (editionPeriod) {
            put.run(edition.date, periodId, edition.locale, edition.generatedAt, edition.windowStart, edition.windowEnd, JSON.stringify(edition.document), dailyBriefingStoragePolicy.schemaVersion)
          } else {
            put.run(edition.date, edition.locale, edition.generatedAt, edition.windowStart, edition.windowEnd, JSON.stringify(edition.document), dailyBriefingStoragePolicy.schemaVersion)
          }
          if (attempt) finishAttempt(attempt)
          db.exec('commit')
        } catch (error) {
          try { db.exec('rollback') } catch { /* the transaction already ended */ }
          throw error
        }
      },
      listAttempts(date: string, periodId: string, locale: DailyBriefingLocale, attemptPeriod: boolean): readonly DailyBriefingAttemptRecord[] {
        if (attemptPeriod) {
          const rows = listAttemptsStatement.all(date, periodId, locale) as Array<Record<string, unknown>>
          return Object.freeze(rows.map((row) => Object.freeze({
            attemptNo: Number(row.attempt_no),
            state: row.state === 'succeeded' || row.state === 'running' ? row.state : 'failed' as const,
            ...(typeof row.failure_code === 'string' && row.failure_code ? { failureCode: row.failure_code } : {}),
            startedAt: String(row.started_at),
            ...(typeof row.finished_at === 'string' && row.finished_at ? { finishedAt: row.finished_at } : {}),
            ...(typeof row.cleaned_at === 'string' && row.cleaned_at ? { cleanedAt: row.cleaned_at } : {})
          })))
        }
        const rows = listAttemptsStatement.all(date, locale) as Array<Record<string, unknown>>
        return Object.freeze(rows.map((row) => Object.freeze({
          attemptNo: 1,
          state: 'failed' as const,
          startedAt: String(row.updated_at),
          finishedAt: String(row.updated_at)
        })))
      },
      markAttemptCleaned(input: Readonly<{ editionDate: string; periodId: string; locale: DailyBriefingLocale; attemptNo?: number; cleanedAt: string }>): number | null {
        // The old table cannot hold a tombstone: its trace column is NOT NULL. Until the upgrade
        // runs there is nowhere to write `cleaned_at`. This is not "the row is gone" — it is "not
        // representable yet" — so it answers `null` and the caller keeps its retry anchor.
        if (!attemptPeriod) return null
        if (input.attemptNo !== undefined) {
          const result = db.prepare(`update daily_briefing_attempts set trace_json = null, cleaned_at = ?
            where edition_date = ? and period_id = ? and locale = ? and attempt_no = ?`)
            .run(input.cleanedAt, input.editionDate, input.periodId, input.locale, input.attemptNo)
          return Number(result.changes)
        }
        const newest = db.prepare(`select max(attempt_no) as latest from daily_briefing_attempts
          where edition_date = ? and period_id = ? and locale = ?`).get(input.editionDate, input.periodId, input.locale) as { latest?: number } | undefined
        if (newest?.latest === undefined || newest.latest === null) return 0
        const result = db.prepare(`update daily_briefing_attempts set trace_json = null, cleaned_at = ?
          where edition_date = ? and period_id = ? and locale = ? and attempt_no = ?`)
          .run(input.cleanedAt, input.editionDate, input.periodId, input.locale, Number(newest.latest))
        return Number(result.changes)
      },
      latestAttempt: (date: string, periodId: string, locale: DailyBriefingLocale) =>
        (attemptPeriod ? latestAttempt.get(date, periodId, locale) : latestAttempt.get(date, locale)) as Row | undefined
    }
  }

  let statements = build()

  const upgradeState = (): DailyBriefingStorageState => outcome.status === 'skipped'
    ? Object.freeze({ state: 'incomplete' as const, reason: outcome.reason })
    : Object.freeze({ state: 'ready' as const })

  return Object.freeze({
    async get(date, locale, periodId) {
      return parseRow(statements.get(date, periodId ?? DEFAULT_PERIOD_ID, locale))
    },
    async put(edition) {
      if (!isDailyBriefingDocumentWithinBudget(edition.document)) throw new Error('daily-briefing-document-too-large')
      statements.put(edition, edition.periodId ?? DEFAULT_PERIOD_ID)
    },
    async editionAtCutoff(date, locale, cutoff) {
      // 旧表没有 `period_id` 列：那一代一天一语言只有一版，没有可比的期号。
      if (!tableColumns(db, 'daily_briefings').includes('period_id')) return undefined
      const row = db.prepare('select period_id from daily_briefings where edition_date = ? and locale = ? and window_end = ? limit 1')
        .get(date, locale, cutoff) as { period_id?: unknown } | undefined
      return typeof row?.period_id === 'string' && row.period_id.length > 0 ? Object.freeze({ periodId: row.period_id }) : undefined
    },
    async list(from, to, locale) {
      return Object.freeze(statements.list(from, to, locale).flatMap((row) => {
        const parsed = parseRow(row)
        return parsed ? [parsed] : []
      }))
    },
    async beginAttempt(attempt) {
      return statements.beginAttempt(attempt)
    },
    async finishAttempt(attempt) {
      statements.finishAttempt(attempt)
    },
    async markAttemptCleaned(input) {
      return statements.markAttemptCleaned({
        editionDate: input.editionDate,
        periodId: input.periodId,
        locale: input.locale,
        ...(input.attemptNo === undefined ? {} : { attemptNo: input.attemptNo }),
        cleanedAt: input.cleanedAt
      })
    },
    async listAttempts(date, locale, periodId) {
      return statements.listAttempts(date, periodId ?? DEFAULT_PERIOD_ID, locale, tableColumns(db, 'daily_briefing_attempts').includes('period_id'))
    },
    async getAttempt(date, locale, periodId) {
      const row = statements.latestAttempt(date, periodId ?? DEFAULT_PERIOD_ID, locale)
      if (!row?.trace_json) return undefined
      try {
        const parsed = JSON.parse(row.trace_json) as unknown
        return isBriefingGenerationTrace(parsed) ? parsed : undefined
      } catch {
        return undefined
      }
    },
    async prune(beforeDate) {
      statements.prune(beforeDate)
    },
    async getPeriodRun(date, periodId) {
      return statements.periodRun(date, periodId ?? DEFAULT_PERIOD_ID)
    },
    async listPeriodRuns(from, to) {
      return statements.listPeriodRuns(from, to)
    },
    async listAttemptRuns(from, to) {
      // 旧表没有 `period_id` 列：那一代一天一语言一版，没有"某一期跑了没跑"这回事。
      if (!tableColumns(db, 'daily_briefing_attempts').includes('period_id')) return Object.freeze([])
      const rows = db.prepare(`select edition_date, period_id, locale, state from daily_briefing_attempts
        where edition_date between ? and ? order by edition_date asc, period_id asc, locale asc`)
        .all(from, to) as Array<Record<string, unknown>>
      return Object.freeze(rows.map((row) => Object.freeze({
        date: String(row.edition_date),
        periodId: String(row.period_id),
        locale: String(row.locale) as 'zh-CN' | 'en-US',
        state: row.state === 'succeeded' || row.state === 'running' ? row.state : 'failed' as const
      })))
    },
    async openPeriodRun(run) {
      statements.openPeriodRun(run)
    },
    async settlePeriodRun(run) {
      statements.settlePeriodRun(run)
    },
    async publishEdition(edition, attempt) {
      statements.publishEdition(edition, edition.periodId ?? DEFAULT_PERIOD_ID, attempt)
    },
    async deletePeriod(date, periodId, locale) {
      // 删的是**这一行**的记录：版次 + 这一次尝试的所有记录（用户 2026-11-06 定 A 口径）。
      // 运行记录按 (日期, 期号) 存、两种语言共用，所以只在这一期已经没有别的版次时才删它——
      // 否则删中文版会顺手抹掉英文版那一行的运行记录。会话连接在另一个库，另删。
      const editions = db.prepare('delete from daily_briefings where edition_date = ? and period_id = ? and locale = ?').run(date, periodId, locale)
      let attempts = 0
      if (tableColumns(db, 'daily_briefing_attempts').includes('period_id')) {
        attempts = Number(db.prepare('delete from daily_briefing_attempts where edition_date = ? and period_id = ? and locale = ?')
          .run(date, periodId, locale).changes ?? 0)
      }
      let periodRuns = 0
      const remaining = db.prepare('select count(*) as n from daily_briefings where edition_date = ? and period_id = ?')
        .get(date, periodId) as { n?: unknown } | undefined
      if (Number(remaining?.n ?? 0) === 0) {
        periodRuns = Number(db.prepare('delete from daily_briefing_period_runs where edition_date = ? and period_id = ?')
          .run(date, periodId).changes ?? 0)
      }
      return Object.freeze({
        editions: Number(editions.changes ?? 0),
        attempts,
        periodRuns
      })
    },
    async wasEditionDeleted(date, periodId, locale) {
      // 读者删过这一行没有：只认**成功**那次（部分失败的删除不算删干净，补跑仍可补）。
      const row = db.prepare(`select 1 as hit from daily_briefing_delete_audit
        where edition_date = ? and period_id = ? and locale = ? and outcome = 'success' limit 1`)
        .get(date, periodId, locale) as { hit?: unknown } | undefined
      return row !== undefined
    },
    async recordDeleteAudit(entry: Parameters<NonNullable<DailyBriefingStore['recordDeleteAudit']>>[0]) {
      // append-only：一次删除写一条，写不进去不阻塞删除本身（删掉数据是读者的动作，日志是旁证）。
      db.prepare('insert or ignore into daily_briefing_delete_audit (at, entry, edition_date, period_id, locale, outcome, failure_code) values (?, ?, ?, ?, ?, ?, ?)')
        .run(entry.at, entry.entry, entry.editionDate, entry.periodId, entry.locale, entry.outcome, entry.failureCode ?? null)
    },
    upgradeState,
    async retryUpgrade() {
      outcome = migrateDailyBriefingStorage({ db, filePath })
      statements = build()
      return upgradeState()
    }
  })
}

type Row = Readonly<{
  edition_date: string
  period_id?: string
  locale: string
  generated_at: string
  window_start: string
  window_end: string
  document_json: string
  schema_version: number
  trace_json?: string | null
}>

type RunRow = Readonly<{
  edition_date: string
  period_id: string
  expected_locales: string
  primary_requested: string
  primary_used: string
  fallback_reason: string | null
  snapshot_id: string
  snapshot_hash: string
  content_version: number
  writing_rounds: number
  direction: string | null
  edition_rows: string | null
  state: string
  started_at: string
  finished_at: string | null
}>

const runStates = ['running', 'published', 'partial', 'failed'] as const

function parseRun(row: RunRow | undefined): DailyBriefingPeriodRun | undefined {
  if (!row) return undefined
  let locales: unknown
  try {
    locales = JSON.parse(row.expected_locales)
  } catch {
    return undefined
  }
  if (!Array.isArray(locales) || locales.length === 0 || locales.some((locale) => locale !== 'zh-CN' && locale !== 'en-US')) return undefined
  const state = runStates.find((value) => value === row.state)
  if (!state) return undefined
  return Object.freeze({
    date: row.edition_date,
    periodId: row.period_id,
    expectedLocales: Object.freeze(locales as DailyBriefingLocale[]),
    primaryRequested: row.primary_requested,
    primaryUsed: row.primary_used === 'en-US' ? 'en-US' : 'zh-CN',
    ...(row.fallback_reason ? { fallbackReason: row.fallback_reason } : {}),
    snapshotId: row.snapshot_id,
    snapshotHash: row.snapshot_hash,
    contentVersion: Number(row.content_version),
    writingRounds: Number(row.writing_rounds),
    direction: (row.direction ?? 'undecided') as DailyBriefingPeriodRun['direction'],
    editionRows: Object.freeze(parseRows(row.edition_rows)),
    state,
    startedAt: row.started_at,
    ...(row.finished_at ? { finishedAt: row.finished_at } : {})
  })
}

function parseRows(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

function parseRow(row: Row | undefined): DailyBriefingStoredEdition | undefined {
  if (!row) return undefined
  // A row written before the upgrade carries the old storage version; its document shape is the
  // same, so the version only tells us which table it came from.
  if (row.schema_version !== dailyBriefingStoragePolicy.schemaVersion && row.schema_version !== 2) return undefined
  let document: DailyBriefingDocument
  try {
    document = JSON.parse(row.document_json) as DailyBriefingDocument
  } catch {
    return undefined
  }
  if (!isDailyBriefingDocumentWithinBudget(document)) return undefined
  return Object.freeze({
    date: row.edition_date,
    periodId: row.period_id ?? DEFAULT_PERIOD_ID,
    locale: row.locale as DailyBriefingLocale,
    generatedAt: row.generated_at,
    windowStart: row.window_start,
    windowEnd: row.window_end,
    document
  })
}
