import { mkdtempSync } from 'node:fs'
import { rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it } from 'vitest'

import {
  createSqliteCacheOperationAuditRepository,
  InMemoryCacheOperationAuditRepository
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
    try {
      const path = join(dir, 'cache-governance.sqlite')
      const first = createSqliteCacheOperationAuditRepository(path)
      await first.append(createRecord('one'))
      await first.append(createRecord('two', 'platform.second'))

      const reloaded = createSqliteCacheOperationAuditRepository(path)
      const page = await reloaded.listPage({ limit: 10 })

      expect(page.records.map((record) => record.operationId)).toEqual(['two', 'one'])
      expect(page.records[0]?.cacheId).toBe('platform.second')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

function createRecord(operationId: string, cacheId = 'platform.agent-runtime-compatibility') {
  return {
    operationId,
    cacheId,
    ownerType: 'platform' as const,
    ownerId: 'platform',
    operation: 'clear' as const,
    dryRun: false,
    requestedAt: `2026-07-12T10:00:0${operationId === 'one' ? '0' : '1'}.000Z`,
    completedAt: `2026-07-12T10:00:0${operationId === 'one' ? '0' : '1'}.500Z`,
    status: 'succeeded' as const
  }
}
