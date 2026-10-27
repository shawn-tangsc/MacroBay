import { Button, Empty, Switch, message } from 'antd'
import { ChevronRight, RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { SafeCacheView } from '@platform/storage/cache-governance/cacheContracts'
import { LoadingState } from '@platform/ui/components/loading'
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

export function StorageCacheSettingsPage({ language }: StorageCacheSettingsPageProps): React.ReactElement {
  const labels = getStorageCacheLabels(language)
  const state = useStorageCacheSettings()
  const [dryRun, setDryRun] = useState(false)
  const [activeFilter, setActiveFilter] = useState<StorageCacheFilterKey>('all')
  const [detailCacheId, setDetailCacheId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const filters = useMemo(() => listStorageCacheFilters(language), [language])
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

        {state.error ? (
          <div className="storage-cache-error">
            <span>{state.error}</span>
            <Button size="small" onClick={() => void state.reload()}>{labels.refresh}</Button>
          </div>
        ) : null}

        <div className="storage-cache-toolbar">
          <nav className="storage-cache-tabs" aria-label={labels.title}>
            {filters.map((filter) => (
              <button
                key={filter.key}
                type="button"
                aria-pressed={filter.key === activeFilter}
                className={filter.key === activeFilter ? 'storage-cache-tab active' : 'storage-cache-tab'}
                onClick={() => setActiveFilter(filter.key)}>
                {filter.label}
              </button>
            ))}
          </nav>
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
          <div className="storage-cache-placeholder">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={labels.noCaches} />
          </div>
        ) : (
          <section className="storage-cache-panel">
            {filteredCaches.length === 0 ? (
              <p className="storage-cache-muted storage-cache-filter-empty">{labels.filterEmpty}</p>
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
              emptyLabel={labels.historyEmpty}
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
