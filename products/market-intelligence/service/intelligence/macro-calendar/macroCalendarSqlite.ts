import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type MacroCalendarSqlite = { readonly database: DatabaseSync; readonly filePath: string; close: () => void }

export function createMacroCalendarSqlite(filePath: string): MacroCalendarSqlite {
  if (filePath !== ':memory:') mkdirSync(dirname(filePath), { recursive: true })
  const database = new DatabaseSync(filePath)
  try {
    database.exec('pragma journal_mode = wal; pragma foreign_keys = on;')
  } catch (error) {
    database.close()
    throw error
  }
  let closed = false
  return { database, filePath, close() {
    if (closed) return
    closed = true
    try { database.exec('pragma wal_checkpoint(truncate);') } finally { database.close() }
  } }
}
