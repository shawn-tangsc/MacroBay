import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type {
  CacheOperationAuditRecord,
  SafeCacheView
} from '@platform/storage/cache-governance/cacheContracts'
import { platformText } from '../../../i18n/platformText'
import { StorageCacheOperationList } from './StorageCacheOperationList'

const knownCache: SafeCacheView = {
  cacheId: 'derived.cache',
  ownerType: 'product',
  ownerId: 'sample-product',
  displayName: 'Derived analysis cache',
  displayNameI18n: { 'zh-CN': '派生分析缓存', 'en-US': 'Derived analysis cache' },
  description: 'Derived AI results',
  category: 'derived-data',
  cacheKind: 'sqlite-derived',
  durability: 'persisted-derived',
  sensitivity: 'contains-user-content',
  clearable: true,
  compactable: true,
  backupPolicy: 'exclude',
  warnings: []
}

const records: CacheOperationAuditRecord[] = [
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
  },
  {
    // 这条记录的缓存已经不在注册表里：历史必须还能看懂，但不能把内部点分 id 印给读者。
    operationId: 'op-2',
    cacheId: 'platform.agent-runtime-retired',
    ownerType: 'platform',
    ownerId: 'platform',
    operation: 'compact',
    dryRun: false,
    requestedAt: '2026-07-11T00:00:00.000Z',
    completedAt: '2026-07-11T00:00:01.000Z',
    status: 'succeeded'
  }
]

function renderHistory(language: 'zh-CN' | 'en-US'): string {
  return renderToStaticMarkup(
    <StorageCacheOperationList
      language={language}
      labels={platformText[language].storageCache}
      records={records}
      caches={[knownCache]}
      showCacheName
    />
  )
}

describe('Storage cache operation history', () => {
  it('never prints an internal cache id for a cache that is no longer registered', () => {
    const labels = platformText['en-US'].storageCache
    const markup = renderHistory('en-US')

    // 查得到名字的那一行照旧显示名字——这条路径是对的，别改。
    expect(markup).toContain('Derived analysis cache')
    // 查不到名字时给中性说法，绝不印 'platform.agent-runtime-retired' 这种内部 id。
    expect(markup).not.toContain('platform.agent-runtime-retired')
    expect(markup).toContain(labels.historyUnknownCache)
  })

  it('resolves the neutral cache label in Chinese too', () => {
    const labels = platformText['zh-CN'].storageCache
    const markup = renderHistory('zh-CN')

    expect(markup).not.toContain('platform.agent-runtime-retired')
    expect(markup).toContain(labels.historyUnknownCache)
    expect(markup).toContain('派生分析缓存')
  })
})
