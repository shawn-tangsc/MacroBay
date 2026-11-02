import { Button, Switch } from 'antd'
import { ChevronRight, RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { SafeCacheView } from '@platform/storage/cache-governance/cacheContracts'
import { LoadingState } from '@platform/ui/components/loading'
import { Segmented } from '@platform/ui/components/segmented'
import { useToast } from '@platform/ui/components/toast'
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
  formatStorageOperationErrorNotice,
  formatStorageOperationNotice,
  listStorageCacheFilters,
  STORAGE_CACHE_RETRY_ACTION_KEY,
  type StorageCacheFilterKey,
  type StorageOperationNotice
} from './storageCacheViewModel'

type StorageCacheSettingsPageProps = {
  language: AppLanguage
}

/**
 * 过滤项的键是**字面量表**，不是 `前缀 + 变量`：拼串在静态守卫眼里看不见形状，
 * 界面上就会显示成键名；而换成表之后，多一个筛选项就编译不过。
 */
const FILTER_LABEL_KEYS: Record<StorageCacheFilterKey, string> = {
  all: 'storageCacheFilter.all',
  platform: 'storageCacheFilter.platform',
  'ai-runtime': 'storageCacheFilter.ai-runtime',
  product: 'storageCacheFilter.product',
  'derived-data': 'storageCacheFilter.derived-data'
}
const SHELL_KEY_FOR_FILTER_GROUP = 'storageCacheFilterGroup'

type StorageToastRetry = { label: string; onSelect: () => void }

/**
 * 危险提示上那个动作：重跑**同一个入口**（会再走一次确认），文字就是它要做的那件事。
 * 成功与提示档不消费它——两档都没有槽放动作。
 */
function retryOf(
  cache: SafeCacheView,
  run: (target: SafeCacheView) => Promise<void>,
  label: string
): StorageToastRetry {
  return { label, onSelect: () => void run(cache) }
}

export function StorageCacheSettingsPage({ language }: StorageCacheSettingsPageProps): React.ReactElement {
  const labels = getStorageCacheLabels(language)
  const toast = useToast()
  const state = useStorageCacheSettings()
  const [dryRun, setDryRun] = useState(false)
  const [activeFilter, setActiveFilter] = useState<StorageCacheFilterKey>('all')
  const [detailCacheId, setDetailCacheId] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)

  const filters = useMemo(() => listStorageCacheFilters(language), [language])
  // 分段器只收键：文案的唯一定义仍在 platformText，页面只负责把键解析回来。
  const filterItems = useMemo(
    () => filters.map((filter) => ({ value: filter.key, labelKey: FILTER_LABEL_KEYS[filter.key] })),
    [filters]
  )
  function resolveFilterText(key: string): string {
    if (key === SHELL_KEY_FOR_FILTER_GROUP) return labels.title
    return filters.find((filter) => FILTER_LABEL_KEYS[filter.key] === key)?.label ?? ''
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

  /**
   * 提示的**唯一出口**：平台 `Toast`（右下角、最多两条、悬停暂停、成功 3s / 失败 6s）。
   *
   * 键和句子一起交：`Toast` 只收键，句子在入队时由这个解析器解成快照，所以宿主不认识
   * `storageCache.*` 也不需要认识。**未知键返回空串**、不回退键名——回退会把键名念给读者。
   */
  function notify(notice: StorageOperationNotice, retry: StorageToastRetry): void {
    const resolveText = (key: string): string => {
      if (key === notice.titleKey) return notice.title
      if (notice.reasonKey !== undefined && key === notice.reasonKey) return notice.reason ?? ''
      if (key === STORAGE_CACHE_RETRY_ACTION_KEY) return retry.label
      return ''
    }
    if (notice.tone === 'success') {
      toast.success({ titleKey: notice.titleKey, resolveText })
      return
    }
    if (notice.tone === 'info') {
      toast.info({ titleKey: notice.titleKey, resolveText })
      return
    }
    // 危险档在类型上强制带动作：按钮上写的就是它要做的那件事（清理 / 压缩 / 重新检查），
    // 点了走同一个入口，重跑一次确认流程，不在这里另造一条旁路。
    toast.danger({
      titleKey: notice.titleKey,
      ...(notice.reasonKey === undefined ? {} : { descKey: notice.reasonKey }),
      resolveText,
      action: { labelKey: STORAGE_CACHE_RETRY_ACTION_KEY, onSelect: retry.onSelect }
    })
  }

  async function runClear(cache: SafeCacheView): Promise<void> {
    const confirmed = confirmStorageCacheAction(
      { cache, operation: 'clear', dryRun },
      language,
      window.confirm.bind(window)
    )
    if (!confirmed) return
    try {
      const result = await state.clearCache(cache.cacheId, dryRun)
      notify(formatStorageOperationNotice(cache, result, language), retryOf(cache, runClear, labels.clear))
    } catch {
      // 原文（可能是 `ENOENT: no such file or directory…`）只该进日志，不上屏。
      notify(formatStorageOperationErrorNotice('clear', language), retryOf(cache, runClear, labels.clear))
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
      notify(formatStorageOperationNotice(cache, result, language), retryOf(cache, runCompact, labels.compact))
    } catch {
      notify(formatStorageOperationErrorNotice('compact', language), retryOf(cache, runCompact, labels.compact))
    }
  }

  async function runRecheck(cache: SafeCacheView): Promise<void> {
    try {
      await state.inspectCache(cache.cacheId)
    } catch {
      notify(formatStorageOperationErrorNotice('recheck', language), retryOf(cache, runRecheck, labels.recheck))
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
