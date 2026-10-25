import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Drawer, Select } from 'antd'

import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { NewsSentimentItemDetail, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import { NEWS_SENTIMENT_WINDOWS, type NewsSentimentWindow } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import type { NewsSentimentText } from './NewsSentimentCard'
import { NewsSentimentStrength } from './NewsSentimentStrength'
import { labelText, sentimentIcon } from './newsSentimentPresentation'
import type { NewsSentimentFilters } from './useNewsSentiment'
import { filterNewsSentimentRows } from './newsSentimentFilters'
import { useNewsSentimentTranslationQueue } from './useNewsSentimentTranslationQueue'

function withTimeout<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
}


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
}): React.ReactElement {
  const { text, view } = props
  const translationEnabled = props.translationEnabled !== false
  const formatTime = useShellTimeFormat()
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<NewsSentimentItemDetail>()
  const [detailFailed, setDetailFailed] = useState(false)
  const [bodyView, setBodyView] = useState<'original' | 'translated'>('translated')
  const [contextMenu, setContextMenu] = useState<{ itemId: string; x: number; y: number }>()
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const [actionBusy, setActionBusy] = useState<'rescore' | 'rebuild'>()
  const [actionNotice, setActionNotice] = useState<string>()

  const rows = useMemo(() => filterNewsSentimentRows(view, props.filters), [view, props.filters])
  const activeId = selectedId && rows.some((row) => row.itemId === selectedId) ? selectedId : rows[0]?.itemId
  const active = (view?.items ?? []).find((row) => row.itemId === activeId)
  const {
    translationStates,
    translatedBodies,
    translatedTitles,
    translatingAll,
    translateItem,
    translateAll,
    cancelTranslation
  } = useNewsSentimentTranslationQueue({ client: props.client, view, onRefresh: props.onRefresh })

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

  useEffect(() => {
    if (!contextMenu) return
    const dismiss = (event: PointerEvent) => {
      if (!contextMenuRef.current?.contains(event.target as Node)) setContextMenu(undefined)
    }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setContextMenu(undefined) }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape)
    }
  }, [contextMenu])

  useEffect(() => {
    if (!props.open || !activeId || !view?.asOf) return
    let cancelled = false
    setDetailFailed(false)
    void props.client
      .getItem({ itemId: activeId, asOf: view.asOf })
      .then((next) => {
        if (!cancelled) setDetail(next)
      })
      .catch(() => {
        if (!cancelled) setDetailFailed(true)
      })
    return () => { cancelled = true }
  }, [props.open, activeId, view?.asOf, props.client])

  const sourceOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const source of view?.availableSources ?? []) seen.set(source.sourceId, source.sourceName)
    for (const row of view?.items ?? []) if (!seen.has(row.sourceId)) seen.set(row.sourceId, row.sourceName)
    return [{ value: 'all', label: text.drawer.filters.all }, ...[...seen].map(([value, label]) => ({ value, label }))]
  }, [view, text])

  return (
    <Drawer
      destroyOnHidden
      onClose={props.onClose}
      open={props.open}
      rootClassName="mi-news-drawer-root"
      title={text.drawer.title}
      width={1040}
    >
      <div className="mi-news-drawer">
        <header className="mi-news-drawer__toolbar">
          <Select
            aria-label={text.drawer.filters.direction}
            className="mi-news-drawer__time"
            onChange={(value: NewsSentimentWindow) => props.onWindowChange(value)}
            options={[
              ...NEWS_SENTIMENT_WINDOWS.map((window) => ({ value: window, label: window })),
              { value: 'all', label: text.drawer.filters.all }
            ]}
            popupMatchSelectWidth={false}
            size="small"
            value={props.window}
          />
          <button className="mi-news-drawer__action" onClick={props.onRefresh} type="button">{text.refresh}</button>
          <button className="mi-news-drawer__action" onClick={props.onOpenSettings} type="button">{text.drawer.settings}</button>
          <button
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
            type="button"
          >
            {actionBusy === 'rescore' ? text.settingsModal.rescoring : text.settingsModal.rescore}
          </button>
          {translationEnabled ? (
            <button
              className="mi-news-drawer__action"
              onClick={() => { if (translatingAll) cancelTranslation(); else void translateAll(rows) }}
              type="button"
            >
              {translatingAll
                ? text.settingsModal.cancelTranslate
                : text.settingsModal.translateAll}
            </button>
          ) : null}
          <button
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
            type="button"
          >
            {actionBusy === 'rebuild' ? text.settingsModal.rebuilding : text.settingsModal.rebuild}
          </button>
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
            <button className="mi-news-drawer__action" onClick={() => props.onFilters({ direction: 'all', sourceId: 'all', scope: 'market', includeNeutral: true })} type="button">
              {text.drawer.clearFilters}
            </button>
          ) : null}
        </div>

        <div className="mi-news-drawer__body">
          <div className="mi-news-drawer__list" role="list">
            {props.failed ? <p className="mi-news-drawer__empty">{text.unavailable}</p> : null}
            {!props.failed && rows.length === 0 ? <p className="mi-news-drawer__empty">{text.drawer.emptyFiltered}</p> : null}
            {rows.map((row) => {
              const rowState = translationStates[row.itemId] ?? row.bodyTranslationState ?? 'missing'
              return (
              <button
                aria-current={row.itemId === activeId}
                className={`mi-news-drawer__row${row.itemId === activeId ? ' is-selected' : ''}`}
                key={row.itemId}
                onClick={() => { setSelectedId(row.itemId); props.onSelectContext?.(row) }}
                onContextMenu={translationEnabled ? (event) => { event.preventDefault(); setContextMenu({ itemId: row.itemId, x: Math.min(event.clientX, window.innerWidth - 160), y: Math.min(event.clientY, window.innerHeight - 80) }) } : undefined}
                role="listitem"
                type="button"
                title={translationEnabled ? text.drawer.translationStatus?.contextMenu : undefined}
              >
                <span className="mi-news-drawer__row-top">
                  <time>{formatTime(row.publishedAt, 'minute')}</time>
                  <span className={`mi-news-sentiment__pill is-${row.polarity}`}>
                    {sentimentIcon(row.polarity)}{labelText(text, row.polarity)}
                  </span>
                  {translationEnabled && rowState === 'waiting' ? (
                    <span className="mi-news-drawer__row-waiting" title={text.drawer.translationStatus?.waitingHint}>
                      {text.drawer.translationStatus?.waiting ?? 'waiting'}
                    </span>
                  ) : null}
                  {translationEnabled && rowState === 'translating' ? (
                    <span className="mi-news-drawer__row-loading" role="status" aria-label={text.drawer.translationStatus?.translating}>
                      <i aria-hidden="true" />
                    </span>
                  ) : null}
                  {translationEnabled && rowState === 'failed' ? <span className="mi-news-drawer__row-failed">{text.drawer.translationStatus?.failed ?? 'failed'}</span> : null}
                  <small className="mi-news-drawer__source">{row.sourceName}</small>
                  <span className="mi-news-drawer__symbols">
                    {row.symbols.map((symbol) => <i key={symbol}>{symbol}</i>)}
                  </span>
                </span>
                <span className="mi-news-drawer__title">{translatedTitles[row.itemId] ?? row.displayTitle ?? row.title}</span>
              </button>
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
                  <button className="mi-news-drawer__translate-body" onClick={() => void translateItem(activeId!)} type="button">
                    {text.drawer.detail.translateBody}
                  </button>
                ) : null}
                {translationEnabled && hasTranslatedBody && activeTranslationState !== 'translating' ? (
                  <div className="mi-news-drawer__body-toggle" role="group">
                    <button aria-pressed={bodyView === 'original'} onClick={() => setBodyView('original')} type="button">{text.drawer.detail.original}</button>
                    <button aria-pressed={bodyView === 'translated'} onClick={() => setBodyView('translated')} type="button">{text.drawer.detail.translated}</button>
                  </div>
                ) : null}
                <p className="mi-news-drawer__bodytext">
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
                  ) : activeTranslationState === 'failed' ? (
                    <>{text.drawer.detail.translationFailed}<br />{detail?.bodyExcerpt ?? text.drawer.detail.noBody}</>
                  ) : detailFailed ? (
                    text.unavailable
                  ) : (
                    detail?.bodyExcerpt ?? text.drawer.detail.noBody
                  )}
                </p>
                <footer>
                  {detail?.promptVersion ? <span>{text.drawer.detail.prompt}: {detail.promptVersion}</span> : null}
                  {active.url ? <a href={active.url} rel="noreferrer" target="_blank">{text.drawer.detail.openOriginal} ↗</a> : null}
                </footer>
              </>
            ) : (
              <p className="mi-news-drawer__empty">{props.loading ? text.loading : text.drawer.emptyFiltered}</p>
            )}
          </aside>
        </div>
        {translationEnabled && contextMenu ? (
          <>
            <div className="mi-news-drawer__context" ref={contextMenuRef} style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
              {(() => {
                const translated = (translationStates[contextMenu.itemId] ?? rows.find((row) => row.itemId === contextMenu.itemId)?.bodyTranslationState) === 'translated'
                return (
                  <button
                    onClick={() => { const itemId = contextMenu.itemId; setContextMenu(undefined); void translateItem(itemId, translated) }}
                    role="menuitem"
                    type="button"
                  >
                    {translated
                      ? text.drawer.translationStatus?.retranslateOne ?? text.drawer.detail.translateBody
                      : text.drawer.translationStatus?.translateOne ?? text.drawer.detail.translateBody}
                  </button>
                )
              })()}
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  )
}
