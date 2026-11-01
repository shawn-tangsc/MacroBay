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

  it('fails fast without a timeout and waits until the holder commits with one', async () => {
    const path = join(root, 'contended.db')
    const setup = openSqliteDatabase(path)
    setup.exec('create table t(x integer)')
    setup.close()

    const holder = openSqliteDatabase(path)
    holder.exec('begin immediate')
    holder.prepare('insert into t(x) values (99)').run()
    const probes: ChildProbe[] = []
    try {
      // 1) 锁在父进程手里时，busy_timeout=0 的子进程必须立刻失败。这条没有任何时钟假设：
      //    锁在它开始写之前就已经被持有，所以它只能撞上 BUSY，不可能“等到了”。
      const impatient = startProbe(path, impatientScript)
      probes.push(impatient)
      const busyLine = await impatient.waitFor('busy:')
      expect(busyLine).toMatch(/locked|busy/i)

      // 2) 锁仍在父进程手里，再起一个默认 5000ms 的子进程。它报告 attempting 之后父进程才提交，
      //    之后它必须写入成功——「等了」由握手证明，不由时钟证明。
      const patient = startProbe(path, patientScript)
      probes.push(patient)
      await patient.waitFor('attempting')
      holder.exec('commit')
      await patient.waitFor('inserted')

      const [impatientExit, patientExit] = await Promise.all([impatient.exit(), patient.exit()])
      expect(impatientExit.code).toBe(0)
      expect(patientExit.code).toBe(0)

      expect(holder.prepare('select count(*) as count from t').get()).toEqual({ count: 2 })
    } finally {
      try {
        holder.exec('rollback')
      } catch {
        // 已提交或事务已结束：没有需要回滚的锁。
      }
      holder.close()
      for (const probe of probes) probe.kill()
    }
  }, 20_000)
})

const CHILD_START_BUDGET_MS = 20_000

const impatientScript = `
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(process.argv[1])
  db.exec('pragma busy_timeout = 0')
  try {
    db.exec('insert into t(x) values (1)')
    process.stdout.write('unexpected-success\\n')
  } catch (error) {
    process.stdout.write('busy:' + (error && error.message ? error.message : String(error)) + '\\n')
  }
  db.close()
`

const patientScript = `
  const { DatabaseSync } = require('node:sqlite')
  const db = new DatabaseSync(process.argv[1])
  db.exec('pragma busy_timeout = 5000')
  const statement = db.prepare('insert into t(x) values (2)')
  process.stdout.write('attempting\\n')
  statement.run()
  process.stdout.write('inserted\\n')
  db.close()
`

type ChildProbe = {
  /** 等到子进程输出某一行；超时信息带上两个流，失败时不用重跑才知道卡在哪。 */
  waitFor: (line: string) => Promise<string>
  exit: () => Promise<{ code: number | null; stderr: string }>
  kill: () => void
}

function startProbe(path: string, script: string): ChildProbe {
  const child = spawn(process.execPath, ['-e', script, path], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  const waiters = new Set<() => void>()

  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8')
    for (const notify of [...waiters]) notify()
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8')
  })
  const exit = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.on('exit', (code) => resolve({ code, stderr }))
  })

  return {
    waitFor(line) {
      return new Promise<string>((resolve, reject) => {
        const startedAt = Date.now()
        const check = (): boolean => {
          const at = stdout.indexOf(line)
          if (at === -1) return false
          waiters.delete(check)
          clearTimeout(timer)
          resolve(stdout.slice(at, stdout.indexOf('\n', at) === -1 ? undefined : stdout.indexOf('\n', at)))
          return true
        }
        const timer = setTimeout(() => {
          waiters.delete(check)
          reject(
            new Error(
              `child did not report "${line}" within ${CHILD_START_BUDGET_MS}ms; stdout=${JSON.stringify(stdout)} stderr=${JSON.stringify(stderr)}`
            )
          )
        }, CHILD_START_BUDGET_MS)
        if (!check()) waiters.add(check)
      })
    },
    exit: () => exit,
    kill() {
      if (child.exitCode === null && !child.killed) child.kill()
    }
  }
}
