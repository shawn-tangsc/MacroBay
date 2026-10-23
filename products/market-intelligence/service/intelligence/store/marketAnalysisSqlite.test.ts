import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createMarketAnalysisSqlite, marketAnalysisSqlitePolicy } from './marketAnalysisSqlite'

let directory: string | undefined
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

describe('market analysis sqlite locking policy', () => {
  it('names a positive busy timeout, without which a concurrent writer fails a read instantly', () => {
    expect(Number.isSafeInteger(marketAnalysisSqlitePolicy.busyTimeoutMs)).toBe(true)
    expect(marketAnalysisSqlitePolicy.busyTimeoutMs).toBeGreaterThan(0)
  })

  it('applies that timeout to the product connection', async () => {
    directory = await mkdtemp(`${tmpdir()}/mi-sqlite-`)
    const store = createMarketAnalysisSqlite(join(directory, 'market-analysis.sqlite'))
    try {
      expect(store.database.prepare('pragma busy_timeout').get()).toEqual({ timeout: marketAnalysisSqlitePolicy.busyTimeoutMs })
      expect(store.database.prepare('pragma journal_mode').get()).toEqual({ journal_mode: 'wal' })
    } finally {
      store.close()
    }
  })
})
