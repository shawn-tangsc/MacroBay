import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { openSqliteDatabase, SQLITE_BUSY_TIMEOUT_MS } from './openSqliteDatabase'

describe('openSqliteDatabase', () => {
  let root = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'macrobay-sqlite-open-'))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('opens writable databases in WAL with the shared busy timeout', () => {
    const database = openSqliteDatabase(join(root, 'writable.db'))

    try {
      expect(database.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(database.prepare('pragma busy_timeout').get()).toEqual({ timeout: SQLITE_BUSY_TIMEOUT_MS })
    } finally {
      database.close()
    }
  })

  it('keeps WAL and the timeout on every later open of the same file', () => {
    const path = join(root, 'reopened.db')
    const first = openSqliteDatabase(path)
    first.exec('create table t(x integer)')
    first.close()

    const second = openSqliteDatabase(path)
    try {
      expect(second.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'wal' })
      expect(second.prepare('pragma busy_timeout').get()).toEqual({ timeout: SQLITE_BUSY_TIMEOUT_MS })
    } finally {
      second.close()
    }
  })

  it('opens an in-memory database without pretending memory can be WAL', () => {
    const database = openSqliteDatabase(':memory:')

    try {
      expect(database.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'memory' })
      expect(database.prepare('pragma busy_timeout').get()).toEqual({ timeout: SQLITE_BUSY_TIMEOUT_MS })
    } finally {
      database.close()
    }
  })

  it('leaves the journal mode of a read-only connection untouched', () => {
    const path = join(root, 'read-only.db')
    const writer = openSqliteDatabase(path, { journalMode: 'preserve' })
    writer.exec('pragma journal_mode = delete; create table t(x integer)')
    writer.close()

    const reader = openSqliteDatabase(path, { readOnly: true })
    try {
      expect(reader.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'delete' })
      expect(reader.prepare('pragma busy_timeout').get()).toEqual({ timeout: SQLITE_BUSY_TIMEOUT_MS })
      expect(reader.prepare('select count(*) as count from t').get()).toEqual({ count: 0 })
    } finally {
      reader.close()
    }
  })

  it('sets the page size before switching a new file to WAL', () => {
    const database = openSqliteDatabase(join(root, 'page-size.db'), { pageSizeBytes: 8192 })

    try {
      expect(database.prepare('pragma page_size').get()).toEqual({ page_size: 8192 })
      expect(database.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'wal' })
    } finally {
      database.close()
    }
  })

  it('can keep the file journal mode when a connection must not rewrite the header', () => {
    const path = join(root, 'preserve.db')
    const created = openSqliteDatabase(path, { journalMode: 'preserve' })
    created.exec('create table t(x integer)')
    created.close()

    const reopened = openSqliteDatabase(path, { journalMode: 'preserve' })
    try {
      expect(reopened.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'delete' })
    } finally {
      reopened.close()
    }
  })

  it('makes a second writer wait for the lock instead of failing on SQLITE_BUSY', async () => {
    const path = join(root, 'contended.db')
    const setup = openSqliteDatabase(path)
    setup.exec('create table t(x integer)')
    setup.close()

    const holder = spawn(process.execPath, ['-e', holderScript(), path], {
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // 子进程先持写锁、再报告 locked，然后在 300ms 后提交退出；这样父进程的同步写入必须等它。
    holder.unref()
    await waitForLine(holder, 'locked')
    try {
      const zeroTimeout = openSqliteDatabase(path, { busyTimeoutMs: 0 })
      try {
        expect(() => zeroTimeout.exec('insert into t(x) values (1)')).toThrow(/SQLITE_BUSY|busy|locked/i)
      } finally {
        zeroTimeout.close()
      }

      const waiting = openSqliteDatabase(path)
      try {
        const startedAt = Date.now()
        waiting.exec('insert into t(x) values (2)')
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(150)
        expect(waiting.prepare('select count(*) as count from t').get()).toEqual({ count: 2 })
      } finally {
        waiting.close()
      }
    } finally {
      holder.kill()
    }
  })
})

function holderScript(): string {
  return `
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(process.argv[1])
    db.exec('pragma busy_timeout = 5000; begin immediate')
    db.prepare('insert into t(x) values (99)').run()
    process.stdout.write('locked\\n')
    setTimeout(() => { db.exec('commit'); db.close(); process.exit(0) }, 300)
  `
}

function waitForLine(child: ReturnType<typeof spawn>, line: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let buffered = ''
    let stderr = ''
    const timer = setTimeout(() => reject(new Error(`holder did not report ${line}; stderr=${stderr}`)), 5_000)
    child.stdout?.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8')
      if (buffered.includes(line)) {
        clearTimeout(timer)
        resolve()
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`holder exited before ${line} (code ${String(code)}); stderr=${stderr}`))
    })
  })
}
