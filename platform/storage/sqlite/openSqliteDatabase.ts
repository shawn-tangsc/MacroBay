import { DatabaseSync } from 'node:sqlite'

/**
 * 所有本地 SQLite 库共用的等待窗口。
 *
 * SQLite 默认 `busy_timeout = 0`：只要另一个连接持有写锁，本连接立刻得到 `SQLITE_BUSY`，
 * 而不是等对方提交。5 秒是这里所有库的统一值，与产品分析库、供应商库原有的等待窗口一致。
 */
export const SQLITE_BUSY_TIMEOUT_MS = 5_000

/**
 * 系统临时目录是否已确认可写。**默认 false，开库前必须被显式打开。**
 *
 * 为什么是运行时闸门而不是一条顺序测试：Windows 受限会话里 TEMP/TMP 可能指向进程建不出来的
 * 目录（`D:\tmp`），SQLite 建临时文件会返回 `unable to open database file`，而它发生在启动
 * 迁移里——用户看到的是「应用起不来」。修法（探针 + 改写到 `<userData>/tmp`）当初写在 `app.ts`
 * 里、撞行数上限才挪到 `platformCore`；**「先探针、后开库」这个顺序此前没有任何东西守着**，
 * 而 CI 的机器临时目录可写，正常跑永远走不到那条分支。
 *
 * 所以顺序不能靠「今天这条路径写对了」，只能靠入口：没标记就抛错。新增任何开库调用点，
 * 只要装配时没先探过，第一次跑就会炸在 `platformCore` 这一层，离根因很近。
 */
let tempDirectoryVerified = false

/** 由装配根在 `ensureWritableTempDirectory` 成功后调用；测试与脚本在自建可写目录后调用。 */
export function markTempDirectoryVerified(): void {
  tempDirectoryVerified = true
}

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
  if (!tempDirectoryVerified) throw new Error('sqlite-temp-directory-not-verified')

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
