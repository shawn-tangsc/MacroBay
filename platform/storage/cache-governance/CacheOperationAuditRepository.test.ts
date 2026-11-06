import { mkdtempSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  createSqliteCacheOperationAuditRepository,
  InMemoryCacheOperationAuditRepository,
  type CacheOperationAuditRepository
} from './CacheOperationAuditRepository'

describe('CacheOperationAuditRepository', () => {
  it('appends and pages records in memory', async () => {
    const repository = new InMemoryCacheOperationAuditRepository()
    await repository.append(createRecord('one'))
    await repository.append(createRecord('two'))

    const page = await repository.listPage({ limit: 1 })
    expect(page.records.map((record) => record.operationId)).toEqual(['two'])
    expect(page.nextCursor).toBeTruthy()
  })

  it('filters by cache and normalizes invalid cursors in memory', async () => {
    const repository = new InMemoryCacheOperationAuditRepository()
    await repository.append(createRecord('one', 'platform.first'))
    await repository.append(createRecord('two', 'platform.second'))

    const page = await repository.listPage({
      cacheId: 'platform.first',
      cursor: 'not-a-real-cursor',
      limit: 10
    })
    expect(page.records.map((record) => record.cacheId)).toEqual(['platform.first'])
  })

  it('persists audit history across sqlite repository re-creation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-audit-'))
    let first: CacheOperationAuditRepository | undefined
    let reloaded: CacheOperationAuditRepository | undefined
    try {
      const path = join(dir, 'cache-governance.sqlite')
      first = createSqliteCacheOperationAuditRepository(path)
      await first.append(createRecord('one'))
      await first.append(createRecord('two', 'platform.second'))

      reloaded = createSqliteCacheOperationAuditRepository(path)
      const page = await reloaded.listPage({ limit: 10 })

      expect(page.records.map((record) => record.operationId)).toEqual(['two', 'one'])
      expect(page.records[0]?.cacheId).toBe('platform.second')
    } finally {
      // 先关句柄再删目录：Windows 不许 unlink 还开着的文件，关闭时 SQLite 也会清掉 -wal / -shm。
      first?.close()
      reloaded?.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prunes by age and by count in memory (MI-11-R16: the table used to only grow)', async () => {
    const repository = new InMemoryCacheOperationAuditRepository()
    await repository.append(createRecord('old', 'platform.first', '2025-01-01T00:00:00.000Z'))
    await repository.append(createRecord('mid', 'platform.first', '2026-11-02T00:00:00.000Z'))
    await repository.append(createRecord('new', 'platform.first', '2026-11-03T00:00:00.000Z'))

    const result = await repository.prune({ now: '2026-11-04T00:00:00.000Z', maxRecords: 1 })

    expect(result).toEqual({ removedByAge: 1, removedByCount: 1 })
    const page = await repository.listPage({ limit: 10 })
    expect(page.records.map((record) => record.operationId)).toEqual(['new'])
  })

  it('prunes the sqlite table so a re-created repository no longer reads the removed rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-audit-prune-'))
    let repository: CacheOperationAuditRepository | undefined
    let reloaded: CacheOperationAuditRepository | undefined
    try {
      const path = join(dir, 'cache-governance.sqlite')
      repository = createSqliteCacheOperationAuditRepository(path)
      await repository.append(createRecord('old', 'platform.first', '2025-01-01T00:00:00.000Z'))
      await repository.append(createRecord('a', 'platform.first', '2026-11-02T00:00:00.000Z'))
      await repository.append(createRecord('b', 'platform.first', '2026-11-03T00:00:00.000Z'))

      const result = await repository.prune({ now: '2026-11-04T00:00:00.000Z', maxRecords: 1 })
      expect(result).toEqual({ removedByAge: 1, removedByCount: 1 })

      // 重新打开同一个文件：删掉的行必须真的不在了，而不是只从内存视图里消失。
      reloaded = createSqliteCacheOperationAuditRepository(path)
      const page = await reloaded.listPage({ limit: 10 })
      expect(page.records.map((record) => record.operationId)).toEqual(['b'])
    } finally {
      repository?.close()
      reloaded?.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('closes the sqlite handle so the directory can be removed, and closing twice is safe', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-audit-close-'))
    const path = join(dir, 'cache-governance.sqlite')
    const repository = createSqliteCacheOperationAuditRepository(path)
    await repository.append(createRecord('one'))
    repository.close()
    repository.close()

    // 关闭之后再打开同一路径仍然读得到已提交的行：close 不是「丢数据」，只是放掉句柄。
    const reopened = createSqliteCacheOperationAuditRepository(path)
    try {
      expect((await reopened.listPage({ limit: 10 })).records.map((entry) => entry.operationId)).toEqual(['one'])
    } finally {
      reopened.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('is idempotent: pruning twice removes nothing the second time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cache-audit-idempotent-'))
    let repository: CacheOperationAuditRepository | undefined
    try {
      repository = createSqliteCacheOperationAuditRepository(join(dir, 'cache-governance.sqlite'))
      await repository.append(createRecord('a', 'platform.first', '2026-11-02T00:00:00.000Z'))

      await repository.prune({ now: '2026-11-04T00:00:00.000Z' })
      expect(await repository.prune({ now: '2026-11-04T00:00:00.000Z' })).toEqual({
        removedByAge: 0,
        removedByCount: 0
      })
    } finally {
      repository?.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function createRecord(
  operationId: string,
  cacheId = 'platform.agent-runtime-compatibility',
  requestedAt = '2026-07-12T00:00:00.000Z'
) {
  return {
    operationId,
    cacheId,
    ownerType: 'platform' as const,
    ownerId: 'platform',
    operation: 'clear' as const,
    dryRun: false,
    requestedAt,
    completedAt: `2026-07-12T10:00:0${operationId === 'one' ? '0' : '1'}.500Z`,
    status: 'succeeded' as const
  }
}
