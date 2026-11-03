import { DatabaseSync } from 'node:sqlite'

import { isTempDirectoryVerified } from './tempDirectoryReadiness'

/**
 * 所有本地 SQLite 库共用的等待窗口。
 *
 * SQLite 默认 `busy_timeout = 0`：只要另一个连接持有写锁，本连接立刻得到 `SQLITE_BUSY`，
 * 而不是等对方提交。5 秒是这里所有库的统一值，与产品分析库、供应商库原有的等待窗口一致。
 */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000



export type SqliteJournalMode =
  /** 默认：切到 WAL，读写不互相阻塞，崩溃后由 SQLite 自己恢复。 */
  | 'wal'
  /** 沿用文件原有日志模式。只用于不能改写文件的读取路径（归档副本、不可变快照）。 */
  | 'preserve'

export type OpenSqliteDatabaseOptions = {
  /** 只读打开：不改写文件，因此不切换 `journal_mode`（只读连接切 WAL 会报 readonly）。 */
  readOnly?: boolean
  journalMode?: SqliteJournalMode
  /**
   * 新建库时在切 `journal_mode` 之前设置的页大小。
   * 顺序是硬性的：WAL 库的 page_size 在创建后无法再改，必须先把页大小定下来再切 WAL。
   */
  pageSizeBytes?: number
  busyTimeoutMs?: number
}

/**
 * 打开本地 SQLite 库的唯一入口。
 *
 * 每个库都经过这里，才能保证三件事只有一份实现：`busy_timeout` 有等待窗口、可写库开 WAL、
 * 需要定页大小的库在切 WAL 之前定好。新增一个库时不需要再抄一遍 pragma；`sqliteOpenPathBoundary
 * .test.ts` 会拦住绕过它的直接打开。
 *
 * 其余 pragma（`foreign_keys`、`synchronous`）仍由各库按自己的语义追加：它们不是所有库都该有
 * 同一个值的开关，所以没有收进来。
 */
export function openSqliteDatabase(
  path: string,
  options: OpenSqliteDatabaseOptions = {}
): DatabaseSync {
  // 顺序闸门：见 `tempDirectoryReadiness.ts` 的注释（标志单独成文件，因为它要进渲染层测试 setup）。
  if (!isTempDirectoryVerified()) throw new Error('sqlite-temp-directory-not-verified')

  const busyTimeoutMs = normalizeBusyTimeout(options.busyTimeoutMs)
  const pageSizeBytes =
    options.pageSizeBytes === undefined ? undefined : normalizePageSize(options.pageSizeBytes)

  const database =
    options.readOnly === true ? new DatabaseSync(path, { readOnly: true }) : new DatabaseSync(path)
  try {
    database.exec(`pragma busy_timeout = ${busyTimeoutMs}`)
    if (pageSizeBytes !== undefined) database.exec(`pragma page_size = ${pageSizeBytes}`)
    // 只读连接写不了文件头，切 WAL 只会得到 "attempt to write a readonly database"。
    if (options.readOnly !== true && (options.journalMode ?? 'wal') === 'wal') {
      database.exec('pragma journal_mode = wal')
    }
  } catch (error) {
    database.close()
    throw error
  }
  return database
}

function normalizeBusyTimeout(value: number | undefined): number {
  if (value === undefined) return SQLITE_BUSY_TIMEOUT_MS
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`busyTimeoutMs must be a non-negative integer, received ${String(value)}.`)
  }
  return value
}

function normalizePageSize(value: number): number {
  if (!Number.isInteger(value) || value < 512 || value > 65_536 || (value & (value - 1)) !== 0) {
    throw new Error(`pageSizeBytes must be a power of two between 512 and 65536, received ${String(value)}.`)
  }
  return value
}
