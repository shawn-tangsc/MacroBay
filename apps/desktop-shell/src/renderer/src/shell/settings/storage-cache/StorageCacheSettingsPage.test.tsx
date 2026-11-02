import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellLanguageProvider } from '@platform/ui/shell/ShellLanguageContext'
import { ToastHost } from '@platform/ui/components/toast'
import { resolveStateViewText, STATE_VIEW_ACTION_KEYS, stateViewTextKeys } from '@platform/ui/components/state'
import { platformText } from '../../../i18n/platformText'
import { StorageCacheSettingsPage } from './StorageCacheSettingsPage'

/** Mutable so a test can render the same page in its failed-read state. */
const mockFeed = vi.hoisted(() => ({
  loading: false,
  error: null as string | null,
  caches: [] as unknown[]
}))

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
    backupPolicy: 'exclude' as const,
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
    loading: mockFeed.loading,
    error: mockFeed.error,
    caches: mockFeed.caches,
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
    mockFeed.loading = false
    mockFeed.error = null
    mockFeed.caches = caches
    inspectCache.mockClear()
    clearCache.mockClear()
    compactCache.mockClear()
  })

  it('renders one summary line, the cache table, and only available row actions', () => {
    const labels = platformText['en-US'].storageCache
    const markup = renderToStaticMarkup(
      <ToastHost>
        <StorageCacheSettingsPage language="en-US" />
      </ToastHost>
    )

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
    const markup = renderToStaticMarkup(
      <ToastHost>
        <StorageCacheSettingsPage language="zh-CN" />
      </ToastHost>
    )

    expect(markup).toContain('派生分析缓存')
    expect(markup).toContain('Agent 运行时兼容性')
    expect(markup).toContain(labels.metaSummary(2, '1.1 KB', 2, 1))
    expect(markup).not.toContain('Derived analysis cache')
  })
  it('renders an empty list as a failed read and offers the retry that re-reads', () => {
    // The registry always has entries, so no rows means the read failed; it must not say "none yet".
    mockFeed.caches = []
    const markup = renderToStaticMarkup(
      <ToastHost>
        <ShellLanguageProvider language="en-US">
          <StorageCacheSettingsPage language="en-US" />
        </ShellLanguageProvider>
      </ToastHost>
    )

    expect(markup).toContain('data-state="error"')
    expect(markup).toContain('data-state-icon="error"')
    expect(markup).toContain(resolveStateViewText('en-US', stateViewTextKeys('error', 'unreadable').reason))
    expect(markup).toContain(resolveStateViewText('en-US', STATE_VIEW_ACTION_KEYS.retry))
    expect(markup).not.toContain('data-state="empty"')
  })

  it('shows only the loading state before the first read completes', () => {
    // 首次进入：读还没回来，屏幕上不许出现错误或空态——空态是「确实没有」，不是「还没读到」。
    mockFeed.loading = true
    mockFeed.caches = []
    mockFeed.error = null
    const labels = platformText['en-US'].storageCache
    const markup = renderToStaticMarkup(
      <ToastHost>
        <ShellLanguageProvider language="en-US">
          <StorageCacheSettingsPage language="en-US" />
        </ShellLanguageProvider>
      </ToastHost>
    )

    expect(markup).toContain(labels.loading)
    expect(markup).not.toContain('data-state="error"')
    expect(markup).not.toContain('data-state="empty"')
    expect(markup).not.toContain(labels.staleDataNotice)
  })

  it('keeps the rows visible while a refresh is still running', () => {
    // 手里已经有读数时，刷新期间不许把表格换成加载块：那会让表格闪一下消失再回来。
    mockFeed.loading = true
    mockFeed.caches = caches
    const labels = platformText['en-US'].storageCache
    const markup = renderToStaticMarkup(
      <ToastHost>
        <ShellLanguageProvider language="en-US">
          <StorageCacheSettingsPage language="en-US" />
        </ShellLanguageProvider>
      </ToastHost>
    )

    expect(markup).toContain('Derived analysis cache')
    expect(markup).toContain('storage-cache-table')
    expect(markup).not.toContain(labels.loading)
    expect(markup).not.toContain('data-state="error"')
  })

  it('keeps the last rows when a refresh fails, and says they are stale', () => {
    // 「拿到新的失败」不等于「没有数据」：把旧表换成页面级空态，等于用一次刷新失败惩罚用户。
    const labels = platformText['en-US'].storageCache
    mockFeed.error = 'Error invoking remote method platform-unavailable'
    const markup = renderToStaticMarkup(
      <ToastHost>
        <ShellLanguageProvider language="en-US">
          <StorageCacheSettingsPage language="en-US" />
        </ShellLanguageProvider>
      </ToastHost>
    )

    // 旧表仍在
    expect(markup).toContain('Derived analysis cache')
    expect(markup).toContain('storage-cache-table')
    // 说清是「上次读到的」，不是「读不到」
    expect(markup).toContain(labels.staleDataNotice)
    expect(markup).not.toContain('data-state="error"')
    // 运行时原文（IPC message）是给实现的证据，不进界面
    expect(markup).not.toContain('platform-unavailable')
  })
})
