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
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { productText } from '../../../shared/i18n/productText'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import type { NewsSentimentText } from './NewsSentimentCard'
import { createIconTextResolver, hasIconText } from './newsSentimentIconText'
import { NewsSentimentDrawerList } from './NewsSentimentDrawerList'
import { NewsSentimentStrength } from './NewsSentimentStrength'
import { AiInterpretationSection } from '../../shared/AiInterpretationSection'
import { newsInterpretationMenuItem } from './newsSentimentInterpretationMenu'
import { useNewsInterpretationRead } from './useNewsInterpretationRead'
import { readInterpretationSummary, requestNewsInterpretation } from '../../../shared/ipc/newsInterpretationClient'
import { newsInterpretationResultCopy } from '../../../shared/i18n/newsInterpretationResultCopy'
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
  /** 同卡片：宿主不给去处就不画这颗入口（这一版之后没有本地设置面）。 */
  onOpenSettings?: () => void
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

  const activeRead = useNewsInterpretationRead(activeId, props.open)
  /** 触发中的条目 + 失败结果（结果只落右栏那一节；菜单不显示进度/失败）。 */
  const [interpretationSubmitting, setInterpretationSubmitting] = useState<string>()
  const [interpretationFailure, setInterpretationFailure] = useState<Readonly<{ itemId: string; sentenceKey: string; retry: boolean }>>()
  const menuRead = useNewsInterpretationRead(contextMenu?.itemId, contextMenu !== undefined)
  const submitInterpretation = useCallback((itemId: string): void => {
    setInterpretationSubmitting(itemId)
    setInterpretationFailure(undefined)
    void requestNewsInterpretation(itemId).then((result) => {
      if (result.state === 'queued' || result.state === 'in-flight') {
        activeRead.reload()
        return
      }
      setInterpretationSubmitting(undefined)
      if (result.state === 'already-available') {
        activeRead.reload()
        return
      }
      const copy = result.state === 'insufficient-facts'
        ? newsInterpretationResultCopy({ insufficientReason: result.details.reason })
        : result.state === 'not-ready' || result.state === 'failed'
          ? newsInterpretationResultCopy({ failureCode: result.failureCode })
          : newsInterpretationResultCopy({})
      setInterpretationFailure({ itemId, sentenceKey: copy.sentenceKey, retry: copy.action === 'retry' })
    })
  }, [activeRead])

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
  // 菜单第一项常驻（AI 解读），翻译项自己按开关出现：菜单不再被翻译开关绑住。
  const menuItems: MenuItem[] = useMemo(
    () => [
      newsInterpretationMenuItem(menuRead.view, menuRead.loading),
      ...(translationEnabled
        ? drawerTranslateMenuItem({ contextMenuItemId: contextMenu?.itemId, translationStates, rows })
        : [])
    ],
    [contextMenu?.itemId, menuRead.loading, menuRead.view, rows, translationEnabled, translationStates]
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
            <Button className="mi-news-drawer__queue-cancel text-action" onClick={cancelTranslation} size="small" type="text">{text.settingsModal.cancelTranslate}</Button>
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
          {props.onOpenSettings === undefined ? null : (
            <Button className="mi-news-drawer__action" onClick={props.onOpenSettings} size="small">{text.drawer.settings}</Button>
          )}
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
                .then((result) => setActionNotice(
                  result.quarantinedCopy ? text.settingsModal.rebuiltWithCopy : text.settingsModal.rebuilt
                ))
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
          <NewsSentimentDrawerList
            activeId={activeId}
            failed={props.failed}
            filtered={filtered}
            hasView={props.view !== undefined}
            loading={props.loading}
            onClearFilters={() => props.onFilters({ direction: 'all', sourceId: 'all', scope: 'market', includeNeutral: true })}
            onOpenRow={(row) => { setSelectedId(row.itemId); props.onSelectContext?.(row) }}
            onRefresh={props.onRefresh}
            onRowContextMenu={openContextMenu}
            resolveStateText={props.resolveStateText}
            rows={rows}
            text={text}
            translatedTitles={translatedTitles}
            translationEnabled={translationEnabled}
            translationStates={translationStates}
          />
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
                <DrawerInterpretation
                  failure={interpretationFailure?.itemId === activeId ? interpretationFailure : undefined}
                  onRetry={() => { if (activeId !== undefined) submitInterpretation(activeId) }}
                  submitting={interpretationSubmitting === activeId}
                  view={activeRead.view} />
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
          items={contextMenu ? menuItems : []}
          onClose={() => setContextMenu(undefined)}
          onSelect={(key) => {
            if (!contextMenu) return
            if (key === 'interpretation') {
              // 「查看」只把该条选到右栏，**不发请求**；「AI 解读 / 再次解读」才触发。
              if (menuRead.view?.state === 'available'
                && menuRead.view.evidenceFingerprint !== undefined
                && menuRead.view.evidenceFingerprint === menuRead.view.currentEvidenceFingerprint) {
                setSelectedId(contextMenu.itemId)
                return
              }
              submitInterpretation(contextMenu.itemId)
              return
            }
            if (key !== 'translate') return
            const translated = (translationStates[contextMenu.itemId] ?? rows.find((row) => row.itemId === contextMenu.itemId)?.bodyTranslationState) === 'translated'
            void translateItem(contextMenu.itemId, translated)
          }}
          open={contextMenu !== undefined && menuItems.length > 0}
          resolveText={resolveIconText}
        />
      </div>
    </Drawer>
  )
}

