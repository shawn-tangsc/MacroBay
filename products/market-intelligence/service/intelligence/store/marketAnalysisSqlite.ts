import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type MarketAnalysisSqlite = Readonly<{
  database: DatabaseSync
  filePath: string
  close: () => void
}>

/**
 * Locking policy for the product analysis database.
 *
 * `busyTimeoutMs` is not optional in practice: without it SQLite fails a read
 * immediately when a concurrent write holds the database, and the product surface
 * shows that failure as an empty timeline or an unavailable detail. Waiting makes
 * a normal concurrent write invisible to readers.
 */
export const marketAnalysisSqlitePolicy = Object.freeze({
  busyTimeoutMs: 5_000
})

export function createMarketAnalysisSqlite(filePath: string): MarketAnalysisSqlite {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const database = new DatabaseSync(filePath)
  try {
    database.exec(`pragma journal_mode = wal; pragma synchronous = full; pragma foreign_keys = on; pragma busy_timeout = ${marketAnalysisSqlitePolicy.busyTimeoutMs};`)
  } catch (error) {
    database.close()
    throw error
  }
  let closed = false
  return {
    database,
    filePath,
    close() {
      if (closed) return
      closed = true
      try {
        if (filePath !== ':memory:') database.exec('pragma wal_checkpoint(truncate)')
      } finally {
        database.close()
      }
    }
  }
}
