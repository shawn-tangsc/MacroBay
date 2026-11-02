import { useEffect, useState } from 'react'

import type {
  CacheOperationPage,
  CacheOperationResult,
  SafeCacheView
} from '@platform/storage/cache-governance/cacheContracts'
import {
  beginRefresh,
  failRefresh,
  initialAsyncState,
  settle,
  type AsyncState
} from '@platform/ui/async/asyncState'

/**
 * 一次读取拿到的东西：缓存清单与它的操作记录。
 *
 * 两者来自同一屏、同一次刷新，所以放在一个快照里——分开存会让「表已经换了、记录还是上一次的」
 * 这种半新半旧的一帧真的出现在界面上。
 */
export type StorageCacheSnapshot = {
  caches: SafeCacheView[]
  operations: CacheOperationPage['records']
}

export type StorageCacheSettingsState = {
  /**
   * 读取的**生命周期**，不是三四个并列的布尔。`data` 只挂在 `ready` 上，所以每一条要画表格的
   * 分支都得先证明 `ready`——「首帧画错误」与「刷新时把表删掉」这两种写法在这里写不出来。
   */
  state: AsyncState<StorageCacheSnapshot>
  reload: () => Promise<void>
  inspectCache: (cacheId: string) => Promise<void>
  clearCache: (cacheId: string, dryRun?: boolean) => Promise<CacheOperationResult>
  compactCache: (cacheId: string, dryRun?: boolean) => Promise<CacheOperationResult>
}

async function readSnapshot(): Promise<StorageCacheSnapshot> {
  const [nextCaches, nextOperations] = await Promise.all([
    window.platform.storage.listCaches(),
    window.platform.storage.listCacheOperations({ limit: 20 })
  ])
  return {
    caches: nextCaches as SafeCacheView[],
    operations: (nextOperations as CacheOperationPage).records
  }
}

export function useStorageCacheSettings(): StorageCacheSettingsState {
  const [state, setState] = useState<AsyncState<StorageCacheSnapshot>>(initialAsyncState)

  /**
   * 刷新：**保留手上这一份**，只标 `refreshing`；失败时保留并标 `stale`，只有一次都没读到时
   * 才落到 `error`。这三个转移由平台实现一次，页面不再自己拼分支。
   */
  async function reload(): Promise<void> {
    setState((prev) => beginRefresh(prev))
    try {
      const snapshot = await readSnapshot()
      setState((prev) => settle(prev, snapshot))
    } catch {
      // 运行时原文（IPC 的 message）进不了状态：状态里只有原因码，句子由界面按码解析。
      setState((prev) => failRefresh(prev, 'unreadable'))
    }
  }

  async function inspectCache(cacheId: string): Promise<void> {
    const inspected = (await window.platform.storage.inspectCache(cacheId)) as SafeCacheView
    setState((prev) => {
      if (prev.status !== 'ready') return prev
      return settle(prev, {
        ...prev.data,
        caches: prev.data.caches.map((cache) => (cache.cacheId === inspected.cacheId ? inspected : cache))
      })
    })
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
    state,
    reload,
    inspectCache,
    clearCache,
    compactCache
  }
}
