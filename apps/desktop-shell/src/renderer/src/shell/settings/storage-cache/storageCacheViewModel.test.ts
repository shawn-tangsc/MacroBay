import { describe, expect, it } from 'vitest'

import type { SafeCacheView } from '@platform/storage/cache-governance/cacheContracts'
import { platformText } from '../../../i18n/platformText'
import {
  buildConfirmMessage,
  buildStorageCacheSummary,
  confirmStorageCacheAction,
  filterCachesByKey,
  formatStorageOperationErrorNotice,
  formatStorageOperationNotice,
  listStorageCacheFilters,
  resolveStorageCacheText,
  resolveStorageCacheWarnings,
  shouldConfirmCompact
} from './storageCacheViewModel'

describe('storageCacheViewModel', () => {
  it('filters caches by tabs and builds summary counts', () => {
    const caches = [
      createCache({ cacheId: 'platform.one', ownerType: 'platform', ownerId: 'platform', category: 'platform' }),
      createCache({ cacheId: 'platform.two', ownerType: 'platform', ownerId: 'platform', category: 'ai-runtime' }),
      createCache({ cacheId: 'product.one', ownerType: 'product', ownerId: 'sample-product', category: 'product' }),
      createCache({
        cacheId: 'derived.one',
        ownerType: 'platform',
        ownerId: 'platform',
        category: 'derived-data',
        sensitivity: 'contains-user-content',
        clearable: true,
        latestInspection: { cacheId: 'derived.one', status: 'ready', sizeBytes: 256 }
      })
    ]

    expect(filterCachesByKey(caches, 'product').map((cache) => cache.cacheId)).toEqual(['product.one'])
    expect(filterCachesByKey(caches, 'ai-runtime').map((cache) => cache.cacheId)).toEqual(['platform.two'])
    expect(buildStorageCacheSummary(caches)).toEqual({
      totalCaches: 4,
      clearableCaches: 4,
      sensitiveCaches: 1,
      totalSizeBytes: 256
    })
  })

  it('builds confirmation copy for sensitive clear and dry-run compact', () => {
    const cache = createCache({
      cacheId: 'derived.one',
      category: 'derived-data',
      sensitivity: 'contains-user-content'
    })

    const clearMessage = buildConfirmMessage({ cache, operation: 'clear', dryRun: false }, 'en-US')
    expect(clearMessage).toContain('Clear cache')
    expect(clearMessage).toContain('contains user content')

    const compactMessage = buildConfirmMessage({ cache, operation: 'compact', dryRun: true }, 'en-US')
    expect(compactMessage).toContain('Compact cache')
    expect(compactMessage).toContain('Dry run is enabled')
    expect(shouldConfirmCompact(cache)).toBe(true)
  })

  it('requires confirmation for clear and only for sensitive compact paths', () => {
    const sensitiveCache = createCache({
      displayName: 'Derived analysis cache',
      category: 'derived-data',
      sensitivity: 'contains-user-content',
      compactable: true
    })
    const regularCache = createCache({
      category: 'ai-runtime',
      sensitivity: 'none',
      compactable: true
    })

    const confirm = (message: string) => message.includes('Derived')

    expect(
      confirmStorageCacheAction(
        { cache: sensitiveCache, operation: 'clear', dryRun: false },
        'en-US',
        confirm
      )
    ).toBe(true)
    expect(
      confirmStorageCacheAction(
        { cache: sensitiveCache, operation: 'compact', dryRun: false },
        'en-US',
        confirm
      )
    ).toBe(true)
    expect(
      confirmStorageCacheAction(
        { cache: regularCache, operation: 'compact', dryRun: false },
        'en-US',
        () => false
      )
    ).toBe(true)
  })

  it('lists filter labels via i18n', () => {
    const filters = listStorageCacheFilters('zh-CN')

    expect(filters.map((filter) => filter.label)).toEqual(['全部', '平台', 'AI 运行时', '产品', '派生数据'])
  })

  it('resolves localized text, warnings, and toast copy', () => {
    const cache = createCache({
      displayName: 'Derived analysis cache',
      displayNameI18n: { 'zh-CN': '派生分析缓存', 'en-US': 'Derived analysis cache' },
      warnings: ['fallback warning'],
      warningsI18n: [{ 'zh-CN': '本地化警告', 'en-US': 'Localized warning' }],
      backupPolicy: 'exclude'
    })

    expect(resolveStorageCacheText(cache.displayName, cache.displayNameI18n, 'zh-CN')).toBe('派生分析缓存')
    expect(resolveStorageCacheWarnings(cache, 'zh-CN')).toEqual(['本地化警告'])
    expect(
      formatStorageOperationNotice(
        cache,
        {
          operationId: 'op-1',
          cacheId: cache.cacheId,
          operation: 'clear',
          dryRun: true,
          status: 'skipped'
        },
        'zh-CN'
      )
    ).toEqual({ tone: 'info', text: '“派生分析缓存”当前没有可执行变更' })
  })

  /**
   * 回归：失败**不许**显示成「已清理」。
   *
   * 旧实现先判 `skipped`、再按操作类型选句，于是 `failed` 落进 `toastCleared`。
   * 提示还是静默空操作时没人看得见；补丁让提示真能显示之后，这就是读者看到
   * 「清理失败」的缓存却收到「已清理」。
   */
  it('never renders a failed operation as a success sentence', () => {
    const cache = createCache({ displayNameI18n: { 'zh-CN': '派生分析缓存', 'en-US': 'Derived analysis cache' } })
    const labels = platformText['zh-CN'].storageCache

    const notice = formatStorageOperationNotice(
      cache,
      {
        operationId: 'op-2',
        cacheId: cache.cacheId,
        operation: 'clear',
        dryRun: false,
        status: 'failed',
        normalizedErrorCode: 'cache_runtime_active',
        // 运行时原文只进审计与日志：这句话一个字都不许出现在提示里。
        message: "ENOENT: no such file or directory, open '/Users/reader/Library/Caches/x.db'"
      },
      'zh-CN'
    )

    expect(notice.tone).toBe('danger')
    expect(notice.text).toBe(labels.operationFailedReason(labels.errorReasonRuntimeActive))
    expect(notice.text).not.toContain('ENOENT')
    expect(notice.text).not.toBe(labels.toastCleared('派生分析缓存', false))
  })

  it('says the reason was not available when the result carries no error code', () => {
    const cache = createCache()
    const labels = platformText['zh-CN'].storageCache

    const notice = formatStorageOperationNotice(
      cache,
      { operationId: 'op-3', cacheId: cache.cacheId, operation: 'compact', dryRun: false, status: 'failed' },
      'zh-CN'
    )

    expect(notice).toEqual({
      tone: 'danger',
      text: labels.operationFailedReason(labels.errorReasonUnavailable)
    })
  })

  it('keeps exception text off screen when the call itself throws', () => {
    const labels = platformText['zh-CN'].storageCache

    expect(formatStorageOperationErrorNotice('clear', 'zh-CN')).toEqual({
      tone: 'danger',
      text: labels.operationFailedReason(labels.errorReasonUnavailable)
    })
    expect(formatStorageOperationErrorNotice('recheck', 'zh-CN')).toEqual({
      tone: 'danger',
      text: labels.recheckFailedReason(labels.errorReasonUnavailable)
    })
  })
})

function createCache(overrides: Partial<SafeCacheView> = {}): SafeCacheView {
  return {
    cacheId: 'platform.agent-runtime-compatibility',
    ownerType: 'platform',
    ownerId: 'platform',
    displayName: 'Agent runtime compatibility',
    description: 'Probe cache',
    category: 'ai-runtime',
    cacheKind: 'json-file',
    durability: 'rebuildable',
    sensitivity: 'none',
    clearable: true,
    compactable: true,
    backupPolicy: 'exclude',
    warnings: [],
    ...overrides
  }
}
