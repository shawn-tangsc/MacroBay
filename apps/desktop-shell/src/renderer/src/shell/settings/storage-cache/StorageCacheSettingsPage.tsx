import { Button, Switch } from 'antd'
import { RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'

import type { ErrorReasonCode } from '@platform/contracts/queryOutcome'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { SafeCacheView } from '@platform/storage/cache-governance/cacheContracts'
import { LoadingState } from '@platform/ui/components/loading'
import { Segmented } from '@platform/ui/components/segmented'
import { useToast } from '@platform/ui/components/toast'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { CollapsibleGroup } from '@platform/ui/components/collapsible-group'

import { SettingInfoPopover } from '../SettingInfoPopover'
import { QuarantineCopyList } from './QuarantineCopyList'
import { StorageCacheDetailDrawer } from './StorageCacheDetailDrawer'
import { StorageCacheOperationList } from './StorageCacheOperationList'
import { StorageCacheTable } from './StorageCacheTable'
import {
  formatBytes,
  getStorageCacheLabels
} from './storageCacheDisplay'
import { useQuarantineCopies } from './useQuarantineCopies'
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
 *
 * `requestDryRun` 是**发起那次操作时**的模式，不是点击重试那一刻的开关状态：读者看到「预演失败」
 * 之后把开关关掉再点重试，重试仍必须是预演——否则同一次重试会突然变成真删。
 */
function retryOf(
  cache: SafeCacheView,
  run: (target: SafeCacheView, requestDryRun: boolean) => Promise<void>,
  label: string,
  requestDryRun = false
): StorageToastRetry {
  return { label, onSelect: () => void run(cache, requestDryRun) }
}

/**
 * 区域级错误只有四档；`page-load-failed` 说的是「整个页面没起来」，它的动作是重载页面，
 * `notification-unknown` 是通知中心的「状态不明」，`render-failed` 是整块界面画不出来（出口是重试 / 重载），
 * 三者都不属于这一块。真到了这里就按「这次没读到」显示——这个面板能给的只有重试。
 */
function regionErrorReasonCode(
  reasonCode: ErrorReasonCode
): 'unreadable' | 'unavailable' | 'operation-failed' | 'needs-restart' {
  return reasonCode === 'page-load-failed' || reasonCode === 'notification-unknown' || reasonCode === 'render-failed'
    ? 'unreadable'
    : reasonCode
}

export function StorageCacheSettingsPage({ language }: StorageCacheSettingsPageProps): React.ReactElement {
  const labels = getStorageCacheLabels(language)
  const toast = useToast()
  const { state, reload, inspectCache, clearCache, compactCache } = useStorageCacheSettings()
  // 隔离副本单独一条读取：缓存巡检失败不该把这一块的结论也变成「读不到」，反之亦然。
  const quarantine = useQuarantineCopies()
  // `data` 只在 `ready` 上，所以下面每一处用到行数据的地方都先证明它——这正是类型要的。
  const snapshot = state.status === 'ready' ? state.data : null
  const caches = snapshot?.caches ?? []
  const operations = snapshot?.operations ?? []
  const [dryRun, setDryRun] = useState(false)
  const [activeFilter, setActiveFilter] = useState<StorageCacheFilterKey>('all')
  const [detailCacheId, setDetailCacheId] = useState<string | null>(null)

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
  const filteredCaches = useMemo(() => filterCachesByKey(caches, activeFilter), [activeFilter, caches])
  const summary = useMemo(() => buildStorageCacheSummary(caches), [caches])
  const detailCache = detailCacheId
    ? caches.find((cache) => cache.cacheId === detailCacheId) ?? null
    : null
  const detailRecords = useMemo(
    () => (detailCacheId ? operations.filter((record) => record.cacheId === detailCacheId) : []),
    [detailCacheId, operations]
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

  async function runClear(cache: SafeCacheView, requestDryRun: boolean = dryRun): Promise<void> {
    const confirmed = confirmStorageCacheAction(
      { cache, operation: 'clear', dryRun: requestDryRun },
      language,
      window.confirm.bind(window)
    )
    if (!confirmed) return
    try {
      const result = await clearCache(cache.cacheId, requestDryRun)
      notify(formatStorageOperationNotice(cache, result, language), retryOf(cache, runClear, labels.clear, requestDryRun))
    } catch {
      // 原文（可能是 `ENOENT: no such file or directory…`）只该进日志，不上屏。
      notify(formatStorageOperationErrorNotice('clear', language), retryOf(cache, runClear, labels.clear, requestDryRun))
    }
  }

  async function runCompact(cache: SafeCacheView, requestDryRun: boolean = dryRun): Promise<void> {
    const confirmed = confirmStorageCacheAction(
      { cache, operation: 'compact', dryRun: requestDryRun },
      language,
      window.confirm.bind(window)
    )
    if (!confirmed) return
    try {
      const result = await compactCache(cache.cacheId, requestDryRun)
      notify(formatStorageOperationNotice(cache, result, language), retryOf(cache, runCompact, labels.compact, requestDryRun))
    } catch {
      notify(formatStorageOperationErrorNotice('compact', language), retryOf(cache, runCompact, labels.compact, requestDryRun))
    }
  }

  async function runRecheck(cache: SafeCacheView): Promise<void> {
    try {
      await inspectCache(cache.cacheId)
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
              <Switch checked={dryRun} onChange={setDryRun} />
              <span>{labels.dryRun}</span>
            </label>
            {dryRun ? <span className="storage-cache-dry-run-hint">{labels.dryRunHint}</span> : null}
            <Button
              className="ant-secondary-button"
              icon={<RotateCw size={14} />}
              // 页头那颗刷新同时重读隔离副本：它就在同一屏上，只刷一半会让两块各说一次「最新」。
              onClick={() => { void reload(); void quarantine.reload() }}>
              {labels.refresh}
            </Button>
          </div>
        </header>

        {/*
         * 「刷新失败、旧数据还在」不是「读不到」：页面级错误态会把用户手里的旧表换成空白，
         * 等于用一次失败惩罚他。这里只说清「这是上次读到的数据」，并把重试留在原处。
         * 运行时原文（IPC 的 message）是给实现的证据，不进界面。
         */}
        {state.status === 'ready' && state.stale === true ? (
          <div className="storage-cache-error" role="status">
            <span>{labels.staleDataNotice}</span>
            <Button onClick={() => void reload()}>{labels.refresh}</Button>
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
          {/*
           * 汇总行只在 `ready` 上出现：还没读到的时候它会把「0 个缓存 · 总计 0 B」画成事实，
           * 而注册表恒有条目——那是「还没读到」被写成了「什么都没有」。
           */}
          {state.status === 'ready' && caches.length > 0 ? (
            <p className="storage-cache-meta">
              {labels.metaSummary(
                summary.totalCaches,
                formatBytes(summary.totalSizeBytes, labels.emptyValue),
                summary.clearableCaches,
                summary.sensitiveCaches
              )}
            </p>
          ) : null}
        </div>

        {/*
         * 只有「还没有任何数据」时才整块显示加载中：手里已经有旧读数时再转圈，
         * 用户会看到表格闪一下消失再回来——那是「等待」被画成了「丢了又找回」。
         */}
        {state.status === 'loading' ? (
          <div className="storage-cache-placeholder">
            <LoadingState label={labels.loading} />
          </div>
        ) : caches.length === 0 ? (
          // The registry always has entries, so an empty list is a failed read, not "no caches yet":
          // it renders the shared error state with the retry that actually re-reads.
          <div className="storage-cache-placeholder">
            <StateView
              state="error"
              reasonCode={state.status === 'error' ? regionErrorReasonCode(state.reasonCode) : 'unreadable'}
              size="md"
              action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void reload() }}
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

        {/*
         * 隔离副本：磁盘上有、界面以前完全看不见的那一类文件。**只读**——列出文件名、相对位置、
         * 大小与修改时间；说明（它们是什么、能不能删、删了会怎样）在标题旁的 ⓘ 里。
         * 三态分开：读不到 = 错误态 + 重试；扫完了没有 = 空态；有目录没读到 = 列表照出 + 一句「可能不全」。
         */}
        {/*
         * 隔离副本：磁盘上有、界面以前完全看不见的那一类文件。**只读**——列出文件名、相对位置、
         * 大小与修改时间；说明（它们是什么、能不能删、删了会怎样）在展开区顶部的 ⓘ 里。
         * 折叠头走平台 `CollapsibleGroup`（同屏只许一套折叠实现）；三态分开：读不到 = 错误态 + 重试；
         * 扫完了没有 = 空态（说的是「健康」不是「等数据」）；有目录没读到 = 列表照出 + 一句「可能不全」。
         */}
        <section className="storage-cache-panel" data-quarantine-copies="true">
          <CollapsibleGroup
            resolveText={(key) => (key === labels.quarantineTitle ? labels.quarantineTitle : '')}
            titleText={labels.quarantineTitle}
            {...(quarantine.state.status === 'ready'
              ? { metaText: String(quarantine.state.data.copies.length) }
              : {})}
          >
            <div className="storage-cache-quarantine-about">
              {/*
               * 说明句只进 ⓘ：折叠头的头行整行是按钮，平台契约禁止在里面放可聚焦元素（嵌套按钮），
               * 所以它跟着展开区一起来——收起时没有「被推到行尾」这件事。
               */}
              <SettingInfoPopover
                hintKey={labels.quarantineWhat}
                infoLabelKey={labels.quarantineWhatAria}
                resolveText={(key) => {
                  if (key === labels.quarantineWhat) return labels.quarantineWhat
                  if (key === labels.quarantineWhatAria) return labels.quarantineWhatAria
                  return ''
                }}
              />
            </div>
            {quarantine.state.status === 'loading' ? (
              <div className="storage-cache-placeholder">
                <LoadingState label={labels.loading} />
              </div>
            ) : quarantine.state.status === 'error' ? (
              <div className="storage-cache-placeholder">
                <StateView
                  state="error"
                  reasonCode={regionErrorReasonCode(quarantine.state.reasonCode)}
                  size="md"
                  action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void quarantine.reload() }}
                />
              </div>
            ) : (
              <>
                {quarantine.state.data.copies.length === 0
                  && quarantine.state.data.unreadableDirectories === 0
                  && quarantine.state.data.truncated === false
                  ? <StateView
                    state="empty"
                    reasonCode="not-yet"
                    size="sm"
                    // 0 份副本是**健康状态**，不是「等数据进来」：用自己的句子说清它会自己出现。
                    // 键带产品前缀、句子来自文案表（§17：键 + 文案表，不把句子当键喂回去）。
                    productReason={{
                      key: 'storage.quarantine-empty',
                      resolve: () => labels.quarantineEmpty
                    }}
                  />
                  : quarantine.state.data.copies.length === 0
                    ? null
                    : <QuarantineCopyList language={language} labels={labels} scan={quarantine.state.data} />}

                {quarantine.state.data.unreadableDirectories > 0 ? (
                  <p className="storage-cache-muted">
                    {labels.quarantinePartial(quarantine.state.data.unreadableDirectories)}
                    {' '}
                    {/* 句内动作：文本档按钮，不再是句子里塞一个描边盒子。 */}
                    <Button
                      className="text-action"
                      onClick={() => void quarantine.reload()}
                      size="small"
                      type="text">
                      {labels.refresh}
                    </Button>
                  </p>
                ) : null}
                {quarantine.state.data.truncated ? (
                  <p className="storage-cache-muted">
                    {labels.quarantineTruncated(quarantine.state.data.copies.length)}
                  </p>
                ) : null}
              </>
            )}
          </CollapsibleGroup>
        </section>

        {/*
         * 操作记录：与隔离副本同一个折叠壳（同一屏只许一套折叠实现）。
         * 展开区常驻渲染是壳的契约（`aria-controls` 必须指向真实节点），收起态由 antd 隐藏。
         */}
        <section className="storage-cache-panel storage-cache-history-panel">
          <CollapsibleGroup
            resolveText={(key) => (key === labels.historyTitle ? labels.historyTitle : '')}
            titleText={labels.historyTitle}
            metaText={String(operations.length)}
          >
            {/*
             * 展开区常驻渲染，所以这里也要按读取生命周期给三态：读还没回来时既不是「没有记录」
             * （`StorageCacheOperationList` 会因为拿到空数组画空态），也不是错误。
             */}
            {state.status === 'ready' ? (
              <StorageCacheOperationList
                language={language}
                labels={labels}
                records={state.data.operations}
                caches={caches}
                showCacheName
              />
            ) : state.status === 'loading' ? (
              <div className="storage-cache-placeholder">
                <LoadingState label={labels.loading} />
              </div>
            ) : (
              <div className="storage-cache-placeholder">
                <StateView
                  state="error"
                  reasonCode={regionErrorReasonCode(state.reasonCode)}
                  size="md"
                  action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => void reload() }}
                />
              </div>
            )}
          </CollapsibleGroup>
        </section>
      </div>

      <StorageCacheDetailDrawer
        cache={detailCache}
        caches={caches}
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
