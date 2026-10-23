import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { platformText } from '../../../i18n/platformText'
import { StorageCacheSettingsPage } from './StorageCacheSettingsPage'

const inspectCache = vi.fn(async () => undefined)
const clearCache = vi.fn(async () => ({
  operationId: 'op-1',
  cacheId: 'derived.cache',
  operation: 'clear' as const,
  dryRun: true,
  status: 'skipped' as const
}))
const compactCache = vi.fn(async () => ({
  operationId: 'op-2',
  cacheId: 'derived.cache',
  operation: 'compact' as const,
  dryRun: true,
  status: 'skipped' as const
}))

const caches = [
  {
    cacheId: 'platform.agent-runtime-compatibility',
    ownerType: 'platform' as const,
    ownerId: 'platform',
    displayName: 'Agent runtime compatibility',
    displayNameI18n: { 'zh-CN': 'Agent 运行时兼容性', 'en-US': 'Agent runtime compatibility' },
    description: 'Probe cache',
    descriptionI18n: { 'zh-CN': '探测缓存', 'en-US': 'Probe cache' },
    category: 'ai-runtime' as const,
    cacheKind: 'json-file' as const,
    durability: 'rebuildable' as const,
    sensitivity: 'none' as const,
    clearable: true,
    compactable: false,
    backupPolicy: 'metadata-only' as const,
    warnings: ['warning'],
    latestInspection: {
      cacheId: 'platform.agent-runtime-compatibility',
      status: 'ready' as const,
      recordCount: 2,
      sizeBytes: 128,
      lastUpdatedAt: '2026-07-12T00:00:00.000Z'
    }
  },
  {
    cacheId: 'derived.cache',
    ownerType: 'product' as const,
    ownerId: 'sample-product',
    displayName: 'Derived analysis cache',
    displayNameI18n: { 'zh-CN': '派生分析缓存', 'en-US': 'Derived analysis cache' },
    description: 'Derived AI results',
    descriptionI18n: { 'zh-CN': '派生 AI 结果', 'en-US': 'Derived AI results' },
    category: 'derived-data' as const,
    cacheKind: 'sqlite-derived' as const,
    durability: 'persisted-derived' as const,
    sensitivity: 'contains-user-content' as const,
    clearable: true,
    compactable: true,
    backupPolicy: 'exclude' as const,
    warnings: ['Contains derived assistant output', 'Contains derived assistant output'],
    warningsI18n: [
      { 'zh-CN': '包含派生助手输出', 'en-US': 'Contains derived assistant output' },
      { 'zh-CN': '包含派生助手输出', 'en-US': 'Contains derived assistant output' }
    ],
    latestInspection: {
      cacheId: 'derived.cache',
      status: 'ready' as const,
      recordCount: 12,
      sizeBytes: 1024,
      lastUpdatedAt: '2026-07-12T00:00:02.000Z'
    }
  }
]

vi.mock('./useStorageCacheSettings', () => ({
  useStorageCacheSettings: () => ({
    loading: false,
    error: null,
    caches,
    operations: [
      {
        operationId: 'op-1',
        cacheId: 'derived.cache',
        ownerType: 'product',
        ownerId: 'sample-product',
        operation: 'clear',
        dryRun: true,
        requestedAt: '2026-07-12T00:00:00.000Z',
        completedAt: '2026-07-12T00:00:01.000Z',
        status: 'skipped'
      }
    ],
    reload: async () => undefined,
    inspectCache,
    clearCache,
    compactCache
  })
}))

describe('Storage and Cache settings UI', () => {
  beforeEach(() => {
    inspectCache.mockClear()
    clearCache.mockClear()
    compactCache.mockClear()
  })

  it('renders one summary line, the cache table, and only available row actions', () => {
    const labels = platformText['en-US'].storageCache
    const markup = renderToStaticMarkup(<StorageCacheSettingsPage language="en-US" />)

    expect(markup).toContain(labels.title)
    expect(markup).toContain(labels.subtitle)
    expect(markup).toContain(labels.metaSummary(2, '1.1 KB', 2, 1))
    for (const header of [
      labels.columnName,
      labels.columnSize,
      labels.columnRecords,
      labels.columnStatus,
      labels.columnUpdated,
      labels.columnActions
    ]) {
      expect(markup).toContain(header)
    }

    expect(markup).toContain('Agent runtime compatibility')
    expect(markup).toContain('Derived analysis cache')
    expect(markup).toContain('storage-cache-table')
    expect(markup).toContain(labels.dryRun)
    expect(markup).not.toContain(labels.dryRunHint)
    expect(markup).toContain(labels.flagSensitive)
    expect(markup).toContain(labels.clear)
    expect(markup).toContain(labels.compact)
    expect(markup).toContain(labels.historyTitle)
    // History stays collapsed until the user opens it.
    expect(markup).not.toContain('class="storage-cache-history"')
    expect(markup).not.toContain('Unsupported')
  })

  it('prefers localized cache text in zh-CN', () => {
    const labels = platformText['zh-CN'].storageCache
    const markup = renderToStaticMarkup(<StorageCacheSettingsPage language="zh-CN" />)

    expect(markup).toContain('派生分析缓存')
    expect(markup).toContain('Agent 运行时兼容性')
    expect(markup).toContain(labels.metaSummary(2, '1.1 KB', 2, 1))
    expect(markup).not.toContain('Derived analysis cache')
  })
})
