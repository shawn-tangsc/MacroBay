import { DatabaseSync } from 'node:sqlite'

import type {
  CacheOperationAuditRecord,
  CacheOperationPage,
  CacheOperationQuery
} from './cacheContracts'

export interface CacheOperationAuditRepository {
  append(record: CacheOperationAuditRecord): Promise<void>
  listPage(query?: CacheOperationQuery): Promise<CacheOperationPage>
}

export class InMemoryCacheOperationAuditRepository implements CacheOperationAuditRepository {
  private readonly records: CacheOperationAuditRecord[] = []

  async append(record: CacheOperationAuditRecord): Promise<void> {
    this.records.unshift({ ...record })
  }

  async listPage(query: CacheOperationQuery = {}): Promise<CacheOperationPage> {
    return listAuditPage(this.records, query)
  }
}

export function createSqliteCacheOperationAuditRepository(path: string): CacheOperationAuditRepository {
  const connection = new DatabaseSync(path)
  connection.exec('pragma foreign_keys = on;')
  applyMigrations(connection)

  return {
    append: async (record) => {
      connection
        .prepare(`
          insert into cache_operation_audit (
            operation_id,
            cache_id,
            owner_type,
            owner_id,
            operation,
            dry_run,
            requested_at,
            completed_at,
            status,
            removed_bytes,
            removed_records,
            normalized_error_code,
            message
          ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          record.operationId,
          record.cacheId,
          record.ownerType,
          record.ownerId,
          record.operation,
          record.dryRun ? 1 : 0,
          record.requestedAt,
          record.completedAt ?? null,
          record.status,
          record.removedBytes ?? null,
          record.removedRecords ?? null,
          record.normalizedErrorCode ?? null,
          record.message ?? null
        )
    },
    listPage: async (query = {}) => {
      const limit = normalizeAuditPageLimit(query.limit)
      const offset = decodeCursor(query.cursor)
      const where = buildWhereClause(query)
      const rows = connection
        .prepare(`
          select
            operation_id,
            cache_id,
            owner_type,
            owner_id,
            operation,
            dry_run,
            requested_at,
            completed_at,
            status,
            removed_bytes,
            removed_records,
            normalized_error_code,
            message
          from cache_operation_audit
          ${where.sql}
          order by requested_at desc, operation_id desc
          limit ? offset ?
        `)
        .all(...where.params, limit + 1, offset) as CacheOperationAuditRow[]

      const pageRows = rows.slice(0, limit).map(toAuditRecord)
      const nextCursor = rows.length > limit ? encodeCursor(offset + limit) : null

      return {
        records: pageRows,
        nextCursor
      }
    }
  }
}

type CacheOperationAuditRow = {
  operation_id: string
  cache_id: string
  owner_type: string
  owner_id: string
  operation: string
  dry_run: number
  requested_at: string
  completed_at: string | null
  status: string
  removed_bytes: number | null
  removed_records: number | null
  normalized_error_code: string | null
  message: string | null
}

function applyMigrations(connection: DatabaseSync): void {
  connection.exec(`
    create table if not exists cache_governance_migrations (
      id text primary key,
      applied_at text not null
    );
  `)

  const migrationId = '0001_cache_operation_audit'
  const applied = connection
    .prepare('select id from cache_governance_migrations where id = ?')
    .get(migrationId) as { id?: string } | undefined

  if (applied?.id) return

  connection.exec('begin')
  try {
    connection.exec(`
      create table if not exists cache_operation_audit (
        operation_id text primary key,
        cache_id text not null,
        owner_type text not null,
        owner_id text not null,
        operation text not null,
        dry_run integer not null,
        requested_at text not null,
        completed_at text,
        status text not null,
        removed_bytes integer,
        removed_records integer,
        normalized_error_code text,
        message text
      );

      create index if not exists idx_cache_operation_audit_requested_at
        on cache_operation_audit(requested_at desc, operation_id desc);

      create index if not exists idx_cache_operation_audit_cache
        on cache_operation_audit(cache_id, requested_at desc, operation_id desc);

      create index if not exists idx_cache_operation_audit_owner
        on cache_operation_audit(owner_type, owner_id, requested_at desc, operation_id desc);
    `)
    connection
      .prepare('insert into cache_governance_migrations (id, applied_at) values (?, ?)')
      .run(migrationId, new Date().toISOString())
    connection.exec('commit')
  } catch (error) {
    connection.exec('rollback')
    throw error
  }
}

function listAuditPage(records: CacheOperationAuditRecord[], query: CacheOperationQuery = {}): CacheOperationPage {
  const limit = normalizeAuditPageLimit(query.limit)
  const offset = decodeCursor(query.cursor)
  const filtered = records.filter((record) => {
    if (query.cacheId && record.cacheId !== query.cacheId) return false
    if (query.ownerType && record.ownerType !== query.ownerType) return false
    if (query.ownerId && record.ownerId !== query.ownerId) return false
    return true
  })
  const slice = filtered.slice(offset, offset + limit)
  const nextCursor = offset + limit < filtered.length ? encodeCursor(offset + limit) : null
  return {
    records: slice.map((record) => ({ ...record })),
    nextCursor
  }
}

function buildWhereClause(query: CacheOperationQuery): { sql: string; params: Array<string> } {
  const clauses: string[] = []
  const params: string[] = []

  if (query.cacheId) {
    clauses.push('cache_id = ?')
    params.push(query.cacheId)
  }
  if (query.ownerType) {
    clauses.push('owner_type = ?')
    params.push(query.ownerType)
  }
  if (query.ownerId) {
    clauses.push('owner_id = ?')
    params.push(query.ownerId)
  }

  return {
    sql: clauses.length > 0 ? `where ${clauses.join(' and ')}` : '',
    params
  }
}

function toAuditRecord(row: CacheOperationAuditRow): CacheOperationAuditRecord {
  return {
    operationId: row.operation_id,
    cacheId: row.cache_id,
    ownerType: row.owner_type as CacheOperationAuditRecord['ownerType'],
    ownerId: row.owner_id,
    operation: row.operation as CacheOperationAuditRecord['operation'],
    dryRun: row.dry_run === 1,
    requestedAt: row.requested_at,
    completedAt: row.completed_at ?? undefined,
    status: row.status as CacheOperationAuditRecord['status'],
    removedBytes: row.removed_bytes ?? undefined,
    removedRecords: row.removed_records ?? undefined,
    normalizedErrorCode: row.normalized_error_code as CacheOperationAuditRecord['normalizedErrorCode'],
    message: row.message ?? undefined
  }
}

function normalizeAuditPageLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit)) return 50
  return Math.min(200, Math.max(1, Math.floor(limit ?? 50)))
}

function encodeCursor(offset: number): string {
  return Buffer.from(String(offset), 'utf8').toString('base64')
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0
  try {
    const value = Number(Buffer.from(cursor, 'base64').toString('utf8'))
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
  } catch {
    return 0
  }
}
