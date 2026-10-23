import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMacroCalendarSqlite } from './macroCalendarSqlite'

afterEach(() => vi.restoreAllMocks())
describe('macro calendar SQLite connection owner', () => {
  it('owns WAL/foreign keys and preserves committed file data through an idempotent close', () => {
    const directory = mkdtempSync(join(tmpdir(), 'calendar-owner-'))
    try {
      const path = join(directory, 'calendar.sqlite')
      const owner = createMacroCalendarSqlite(path)
      const close = vi.spyOn(owner.database, 'close')
      expect(owner.database.prepare('pragma journal_mode').get()?.journal_mode).toBe('wal')
      expect(owner.database.prepare('pragma foreign_keys').get()?.foreign_keys).toBe(1)
      owner.database.exec('create table derived (value text); insert into derived values (\'kept\')')
      owner.close()
      expect(() => owner.close()).not.toThrow()
      expect(close).toHaveBeenCalledOnce()
      const reopened = createMacroCalendarSqlite(path)
      expect(reopened.database.prepare('select value from derived').get()?.value).toBe('kept')
      reopened.close()
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('closes once and surfaces checkpoint failure', () => {
    const owner = createMacroCalendarSqlite(':memory:')
    const close = vi.spyOn(owner.database, 'close')
    vi.spyOn(owner.database, 'exec').mockImplementation(() => { throw new Error('derived-checkpoint') })
    expect(() => owner.close()).toThrow('derived-checkpoint')
    expect(() => owner.close()).not.toThrow()
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes the connection when initial PRAGMA fails', () => {
    const close = vi.spyOn(DatabaseSync.prototype, 'close')
    vi.spyOn(DatabaseSync.prototype, 'exec').mockImplementation(() => { throw new Error('derived-pragma') })
    expect(() => createMacroCalendarSqlite(':memory:')).toThrow('derived-pragma')
    expect(close).toHaveBeenCalledOnce()
  })
})
