import { describe, expect, it, vi } from 'vitest'

import { createCacheGovernanceIpcHandlers } from './cacheGovernanceIpcHandlers'

describe('cache governance IPC handlers', () => {
  it('validates malformed payloads before calling the service', async () => {
    const handlers = createCacheGovernanceIpcHandlers({
      listCaches: async () => [],
      inspectCache: async () => {
        throw new Error('not used')
      },
      clearCache: async () => {
        throw new Error('clear should not be called')
      },
      compactCache: async () => {
        throw new Error('compact should not be called')
      },
      listOperations: async () => ({ records: [], nextCursor: null })
    } as never)

    await expect(handlers.clearCache({ cacheId: '' })).rejects.toThrow(/cacheId/)
    await expect(handlers.compactCache({ cacheId: 'platform.test', dryRun: 'yes' })).rejects.toThrow(/dryRun/)
    await expect(handlers.listOperations({ limit: 999 })).rejects.toThrow(/limit/)
  })

  it('forwards normalized storage requests to the service', async () => {
    const clearCache = vi.fn(async () => ({ status: 'succeeded' }))
    const listOperations = vi.fn(async () => ({ records: [], nextCursor: null }))
    const handlers = createCacheGovernanceIpcHandlers({
      listCaches: async () => [],
      inspectCache: async () => ({ cacheId: 'platform.test' }),
      clearCache,
      compactCache: async () => ({ status: 'succeeded' }),
      listOperations
    } as never)

    await handlers.clearCache({ cacheId: ' platform.test ', dryRun: true })
    await handlers.listOperations({ cacheId: ' platform.test ', limit: 20, cursor: null })

    expect(clearCache).toHaveBeenCalledWith('platform.test', { dryRun: true })
    expect(listOperations).toHaveBeenCalledWith({ cacheId: 'platform.test', limit: 20, cursor: undefined })
  })
})
