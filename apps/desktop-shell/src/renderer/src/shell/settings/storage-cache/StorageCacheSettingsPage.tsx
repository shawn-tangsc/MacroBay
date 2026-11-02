import { Button, Switch, message } from 'antd'
import { ChevronRight, RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { SafeCacheView } from '@platform/storage/cache-governance/cacheContracts'
import { LoadingState } from '@platform/ui/components/loading'
import { Segmented } from '@platform/ui/components/segmented'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { StorageCacheDetailDrawer } from './StorageCacheDetailDrawer'
import { StorageCacheOperationList } from './StorageCacheOperationList'
import { StorageCacheTable } from './StorageCacheTable'
import {
  formatBytes,
  getStorageCacheLabels
} from './storageCacheDisplay'
import { useStorageCacheSettings } from './useStorageCacheSettings'
import {
  buildStorageCacheSummary,
  confirmStorageCacheAction,
  filterCachesByKey,
  formatStorageOperationToast,
  listStorageCacheFilters,
  type StorageCacheFilterKey
} from './storageCacheViewModel'

type StorageCacheSettingsPageProps = {
  language: AppLanguage
}

const FILTER_KEY_PREFIX = 'storageCacheFilter.'
const SHELL_KEY_FOR_FILTER_GROUP = 'storageCacheFilterGroup'

export function StorageCacheSettingsPage({ language }: StorageCacheSettingsPageProps): React.ReactElement {
  const labels = getStorageCacheLabels(language)
  const state = useStorageCacheSettings()
  const [dryRun, setDryRun] = useState(false)
  const [activeFilter, setActiveFilter] = useState<StorageCacheFilterKey>('all')
  const [detailCacheId, setDetailCacheId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const filters = useMemo(() => listStorageCacheFilters(language), [language])
  // 分段器只收键：文案的唯一定义仍在 platformText，页面只负责把键解析回来。
  const filterItems = useMemo(
    () => filters.map((filter) => ({ value: filter.key, labelKey: `${FILTER_KEY_PREFIX}${filter.key}` })),
    [filters]
  )
  function resolveFilterText(key: string): string {
    if (key === SHELL_KEY_FOR_FILTER_GROUP) return labels.title
    const filterKey = key.slice(FILTER_KEY_PREFIX.length) as StorageCacheFilterKey
    return filters.find((filter) => filter.key === filterKey)?.label ?? ''
  }
  const filteredCaches = useMemo(
    () => filterCachesByKey(state.caches, activeFilter),
    [activeFilter, state.caches]
  )
  const summary = useMemo(() => buildStorageCacheSummary(state.caches), [state.caches])
  const detailCache = detailCacheId
    ? state.caches.find((cache) => cache.cacheId === detailCacheId) ?? null
    : null
  const detailRecords = useMemo(
    () => (detailCacheId ? state.operations.filter((record) => record.cacheId === detailCacheId) : []),
    [detailCacheId, state.operations]
  )

  async function runClear(cache: SafeCacheView): Promise<void> {
    const confirmed = confirmStorageCacheAction(
      { cache, operation: 'clear', dryRun },
      language,
      window.confirm.bind(window)
    )
    if (!confirmed) return
    try {
      const result = await state.clearCache(cache.cacheId, dryRun)
      message.success(formatStorageOperationToast(cache, result, language))
    } catch (error) {
      message.error(error instanceof Error ? error.message : labels.operationFailed)
    }
  }

  async function runCompact(cache: SafeCacheView): Promise<void> {
    const confirmed = confirmStorageCacheAction(
      { cache, operation: 'compact', dryRun },
      language,
      window.confirm.bind(window)
    )
    if (!confirmed) return
    try {
      const result = await state.compactCache(cache.cacheId, dryRun)
      message.success(formatStorageOperationToast(cache, result, language))
    } catch (error) {
      message.error(error instanceof Error ? error.message : labels.operationFailed)
    }
  }

  async function runRecheck(cache: SafeCacheView): Promise<void> {
    try {
      await state.inspectCache(cache.cacheId)
    } catch (error) {
      message.error(error instanceof Error ? error.message : labels.recheckFailed)
    }
  }

  return (
    <section className="settings-workspace storage-cache-settings">
      <div className="storage-cache-page">
        <header className="storage-cache-page-header">
          <div className="storage-cache-page-heading">
            <h1>{labels.title}</h1>
            <p>{labels.subtitle}</p>
          </div>
          <div className="storage-cache-page-actions">
            <label className="storage-cache-dry-run">
              <Switch size="small" checked={dryRun} onChange={setDryRun} />
              <span>{labels.dryRun}</span>
            </label>
            {dryRun ? <span className="storage-cache-dry-run-hint">{labels.dryRunHint}</span> : null}
            <Button
              className="ant-secondary-button"
              icon={<RotateCw size={14} />}
              onClick={() => void state.reload()}>
              {labels.refresh}
            </Button>
          </div>
        </header>

        {/*
         * 「刷新失败、旧数据还在」不是「读不到」：页面级错误态会把用户手里的旧表换成空白，
         * 等于用一次失败惩罚他。这里只说清「这是上次读到的数据」，并把重试留在原处。
         * 运行时原文（IPC 的 message）是给实现的证据，不进界面。
         */}
        {state.error && state.caches.length > 0 ? (
          <div className="storage-cache-error" role="status">
            <span>{labels.staleDataNotice}</span>
            <Button size="small" onClick={() => void state.reload()}>{labels.refresh}</Button>
          </div>
        ) : null}

        <div className="storage-cache-toolbar">
          <Segmented
            items={filterItems}
            value={activeFilter}
            onChange={(value) => setActiveFilter(value as StorageCacheFilterKey)}
            ariaLabelKey={SHELL_KEY_FOR_FILTER_GROUP}
            resolveText={(key) => resolveFilterText(key)}
          />
          <p className="storage-cache-meta">
            {labels.metaSummary(
              summary.totalCaches,
              formatBytes(summary.totalSizeBytes, labels.emptyValue),
              summary.clearableCaches,
              summary.sensitiveCaches
            )}
          </p>
        </div>

        {state.loading ? (
          <div className="storage-cache-placeholder">
            <LoadingState label={labels.loading} />
          </div>
        ) : state.caches.length === 0 ? (
          // The registry always has entries, so an empty list is a failed read, not "no caches yet":
          // it renders the shared error state with the retry that actually re-reads.
          <div className="storage-cache-placeholder">
            <StateView
              state="error"
              reasonCode="unreadable"
              size="md"
              action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void state.reload() }}
            />
          </div>
        ) : (
          <section className="storage-cache-panel">
            {filteredCaches.length === 0 ? (
              // 「有缓存、但被筛选挡住」不是「没有数据」：动作回到全部，而不是让用户对着空白猜。
              <StateView
                state="empty"
                reasonCode="filtered-out"
                size="sm"
                action={{ labelKey: STATE_VIEW_ACTION_KEYS.clear_filter, onSelect: () => setActiveFilter('all') }}
              />
            ) : (
              <StorageCacheTable
                language={language}
                labels={labels}
                caches={filteredCaches}
                onOpen={setDetailCacheId}
                onClear={(cache) => void runClear(cache)}
                onCompact={(cache) => void runCompact(cache)}
              />
            )}
          </section>
        )}

        <section className="storage-cache-panel storage-cache-history-panel">
          <button
            type="button"
            className="storage-cache-history-toggle"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen((current) => !current)}>
            <ChevronRight
              size={14}
              className={historyOpen ? 'storage-cache-chevron open' : 'storage-cache-chevron'}
            />
            <span>{labels.historyTitle}</span>
            <small>{state.operations.length}</small>
          </button>
          {historyOpen ? (
            <StorageCacheOperationList
              language={language}
              labels={labels}
              records={state.operations}
              caches={state.caches}
              showCacheName
            />
          ) : null}
        </section>
      </div>

      <StorageCacheDetailDrawer
        cache={detailCache}
        caches={state.caches}
        records={detailRecords}
        language={language}
        labels={labels}
        dryRun={dryRun}
        onClose={() => setDetailCacheId(null)}
        onRecheck={(cache) => void runRecheck(cache)}
        onClear={(cache) => void runClear(cache)}
        onCompact={(cache) => void runCompact(cache)}
      />
    </section>
  )
}
