import { useCallback, useEffect, useMemo, useState } from 'react'
import { Drawer, Select } from 'antd'

import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { NewsSentimentItemDetail, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import { intelligenceTranslationClient } from '../../../shared/ipc/intelligenceTranslationClient'
import type { NewsSentimentClient } from '../../../shared/ipc/newsSentimentClient'
import { NEWS_SENTIMENT_WINDOWS, type NewsSentimentWindow } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentText } from './NewsSentimentCard'

function withTimeout<T>(promise: Promise<T>, ms = 8000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
}
import { labelText, sentimentIcon } from './NewsSentimentCard'
import type { NewsSentimentFilters } from './useNewsSentiment'

export function NewsSentimentDrawer(props: {
  open: boolean
  text: NewsSentimentText
  view?: NewsSentimentView
  loading: boolean
  failed: boolean
  window: string
  filters: NewsSentimentFilters
  focusItemId?: string
  onFilters: (next: Partial<NewsSentimentFilters>) => void
  onWindowChange: (window: NewsSentimentWindow) => void
  onClose: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  client: Pick<NewsSentimentClient, 'getItem'>
}): React.ReactElement {
  const { text, view } = props
  const formatTime = useShellTimeFormat()
  const [selectedId, setSelectedId] = useState<string>()
  const [detail, setDetail] = useState<NewsSentimentItemDetail>()
  const [detailFailed, setDetailFailed] = useState(false)
  const [translationStates, setTranslationStates] = useState<Record<string, 'waiting' | 'translating' | 'translated' | 'failed'>>({})
  const [translatedBodies, setTranslatedBodies] = useState<Record<string, string>>({})
  const [translatingAll, setTranslatingAll] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ itemId: string; x: number; y: number }>()
  const [actionBusy, setActionBusy] = useState<'rescore' | 'rebuild'>()
  const [actionNotice, setActionNotice] = useState<string>()

  const rows = useMemo(() => filterRows(view, props.filters), [view, props.filters])
  const activeId = selectedId && rows.some((row) => row.itemId === selectedId) ? selectedId : rows[0]?.itemId
  const active = (view?.items ?? []).find((row) => row.itemId === activeId)
  const activeTranslationState = activeId ? translationStates[activeId] ?? active?.bodyTranslationState ?? 'missing' : 'missing'
  const activeTranslatedBody = activeId ? translatedBodies[activeId] : undefined

  const translateItem = useCallback(async (itemId: string) => {
    const row = (view?.items ?? []).find((entry) => entry.itemId === itemId)
    if (row?.bodyTranslationState === 'translated' || translatedBodies[itemId]) return
    setTranslationStates((current) => ({ ...current, [itemId]: 'translating' }))
    void intelligenceTranslationClient.queueMissing({ reason: 'manual-selection', itemIds: [itemId] }).catch(() => undefined)
    const clientTranslate = typeof props.client.translateBody === 'function'
      ? props.client.translateBody
      : (id: string) => {
          const products = window.platform?.products
          if (!products?.invoke) return Promise.reject(new Error('Product IPC bridge is unavailable.'))
          return products.invoke('market-intelligence', 'intelligence.translateNewsSentimentBody', { itemId: id }) as Promise<{ state: 'translated' | 'off' | 'unavailable' | 'failed'; body?: string }>
        }
    try {
      const result = await clientTranslate(itemId)
      if (result.state === 'translated' && result.body) {
        setTranslatedBodies((current) => ({ ...current, [itemId]: result.body! }))
        setTranslationStates((current) => ({ ...current, [itemId]: 'translated' }))
        window.setTimeout(() => props.onRefresh(), 800)
      } else {
        setTranslationStates((current) => ({ ...current, [itemId]: 'failed' }))
      }
    } catch {
      setTranslationStates((current) => ({ ...current, [itemId]: 'failed' }))
    }
  }, [props.client, translatedBodies, view])

  const translateAll = useCallback(async () => {
    const pending = rows.filter((row) => (translationStates[row.itemId] ?? row.bodyTranslationState) !== 'translated')
    if (pending.length === 0) return
    void intelligenceTranslationClient.queueMissing({ reason: 'manual-selection', itemIds: pending.map((row) => row.itemId) }).catch(() => undefined)
    setTranslatingAll(true)
    setTranslationStates((current) => {
      const next = { ...current }
      for (const row of pending) if (!next[row.itemId]) next[row.itemId] = 'waiting'
      return next
    })
    for (const row of pending) await translateItem(row.itemId)
    setTranslatingAll(false)
    props.onRefresh()
  }, [rows, translateItem, translationStates])

  useEffect(() => {
    if (props.open && props.focusItemId) setSelectedId(props.focusItemId)
  }, [props.open, props.focusItemId])

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
    for (const row of view?.items ?? []) seen.set(row.sourceId, row.sourceName)
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
          <div className="mi-news-sentiment__window" role="group" aria-label={text.drawer.title}>
            {NEWS_SENTIMENT_WINDOWS.map((window) => (
              <button
                aria-pressed={props.window === window}
                className={props.window === window ? 'is-on' : undefined}
                key={window}
                onClick={() => props.onWindowChange(window)}
                type="button"
              >
                {window}
              </button>
            ))}
          </div>
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
          <button
            className="mi-news-drawer__action"
            disabled={translatingAll}
            onClick={() => void translateAll()}
            type="button"
          >
            {translatingAll ? text.settingsModal.translating : text.settingsModal.translateAll ?? text.settingsModal.retryTranslation}
          </button>
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

        {view?.state === 'available' && view.summary ? (
          <div className="mi-news-drawer__summary">
            <span className={`mi-news-sentiment__pill is-${view.summary.label}`}>{labelText(text, view.summary.label)}</span>
            <strong>{text.counts.replace('{count}', String(view.summary.itemCount))}</strong>
            <span>{view.summary.score.toFixed(2)}</span>
            <small>
              {text.breakdown
                .replace('{bull}', String((view?.items ?? []).filter((row) => row.polarity === 'bullish').length))
                .replace('{bear}', String((view?.items ?? []).filter((row) => row.polarity === 'bearish').length))
                .replace('{flat}', String(view.summary.neutralCount))}
            </small>
            <small className="mi-news-drawer__mix">{text.engine.model} {view.summary.engineMix.model} · {text.engine.rules} {view.summary.engineMix.rules}</small>
          </div>
        ) : null}

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
            <button className="mi-news-drawer__action" onClick={() => props.onFilters({ direction: 'all', sourceId: 'all', scope: 'market' })} type="button">
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
                onClick={() => setSelectedId(row.itemId)}
                onContextMenu={(event) => { event.preventDefault(); setContextMenu({ itemId: row.itemId, x: Math.min(event.clientX, window.innerWidth - 160), y: Math.min(event.clientY, window.innerHeight - 80) }) }}
                role="listitem"
                type="button"
                title={text.drawer.translationStatus?.contextMenu}
              >
                <span className="mi-news-drawer__row-top">
                  <time>{formatTime(row.publishedAt, 'minute')}</time>
                  <span className={`mi-news-sentiment__pill is-${row.polarity}`}>
                    {sentimentIcon(row.polarity)}{labelText(text, row.polarity)}
                  </span>
                  {rowState === 'translating' || rowState === 'waiting' ? (
                    <span className="mi-news-drawer__row-loading" role="status" aria-label={text.drawer.translationStatus?.[rowState] ?? rowState}>
                      <i aria-hidden="true" />
                    </span>
                  ) : null}
                  {rowState === 'failed' ? <span className="mi-news-drawer__row-failed">{text.drawer.translationStatus?.failed ?? 'failed'}</span> : null}
                  <small className="mi-news-drawer__source">{row.sourceName}</small>
                  <span className="mi-news-drawer__symbols">
                    {row.symbols.map((symbol) => <i key={symbol}>{symbol}</i>)}
                  </span>
                </span>
                <span className="mi-news-drawer__title">{row.displayTitle ?? row.title}</span>
              </button>
              )
            })}

          </div>

          <aside className="mi-news-drawer__detail" aria-label={text.drawer.title}>
            {active ? (
              <>
                <h3>{active.displayTitle ?? active.title}</h3>
                {active.displayTitle ? <p className="mi-news-drawer__original">{active.title}</p> : null}
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
                  <span>{active.strength}/5</span>
                  <span>{active.confidence}%</span>
                  {active.symbols.map((symbol) => <i key={symbol}>{symbol}</i>)}
                </div>
                {active.evidenceQuote ? (
                  <blockquote>
                    <span>{text.drawer.detail.evidence}</span>
                    {active.evidenceQuote}
                  </blockquote>
                ) : null}
                {activeTranslationState !== 'translated' && activeTranslationState !== 'translating' && detail?.bodyExcerpt ? (
                  <button className="mi-news-drawer__translate-body" onClick={() => void translateItem(activeId!)} type="button">
                    {text.drawer.detail.translateBody}
                  </button>
                ) : null}
                <p className="mi-news-drawer__bodytext">
                  {activeTranslationState === 'translating' || activeTranslationState === 'waiting' ? (
                    <span className="mi-news-drawer__translating" role="status">
                      <i aria-hidden="true" />
                      {text.drawer.detail.translatingBody}
                    </span>
                  ) : activeTranslatedBody ? (
                    activeTranslatedBody
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
        {contextMenu ? (
          <>
            <div className="mi-news-drawer__context-mask" onClick={() => setContextMenu(undefined)} />
            <div className="mi-news-drawer__context" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu">
              <button
                disabled={(translationStates[contextMenu.itemId] ?? rows.find((row) => row.itemId === contextMenu.itemId)?.bodyTranslationState) === 'translated'}
                onClick={() => { const itemId = contextMenu.itemId; setContextMenu(undefined); void translateItem(itemId) }}
                role="menuitem"
                type="button"
              >
                {text.drawer.translationStatus?.translateOne ?? text.drawer.detail.translateBody}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  )
}

function filterRows(view: NewsSentimentView | undefined, filters: NewsSentimentFilters) {
  return (view?.items ?? []).filter((row) => {
    if (filters.direction !== 'all' && row.polarity !== filters.direction) return false
    if (filters.sourceId !== 'all' && row.sourceId !== filters.sourceId) return false
    if (filters.scope !== 'market' && !row.symbols.includes(filters.scope)) return false
    return true
  })
}
