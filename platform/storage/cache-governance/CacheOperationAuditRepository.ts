import type { DatabaseSync } from 'node:sqlite'

import { openSqliteDatabase } from '../sqlite/openSqliteDatabase'
import {
  clampCacheAuditMaxRecords,
  clampCacheAuditRetentionDays,
  pruneCacheAuditRecords
} from './cacheAuditRetention'

import type {
  CacheOperationAuditRecord,
  CacheOperationPage,
  CacheOperationQuery
} from './cacheContracts'

/** 裁剪结果：两组数分开报，否则「删了 900 条」说不清是被时间清掉还是被条数上限挤掉。 */
export type CacheOperationAuditPruneResult = Readonly<{
  removedByAge: number
  removedByCount: number
}>

export type CacheOperationAuditPruneOptions = Readonly<{
  now?: string
  retentionDays?: number
  maxRecords?: number
}>

export interface CacheOperationAuditRepository {
  append(record: CacheOperationAuditRecord): Promise<void>
  listPage(query?: CacheOperationQuery): Promise<CacheOperationPage>
  /**
   * 按 `cacheAuditRetentionPolicy` 的时间与条数上限裁剪。
   *
   * 这张表原先只增不减（`MI-11-R16`），所以裁剪必须真的有人定期调用：调用方是
   * `registerCacheAuditRetentionJob`，挂在 `@platform/jobs` 上，不自造定时器。
   */
  prune(options?: CacheOperationAuditPruneOptions): Promise<CacheOperationAuditPruneResult>
  /**
   * 释放底层数据库句柄；幂等。**删库/删目录之前必须先调用**：Windows 不允许 unlink 一个还开着的
   * 文件（`EBUSY`），而 SQLite 关闭时会 checkpoint 并移除 `-wal` / `-shm`，所以先关再删才删得干净。
   * 纯内存实现无句柄，无需动作。
   */
  close(): void
}

export class InMemoryCacheOperationAuditRepository implements CacheOperationAuditRepository {
  private readonly records: CacheOperationAuditRecord[] = []

  async append(record: CacheOperationAuditRecord): Promise<void> {
    this.records.unshift({ ...record })
  }

  async listPage(query: CacheOperationQuery = {}): Promise<CacheOperationPage> {
    return listAuditPage(this.records, query)
  }

  async prune(options: CacheOperationAuditPruneOptions = {}): Promise<CacheOperationAuditPruneResult> {
    const result = pruneCacheAuditRecords(this.records, options)
    this.records.length = 0
    this.records.push(...result.records)
    return { removedByAge: result.removedByAge, removedByCount: result.removedByCount }
  }

  /** 没有句柄可关：保留这个方法是为了调用方不必区分两种仓储。 */
  close(): void {}
}

export function createSqliteCacheOperationAuditRepository(path: string): CacheOperationAuditRepository {
  const connection = openSqliteDatabase(path)
  connection.exec('pragma foreign_keys = on;')
  applyMigrations(connection)
  let closed = false

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
    },
    prune: async (options = {}) => {
      const now = options.now ?? new Date().toISOString()
      const nowMs = Date.parse(now)
      const retentionDays = clampCacheAuditRetentionDays(options.retentionDays)
      const maxRecords = clampCacheAuditMaxRecords(options.maxRecords)
      if (!Number.isFinite(nowMs)) return { removedByAge: 0, removedByCount: 0 }

      const cutoff = new Date(nowMs - retentionDays * 24 * 60 * 60 * 1000).toISOString()
      // 只删「形状可比较且确实更旧」的行：`requested_at` 不是 ISO 形状的记录读不出年龄，保留不猜。
      const aged = connection
        .prepare(`
          delete from cache_operation_audit
          where requested_at < ? and requested_at like '____-__-__T%'
        `)
        .run(cutoff)
      // 条数上限按列表顺序裁剪（`requested_at desc, operation_id desc`），删的是列表最底部那几条。
      const trimmed = connection
        .prepare(`
          delete from cache_operation_audit
          where operation_id in (
            select operation_id from cache_operation_audit
            order by requested_at desc, operation_id desc
            limit -1 offset ?
          )
        `)
        .run(maxRecords)

      return { removedByAge: Number(aged.changes), removedByCount: Number(trimmed.changes) }
    },
    close: () => {
      if (closed) return
      closed = true
      connection.close()
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
