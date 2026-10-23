import { useEffect, useState } from 'react'

import type {
  CacheOperationPage,
  CacheOperationResult,
  SafeCacheView
} from '@platform/storage/cache-governance/cacheContracts'

export type StorageCacheSettingsState = {
  loading: boolean
  error: string | null
  caches: SafeCacheView[]
  operations: CacheOperationPage['records']
  reload: () => Promise<void>
  inspectCache: (cacheId: string) => Promise<void>
  clearCache: (cacheId: string, dryRun?: boolean) => Promise<CacheOperationResult>
  compactCache: (cacheId: string, dryRun?: boolean) => Promise<CacheOperationResult>
}

export function useStorageCacheSettings(): StorageCacheSettingsState {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [caches, setCaches] = useState<SafeCacheView[]>([])
  const [operations, setOperations] = useState<CacheOperationPage['records']>([])

  async function reload(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const [nextCaches, nextOperations] = await Promise.all([
        window.platform.storage.listCaches(),
        window.platform.storage.listCacheOperations({ limit: 20 })
      ])
      setCaches(nextCaches as SafeCacheView[])
      setOperations((nextOperations as CacheOperationPage).records)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  async function inspectCache(cacheId: string): Promise<void> {
    const inspected = (await window.platform.storage.inspectCache(cacheId)) as SafeCacheView
    setCaches((current) => current.map((cache) => (cache.cacheId === inspected.cacheId ? inspected : cache)))
  }

  async function clearCache(cacheId: string, dryRun = false): Promise<CacheOperationResult> {
    const result = (await window.platform.storage.clearCache({ cacheId, dryRun })) as CacheOperationResult
    await reload()
    return result
  }

  async function compactCache(cacheId: string, dryRun = false): Promise<CacheOperationResult> {
    const result = (await window.platform.storage.compactCache({ cacheId, dryRun })) as CacheOperationResult
    await reload()
    return result
  }

  useEffect(() => {
    void reload()
  }, [])

  return {
    loading,
    error,
    caches,
    operations,
    reload,
    inspectCache,
    clearCache,
    compactCache
  }
}
