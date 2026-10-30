import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type { SyncAuditEntry } from '../../../contracts/syncRunRecords'

/**
 * Product-side audit for the actions a job never sees: switching a source on, testing a connection,
 * refreshing a decision, importing a calendar file.
 *
 * It lives in its own database rather than the calendar's, because it is product-wide and must not
 * drag the calendar's schema version or backup policy along with it.
 */
export const syncAuditPolicy = {
  fileName: 'sync-audit.sqlite',
  retentionDays: 30,
  /** Keep no plaintext credentials or response bodies; the detail is a summary. */
  detailMaxLength: 200
} as const

export type SyncAuditStore = Readonly<{
  append: (entry: Omit<SyncAuditEntry, 'id'>) => void
  list: (input: { since: string; limit: number }) => readonly SyncAuditEntry[]
  prune: (before: string) => number
  close: () => void
}>

/** A broken audit file must not stop the product from booting; auditing simply stays off. */
export function createSyncAuditStoreIfAvailable(filePath: string): SyncAuditStore | undefined {
  try {
    return createSyncAuditStore(filePath)
  } catch {
    return undefined
  }
}

export function createSyncAuditStore(filePath: string): SyncAuditStore {
  const database = new DatabaseSync(filePath)
  database.exec(`create table if not exists mi_sync_audit (
    id text primary key, at text not null, actor text not null, action text not null,
    target text not null, outcome text not null, failure_code text, duration_ms integer,
    detail text, correlation_id text
  ); create index if not exists idx_mi_sync_audit_at on mi_sync_audit(at desc);`)
  const insert = database.prepare(
    `insert into mi_sync_audit (id, at, actor, action, target, outcome, failure_code, duration_ms, detail, correlation_id)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  const select = database.prepare('select * from mi_sync_audit where at >= ? order by at desc limit ?')
  const prune = database.prepare('delete from mi_sync_audit where at < ?')

  return Object.freeze({
    append(entry) {
      // One id for both columns: the row is its own correlation key, and a second random value
      // would be a column nothing reads.
      const id = randomUUID()
      const detail = entry.detail ? entry.detail.slice(0, syncAuditPolicy.detailMaxLength) : null
      insert.run(
        id, entry.at, entry.actor, entry.action, entry.target, entry.outcome,
        entry.failureCode ?? null, entry.durationMs ?? null, detail, id
      )
      // Cheap with the index in place, and it keeps the file bounded without a separate job.
      const at = Date.parse(entry.at)
      if (Number.isFinite(at)) prune.run(new Date(at - syncAuditPolicy.retentionDays * 86_400_000).toISOString())
    },
    list({ since, limit }) {
      return (select.all(since, Math.max(1, limit)) as Array<Record<string, unknown>>).map(toEntry)
    },
    prune(before) {
      return Number(prune.run(before).changes ?? 0)
    },
    close() {
      database.close()
    }
  })
}

function toEntry(row: Record<string, unknown>): SyncAuditEntry {
  return {
    id: String(row.id), at: String(row.at), actor: row.actor as SyncAuditEntry['actor'],
    action: row.action as SyncAuditEntry['action'], target: String(row.target),
    outcome: row.outcome as SyncAuditEntry['outcome'],
    ...(typeof row.failure_code === 'string' ? { failureCode: row.failure_code } : {}),
    ...(typeof row.duration_ms === 'number' ? { durationMs: row.duration_ms } : {}),
    ...(typeof row.detail === 'string' ? { detail: row.detail } : {})
  }
}
