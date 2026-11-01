import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'

import { openSqliteDatabase } from '@platform/storage/sqlite/openSqliteDatabase'

export type MarketAnalysisSqlite = Readonly<{
  database: DatabaseSync
  filePath: string
  close: () => void
}>

export function createMarketAnalysisSqlite(filePath: string): MarketAnalysisSqlite {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const database = openSqliteDatabase(filePath)
  try {
    database.exec('pragma synchronous = full; pragma foreign_keys = on;')
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
