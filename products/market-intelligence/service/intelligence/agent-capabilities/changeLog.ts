import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { guardProductToolOutput } from './sensitiveDataGuard'

export const agentChangeLogStoragePolicy = Object.freeze({
  fileName: 'agent-change-log.sqlite',
  schemaVersion: 2
})

/** What the business result says happened, not what the model asked for. */
export type AgentChangeLogOutcome = 'applied' | 'unchanged' | 'rejected' | 'failed'

export type AgentChangeLogEntry = Readonly<{
  traceId: string
  agentId: string
  agentSessionId: string
  domain: string
  action: string
  sourceId?: string
  before?: unknown
  after?: unknown
  changeSummary: string
  outcome: AgentChangeLogOutcome
  configurationChanged: boolean
  revisionBefore: string
  revisionAfter: string
  createdAt: string
}>

export type AgentChangeLogRow = AgentChangeLogEntry & Readonly<{ id: string }>

export type AgentChangeLog = ReturnType<typeof createAgentChangeLog>

/**
 * The product's own record of what an agent changed.
 *
 * The platform trace only keeps input/output hashes, which answer "was it called and did it
 * succeed", not "what changed". This table answers the second question and stays inside the
 * product: no platform schema change, no credential material (values pass the same output guard).
 */
export function createAgentChangeLog(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true })
  const database = new DatabaseSync(filePath)
  database.exec('pragma journal_mode = wal; pragma synchronous = full;')
  database.exec(`
    create table if not exists intelligence_agent_change_log (
      id text primary key,
      trace_id text not null,
      agent_id text not null,
      agent_session_id text not null,
      domain text not null,
      action text not null,
      source_id text,
      before_json text,
      after_json text,
      change_summary text not null,
      outcome text not null default 'applied',
      configuration_changed integer not null default 1,
      revision_before text not null,
      revision_after text not null,
      created_at text not null
    );
    create index if not exists idx_agent_change_log_trace on intelligence_agent_change_log(trace_id);
    create index if not exists idx_agent_change_log_source on intelligence_agent_change_log(source_id, created_at);
  `)
  // A store created before schema 2 has neither column. `create table if not exists` leaves it
  // untouched, so add the columns in place; the defaults backfill every old row. Old rows were
  // written as mutations (the pre-outcome schema had no other meaning), so they read back as
  // `applied`/`configuration_changed = 1` until someone can prove otherwise. That is a backfill,
  // not an observation: no v1 row ever carried an outcome.
  const columns = new Set(
    (database.prepare('pragma table_info(intelligence_agent_change_log)').all() as Array<{ name?: unknown }>)
      .map((column) => String(column.name))
  )
  if (!columns.has('outcome')) {
    database.exec(
      "alter table intelligence_agent_change_log add column outcome text not null default 'applied'"
    )
  }
  if (!columns.has('configuration_changed')) {
    database.exec(
      'alter table intelligence_agent_change_log add column configuration_changed integer not null default 1'
    )
  }
  database.exec('pragma user_version = 2;')

  return {
    /** Throws when the entry cannot be stored; the caller reports `auditFailed` instead of hiding it. */
    append(entry: AgentChangeLogEntry): AgentChangeLogRow {
      const id = randomUUID()
      const beforeJson = entry.before === undefined ? null : serializeSafe(entry.before)
      const afterJson = entry.after === undefined ? null : serializeSafe(entry.after)
      database.prepare(
        `insert into intelligence_agent_change_log (
          id, trace_id, agent_id, agent_session_id, domain, action, source_id,
          before_json, after_json, change_summary, outcome, configuration_changed,
          revision_before, revision_after, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        entry.traceId,
        entry.agentId,
        entry.agentSessionId,
        entry.domain,
        entry.action,
        entry.sourceId ?? null,
        beforeJson,
        afterJson,
        entry.changeSummary,
        entry.outcome,
        entry.configurationChanged ? 1 : 0,
        entry.revisionBefore,
        entry.revisionAfter,
        entry.createdAt
      )
      return Object.freeze({ ...entry, id })
    },

    listRecent(input: { traceId?: string; sourceId?: string; limit?: number } = {}): AgentChangeLogRow[] {
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 100)
      const conditions: string[] = []
      const parameters: string[] = []
      if (input.traceId) {
        conditions.push('trace_id = ?')
        parameters.push(input.traceId)
      }
      if (input.sourceId) {
        conditions.push('source_id = ?')
        parameters.push(input.sourceId)
      }
      const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : ''
      const rows = database
        .prepare(`select * from intelligence_agent_change_log ${where} order by created_at desc, rowid desc limit ?`)
        .all(...parameters, limit) as Array<Record<string, unknown>>
      return rows.map(toRow)
    },

    close(): void {
      database.close()
    }
  }
}

function serializeSafe(value: unknown): string {
  // Normalise to JSON first so `undefined` fields drop and Dates become strings, then run the same
  // guard the tool output runs. A blocked value throws; nothing sensitive reaches the table.
  const normalized: unknown = JSON.parse(JSON.stringify(value))
  return JSON.stringify(guardProductToolOutput(normalized))
}

function toRow(row: Record<string, unknown>): AgentChangeLogRow {
  const parse = (value: unknown): unknown => {
    if (typeof value !== 'string') return undefined
    try {
      return JSON.parse(value)
    } catch {
      return undefined
    }
  }
  return Object.freeze({
    id: String(row.id),
    traceId: String(row.trace_id),
    agentId: String(row.agent_id),
    agentSessionId: String(row.agent_session_id),
    domain: String(row.domain),
    action: String(row.action),
    ...(typeof row.source_id === 'string' ? { sourceId: row.source_id } : {}),
    ...(parse(row.before_json) !== undefined ? { before: parse(row.before_json) } : {}),
    ...(parse(row.after_json) !== undefined ? { after: parse(row.after_json) } : {}),
    changeSummary: String(row.change_summary),
    outcome: normalizeOutcome(row.outcome),
    configurationChanged: Number(row.configuration_changed) === 1,
    revisionBefore: String(row.revision_before),
    revisionAfter: String(row.revision_after),
    createdAt: String(row.created_at)
  })
}

function normalizeOutcome(value: unknown): AgentChangeLogOutcome {
  return value === 'unchanged' || value === 'rejected' || value === 'failed' ? value : 'applied'
}