/**
 * 右栏那一节「AI 解读」（R37）：状态由只读接口驱动，不靠内存。
 *
 * 成功态的**正文**按 `summaryId` 去 `marketAnalysis.getSummary` 取——`summaryId` 由只读接口在
 * `available` 时提供（必填、按 state 收窄）；不要在界面侧另找 summary 或反查时间线。
 */
function DrawerInterpretation(props: Readonly<{
  view?: import('../../../shared/ipc/newsInterpretationClient').NewsInterpretationReadView
  submitting: boolean
  failure?: Readonly<{ itemId: string; sentenceKey: string; retry: boolean }>
  onRetry: () => void
}>): React.ReactElement | null {
  const copy = productText[useShellLanguage()].mi.aiInterpretation
  const resolveText = useProductTextKey()
  const { view } = props
  const summaryId = view?.state === 'available' ? view.summaryId : undefined
  const [paragraphs, setParagraphs] = useState<readonly string[]>()
  const [summaryFailed, setSummaryFailed] = useState(false)

  useEffect(() => {
    if (summaryId === undefined) { setParagraphs(undefined); setSummaryFailed(false); return }
    let active = true
    setSummaryFailed(false)
    void readInterpretationSummary(summaryId).then((next) => {
      if (!active) return
      if (next === undefined) setSummaryFailed(true)
      else setParagraphs(next)
    })
    return () => { active = false }
  }, [summaryId, props.onRetry])

  if (props.failure !== undefined) {
    return <AiInterpretationSection
      failure={{ sentence: resolveText(props.failure.sentenceKey) || copy.readFailed, canRetry: props.failure.retry }}
      {...(props.failure.retry ? { onRetry: props.onRetry } : {})}
      state="failed" />
  }
  if (props.submitting) return <AiInterpretationSection state="pending" />
  if (view === undefined || view.state === 'none') return null
  if (view.state === 'in-flight') return <AiInterpretationSection state="pending" />
  if (view.state === 'unreadable') {
    return <AiInterpretationSection failure={{ sentence: copy.readFailed, canRetry: true }} onRetry={props.onRetry} state="failed" />
  }
  if (view.generatedAt === undefined || view.evidenceScope === undefined || summaryId === undefined) {
    return <AiInterpretationSection failure={{ sentence: copy.readFailed, canRetry: true }} onRetry={props.onRetry} state="failed" />
  }
  if (summaryFailed) {
    return <AiInterpretationSection failure={{ sentence: copy.readFailed, canRetry: true }} onRetry={props.onRetry} state="failed" />
  }
  if (paragraphs === undefined) return <AiInterpretationSection state="pending" />
  return <AiInterpretationSection
    audit={{
      asOf: view.evidenceScope.asOf,
      dataCutoff: view.evidenceScope.dataCutoff,
      domains: view.evidenceScope.domains,
      factCount: view.evidenceScope.factCount,
      ...(view.runId === undefined ? {} : { runId: view.runId }),
      ...(view.snapshotHash === undefined ? {} : { snapshotHash: view.snapshotHash })
    }}
    meta={{ evidenceRefCount: view.evidenceScope.evidenceRefCount, generatedAt: view.generatedAt }}
    paragraphs={paragraphs}
    state="ready" />
}
