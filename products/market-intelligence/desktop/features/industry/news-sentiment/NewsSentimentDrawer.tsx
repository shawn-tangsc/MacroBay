import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Select } from 'antd'
import { MoreVertical } from 'lucide-react'

import { Drawer } from '@platform/ui/components/drawer'
import { IconButton } from '@platform/ui/components/icon-button'
import { Segmented } from '@platform/ui/components/segmented'
import { ContextMenu, type MenuItem } from '@platform/ui/components/menu'
import { LoadingSpinner, LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import type { StateViewTextKey } from '@platform/ui/components/state/StateView'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import { NEWS_SENTIMENT_WINDOWS, type NewsSentimentWindow } from '../../../../service/intelligence/schema/newsSentiment'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import type { NewsSentimentText } from './NewsSentimentCard'
import { createIconTextResolver, hasIconText } from './newsSentimentIconText'
import { NewsSentimentStrength } from './NewsSentimentStrength'
import { labelText, sentimentIcon } from './newsSentimentPresentation'
import type { NewsSentimentFilters } from './useNewsSentiment'
import { filterNewsSentimentRows } from './newsSentimentFilters'
import { drawerSourceOptions, drawerTranslateMenuItem } from './newsSentimentDrawerModel'
import { useNewsSentimentItemDetail } from './useNewsSentimentItemDetail'
import { useNewsSentimentTranslationQueue } from './useNewsSentimentTranslationQueue'
import { withTimeout } from './newsSentimentTimeout'

export function NewsSentimentDrawer(props: {
  open: boolean
  text: NewsSentimentText
  view?: NewsSentimentView
  loading: boolean
  failed: boolean
  window: NewsSentimentWindow
  filters: NewsSentimentFilters
  focusItemId?: string
  onFilters: (next: Partial<NewsSentimentFilters>) => void
  onWindowChange: (window: NewsSentimentWindow) => void
  onClose: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  client: Pick<NewsSentimentClient, 'getItem' | 'rescore' | 'rebuild' | 'translateBody'>
  translationEnabled?: boolean
  onSelectContext?: (item: import('../../../../service/intelligence/news-sentiment/newsSentimentQuery').NewsSentimentItemView) => void
  /** Resolves the platform `ui.state.*` keys StateView prints; supplied by the feature. */
  resolveStateText: (key: StateViewTextKey) => string
}): React.ReactElement {
  const { text, view } = props
  const translationEnabled = props.translationEnabled !== false
  const formatTime = useShellTimeFormat()
  const [selectedId, setSelectedId] = useState<string>()
  const [bodyView, setBodyView] = useState<'original' | 'translated'>('translated')
  const [contextMenu, setContextMenu] = useState<{ itemId: string; x: number; y: number }>()
  // IconButton takes keys, not sentences; the resolver never falls back to the key itself.
  const resolveIconText = createIconTextResolver(text)
  const openContextMenu = (itemId: string, x: number, y: number): void => {
    setContextMenu({ itemId, x, y })
  }
  const [actionBusy, setActionBusy] = useState<'rescore' | 'rebuild'>()
  const [actionNotice, setActionNotice] = useState<string>()
  const resolveProductText = useProductTextKey()
  // The platform drawer keeps its content mounted, so the reset has to happen on close. Without it a
  // reopened drawer shows the article the reader read last time, under a new row's selection.
  const resetTransientState = useCallback(() => {
    setSelectedId(undefined)
    setBodyView('translated')
    setContextMenu(undefined)
  }, [])
  const handleClose = useCallback(() => {
    resetTransientState()
    props.onClose()
  }, [props.onClose, resetTransientState])
  useEffect(() => {
    if (!props.open) resetTransientState()
  }, [props.open, resetTransientState])

  // "No rows" is two different facts: the reader's own filters cut everything, or the window is
  // simply quiet. The first one has an action, the second one does not.
  // All four filter dimensions count: dropping neutral rows is still the reader's own filter, and
  // calling that "nothing here yet" both misreads the day and hides the way back.
  const filtered = props.filters.direction !== 'all'
    || props.filters.sourceId !== 'all'
    || props.filters.scope !== 'market'
    || props.filters.includeNeutral === false

  const rows = useMemo(() => filterNewsSentimentRows(view, props.filters), [view, props.filters])
  const activeId = selectedId && rows.some((row) => row.itemId === selectedId) ? selectedId : rows[0]?.itemId
  const active = (view?.items ?? []).find((row) => row.itemId === activeId)
  const {
    translationStates,
    translatedBodies,
    translatedTitles,
    translatingAll,
    progress,
    translateItem,
    translateAll,
    cancelTranslation
  } = useNewsSentimentTranslationQueue({ client: props.client, view, onRefresh: props.onRefresh })

  const { detail, detailFailed, detailLoading } = useNewsSentimentItemDetail({
    open: props.open,
    itemId: activeId,
    asOf: view?.asOf,
    client: props.client
  })

  const activeTranslationState = activeId ? translationStates[activeId] ?? active?.bodyTranslationState ?? 'missing' : 'missing'
  const activeTranslatedBody = activeId ? translatedBodies[activeId] ?? detail?.translatedBodyExcerpt : undefined
  const hasTranslatedBody = Boolean(activeTranslatedBody) || activeTranslationState === 'translated'
  const displayedBody = bodyView === 'original' ? detail?.bodyExcerpt : activeTranslatedBody ?? detail?.bodyExcerpt

  useEffect(() => {
    if (props.open && props.focusItemId) setSelectedId(props.focusItemId)
  }, [props.open, props.focusItemId])

  useEffect(() => {
    setBodyView('translated')
  }, [activeId])

  // One item, named by whether this row already has a translation. Platform `MenuItem` takes a key,
  // so the sentence still comes from this feature's text resolver.
  const menuItems: MenuItem[] = useMemo(
    () => drawerTranslateMenuItem({ contextMenuItemId: contextMenu?.itemId, translationStates, rows }),
    [contextMenu, rows, translationStates]
  )

  const sourceOptions = useMemo(
    () => drawerSourceOptions(view, text.drawer.filters.all),
    [view, text]
  )

  return (
    <Drawer
      header="titled"
      mode="modal"
      onClose={handleClose}
      open={props.open}
      resolveText={resolveProductText}
      size="full"
      titleKey="pages.intelligence.portal.newsSentiment.drawer.title"
    >
      <div className="mi-news-drawer">
        {translationEnabled && progress ? (
          // A running queue shows what it is doing (done/total) and the one control it needs.
          // When no batch is running the row is not rendered at all: no task, no bar.
          <div className="mi-news-drawer__queue" data-news-sentiment-translation-queue>
            <span className="mi-news-drawer__queue-label" role="status">
              {text.drawer.translationStatus.queue.replace('{done}', String(progress.done)).replace('{total}', String(progress.total))}
            </span>
            <span
              aria-label={text.drawer.translationStatus.translating}
              aria-valuemax={progress.total}
              aria-valuemin={0}
              aria-valuenow={progress.done}
              className="mi-news-drawer__queue-track"
              role="progressbar"
            >
              <i style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </span>
            <span aria-hidden="true" className="mi-news-drawer__queue-percent">
              {Math.round((progress.done / Math.max(1, progress.total)) * 100)}%
            </span>
            <Button className="mi-news-drawer__queue-cancel" onClick={cancelTranslation} size="small" type="link">{text.settingsModal.cancelTranslate}</Button>
          </div>
        ) : null}
        <header className="mi-news-drawer__toolbar">
          <Select
            aria-label={text.drawer.filters.direction}
            className="mi-news-drawer__time"
            onChange={(value: NewsSentimentWindow) => props.onWindowChange(value)}
            options={[
              ...NEWS_SENTIMENT_WINDOWS.map((window) => ({ value: window, label: window })),
              // The widest window is not "all history": the query returns at most 100 rows, and the
              // label has to say so or the reader believes the list is complete.
              { value: 'all', label: text.windowAll }
            ]}
            popupMatchSelectWidth={false}
            size="small"
            value={props.window}
          />
          <Button className="mi-news-drawer__action" onClick={props.onRefresh} size="small">{text.refresh}</Button>
          <Button className="mi-news-drawer__action" onClick={props.onOpenSettings} size="small">{text.drawer.settings}</Button>
          <Button
            className="mi-news-drawer__action"
            disabled={Boolean(actionBusy)}
            onClick={() => {
              setActionBusy('rescore')
              setActionNotice(undefined)
              void withTimeout(props.client.rescore())
                .then(() => setActionNotice(text.settingsModal.rescored))
                .catch(() => setActionNotice(text.settingsModal.rescoreFailed))
                .finally(() => setActionBusy(undefined))
            }}
            size="small"
          >
            {actionBusy === 'rescore' ? text.settingsModal.rescoring : text.settingsModal.rescore}
          </Button>
          {translationEnabled && !translatingAll ? (
            <Button
              className="mi-news-drawer__action"
              onClick={() => void translateAll(rows)}
              size="small"
            >
              {text.settingsModal.translateAll}
            </Button>
          ) : null}
          <Button
            className="mi-news-drawer__action"
            disabled={Boolean(actionBusy)}
            onClick={() => {
              setActionBusy('rebuild')
              setActionNotice(undefined)
              if (typeof props.client.rebuild !== 'function') {
                setActionBusy(undefined)
                setActionNotice(text.settingsModal.rebuildFailed)
                return
              }
              void withTimeout(props.client.rebuild())
                .then(() => setActionNotice(text.settingsModal.rebuilt))
                .catch(() => setActionNotice(text.settingsModal.rebuildFailed))
                .finally(() => setActionBusy(undefined))
            }}
            size="small"
          >
            {actionBusy === 'rebuild' ? text.settingsModal.rebuilding : text.settingsModal.rebuild}
          </Button>
        </header>
        {actionNotice ? <p className="mi-news-drawer__notice" role="status">{actionNotice}</p> : null}

        <div className="mi-news-drawer__filters">
          <label>
            <span>{text.drawer.filters.direction}</span>
            <Select
              aria-label={text.drawer.filters.direction}
              onChange={(value) => props.onFilters({ direction: value })}
              options={[
                { value: 'all', label: text.drawer.filters.all },
                { value: 'bullish', label: text.labels.bullish },
                { value: 'bearish', label: text.labels.bearish },
                { value: 'neutral', label: text.labels.neutral },
                { value: 'mixed', label: text.labels.mixed }
              ]}
              size="small"
              value={props.filters.direction}
            />
          </label>
          <label>
            <span>{text.drawer.filters.source}</span>
            <Select
              aria-label={text.drawer.filters.source}
              onChange={(value) => props.onFilters({ sourceId: value })}
              options={sourceOptions}
              size="small"
              value={props.filters.sourceId}
            />
          </label>
          <label>
            <span>{text.neutralFilter.label}</span>
            <Select
              aria-label={text.neutralFilter.label}
              onChange={(value: 'include' | 'exclude') => props.onFilters({ includeNeutral: value === 'include' })}
              options={[
                { value: 'include', label: text.neutralFilter.all },
                { value: 'exclude', label: text.neutralFilter.exclude }
              ]}
              popupMatchSelectWidth={false}
              size="small"
              style={{ minWidth: 108 }}
              value={props.filters.includeNeutral ? 'include' : 'exclude'}
            />
          </label>
          <label>
            <span>{text.drawer.filters.scope}</span>
            <Select
              aria-label={text.drawer.filters.scope}
              onChange={(value) => props.onFilters({ scope: value })}
              options={[
                { value: 'market', label: text.drawer.scope.market },
                { value: 'BTC', label: text.drawer.scope.BTC },
                { value: 'ETH', label: text.drawer.scope.ETH }
              ]}
              size="small"
              value={props.filters.scope}
            />
          </label>
          {props.filters.direction !== 'all' || props.filters.sourceId !== 'all' || props.filters.scope !== 'market' ? (
            <Button className="mi-news-drawer__action" onClick={() => props.onFilters({ direction: 'all', sourceId: 'all', scope: 'market', includeNeutral: true })} size="small">
              {text.drawer.clearFilters}
            </Button>
          ) : null}
        </div>

        <div className="mi-news-drawer__body">
          <div className="mi-news-drawer__list" role="list">
            {props.failed && rows.length === 0 ? (
              // Nothing was ever read here: error plus the way out.
              <StateView
                action={{ labelKey: 'ui.state.action.retry', onSelect: props.onRefresh }}
                reasonCode="unreadable"
                resolveText={props.resolveStateText}
                size="md"
                state="error"
              />
            ) : null}
            {props.failed && rows.length > 0 ? (
              // A failed refresh keeps the rows this drawer already had; the note says so instead
              // of replacing a still-true reading with an error panel.
              <p className="mi-news-drawer__stale-read" data-news-sentiment-stale-read role="status">
                <span>{text.staleRead}</span>
                <button type="button" className="text-action" onClick={props.onRefresh}>{text.retry}</button>
              </p>
            ) : null}
            {!props.failed && props.loading && !props.view ? (
              // First read in flight: "not yet" would claim the window is empty before we know.
              <StateView resolveText={props.resolveStateText} size="md" state="loading" />
            ) : null}
            {!props.failed && !props.loading && rows.length === 0 ? (
              filtered
                ? <StateView
                    action={{ labelKey: 'ui.state.action.clear-filter', onSelect: () => props.onFilters({ direction: 'all', sourceId: 'all', scope: 'market', includeNeutral: true }) }}
                    reasonCode="filtered-out"
                    resolveText={props.resolveStateText}
                    size="md"
                    state="empty"
                  />
                // 成因不可知（抽屉拿不到「从没跑过 / 采集失败」），故不断言窗口内确实为空：
                // `not-yet` 不承担结论，`nothing-in-window` 会替这个窗口下「确实没有」的判断。
                : <StateView reasonCode="not-yet" resolveText={props.resolveStateText} size="md" state="empty" />
            ) : null}
            {rows.map((row) => {
              const rowState = translationStates[row.itemId] ?? row.bodyTranslationState ?? 'missing'
              return (
              <div
                className={`mi-news-drawer__row${row.itemId === activeId ? ' is-selected' : ''}`}
                key={row.itemId}
                role="listitem"
              >
              <button
                aria-current={row.itemId === activeId}
                // 整行即动作（ui-spec「可点击行」）：原生 button 保留，antd `Button` 表达不了这种
                // 多行富内容；可访问名说明点开哪一条，键盘与焦点环由原生 button + 全仓 `:focus-visible` 提供。
                aria-label={text.openItem.replace('{title}', translatedTitles[row.itemId] ?? row.displayTitle ?? row.title)}
                className="mi-news-drawer__row-open"
                onClick={() => { setSelectedId(row.itemId); props.onSelectContext?.(row) }}
                onContextMenu={translationEnabled ? (event) => { event.preventDefault(); openContextMenu(row.itemId, event.clientX, event.clientY) } : undefined}
                onKeyDown={translationEnabled ? (event) => {
                  // A context menu reachable only by right-click is unreachable from the keyboard.
                  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
                  event.preventDefault()
                  const rect = event.currentTarget.getBoundingClientRect()
                  openContextMenu(row.itemId, rect.left + 8, rect.top + 8)
                } : undefined}
                type="button"
              >
                <span className="mi-news-drawer__row-top">
                  <time>{formatTime(row.publishedAt, 'minute')}</time>
                  <span className={`mi-news-sentiment__pill is-${row.polarity}`}>
                    {sentimentIcon(row.polarity)}{labelText(text, row.polarity)}
                  </span>
                  {translationEnabled && rowState === 'waiting' ? (
                    <span className="mi-news-drawer__row-waiting">
                      {text.drawer.translationStatus?.waiting}
                    </span>
                  ) : null}
                  {translationEnabled && rowState === 'translating' ? (
                    <span className="mi-news-drawer__row-loading" role="status" aria-label={text.drawer.translationStatus?.translating}>
                      <LoadingSpinner size="sm" />
                    </span>
                  ) : null}
                  {translationEnabled && rowState === 'failed' ? <span className="mi-news-drawer__row-failed">{text.drawer.translationStatus?.failed}</span> : null}
                  <small className="mi-news-drawer__source">{row.sourceName}</small>
                  <span className="mi-news-drawer__symbols">
                    {row.symbols.map((symbol) => <i key={symbol}>{symbol}</i>)}
                  </span>
                </span>
                <span className="mi-news-drawer__title">{translatedTitles[row.itemId] ?? row.displayTitle ?? row.title}</span>
              </button>
              {translationEnabled && hasIconText(text, 'news.sentiment.more') ? (
                <IconButton
                  ariaLabelKey="news.sentiment.more"
                  icon={MoreVertical}
                  onSelect={() => {
                    const rect = (document.activeElement as HTMLElement | null)?.getBoundingClientRect()
                    openContextMenu(row.itemId, rect?.left ?? 0, (rect?.bottom ?? 0) + 4)
                  }}
                  resolveText={resolveIconText}
                  size="sm"
                  tooltipKey="news.sentiment.more"
                />
              ) : null}
              </div>
              )
            })}

          </div>

          <aside className="mi-news-drawer__detail" aria-label={text.drawer.title}>
            {active ? (
              <>
                <h3>{translatedTitles[active.itemId] ?? active.displayTitle ?? active.title}</h3>
                {(translatedTitles[active.itemId] ?? active.displayTitle) ? <p className="mi-news-drawer__original">{active.title}</p> : null}
                <div className="mi-news-drawer__meta">
                  <span>{active.sourceName}</span>
                  <time>{formatTime(active.publishedAt, 'minute')}</time>
                  <span>{text.drawer.detail.engine}: {active.engine === 'model' ? text.engine.model : text.engine.rules}</span>
                  {active.modelRef ? <span>{active.modelRef}</span> : null}
                </div>
                {active.url ? (
                  <a className="mi-news-drawer__source-link" href={active.url} rel="noreferrer" target="_blank">
                    {text.drawer.detail.openOriginal} ↗
                  </a>
                ) : null}
                <div className="mi-news-drawer__badges">
                  <span className={`mi-news-sentiment__pill is-${active.polarity}`}>{labelText(text, active.polarity)}</span>
                  <NewsSentimentStrength strength={active.strength} text={text} />
                  <span>{text.drawer.detail.confidence} {active.confidence}%</span>
                  {active.symbols.map((symbol) => <i key={symbol}>{symbol}</i>)}
                </div>
                {active.evidenceQuote ? (
                  <blockquote>
                    <span>{text.drawer.detail.evidence}</span>
                    {active.evidenceQuote}
                  </blockquote>
                ) : null}
                {translationEnabled && activeTranslationState !== 'translated' && activeTranslationState !== 'translating' && detail?.bodyExcerpt ? (
                  <Button className="mi-news-drawer__translate-body" onClick={() => void translateItem(activeId!)} size="small">
                    {text.drawer.detail.translateBody}
                  </Button>
                ) : null}
                {translationEnabled && hasTranslatedBody && activeTranslationState !== 'translating' ? (
                  <div className="mi-news-drawer__body-toggle">
                  <Segmented
                    ariaLabelKey="pages.intelligence.portal.newsSentiment.drawer.detail.body"
                    items={[
                      { labelKey: 'pages.intelligence.portal.newsSentiment.drawer.detail.original', value: 'original' },
                      { labelKey: 'pages.intelligence.portal.newsSentiment.drawer.detail.translated', value: 'translated' }
                    ]}
                    onChange={(value) => setBodyView(value === 'original' ? 'original' : 'translated')}
                    resolveText={resolveProductText}
                    value={bodyView}
                  />
                  </div>
                ) : null}
                {/* A div, not a p: the loading state renders a div, and a p cannot contain one. */}
                <div className="mi-news-drawer__bodytext">
                  {activeTranslationState === 'translating' || activeTranslationState === 'waiting' ? (
                    <>
                      <span className="mi-news-drawer__translating" role="status">
                        <i aria-hidden="true" />
                        {text.drawer.detail.translatingBody}
                      </span>
                      {detail?.bodyExcerpt ? <><br />{detail.bodyExcerpt}</> : null}
                    </>
                  ) : displayedBody ? (
                    displayedBody
                  ) : detailLoading ? (
                    <LoadingState label={text.loading} minHeight={80} />
                  ) : activeTranslationState === 'failed' ? (
                    <>{text.drawer.detail.translationFailed}<br />{detail?.bodyExcerpt ?? text.drawer.detail.noBody}</>
                  ) : detailFailed ? (
                    text.unavailable
                  ) : (
                    detail?.bodyExcerpt ?? text.drawer.detail.noBody
                  )}
                </div>
                <footer>
                  {detail?.promptVersion ? <span>{text.drawer.detail.prompt}: {detail.promptVersion}</span> : null}
                  {active.url ? <a href={active.url} rel="noreferrer" target="_blank">{text.drawer.detail.openOriginal} ↗</a> : null}
                </footer>
              </>
            ) : props.loading ? (
              <LoadingState label={text.loading} minHeight={160} />
            ) : null}
          </aside>
        </div>
        {/* The row menu is the platform ContextMenu: point anchoring, viewport clamping, Esc and
            outside-click, and the arrow/Home/End keyboard model all come from it. This file only
            says which row and which item. */}
        <ContextMenu
          anchor={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
          ariaLabelKey="news.sentiment.more"
          items={translationEnabled && contextMenu ? menuItems : []}
          onClose={() => setContextMenu(undefined)}
          onSelect={(key) => {
            if (key !== 'translate' || !contextMenu) return
            const translated = (translationStates[contextMenu.itemId] ?? rows.find((row) => row.itemId === contextMenu.itemId)?.bodyTranslationState) === 'translated'
            void translateItem(contextMenu.itemId, translated)
          }}
          open={translationEnabled && contextMenu !== undefined}
          resolveText={resolveIconText}
        />
      </div>
    </Drawer>
  )
}
