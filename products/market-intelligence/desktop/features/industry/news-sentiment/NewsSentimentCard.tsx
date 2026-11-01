import { useEffect, useState } from 'react'
import { Button, Segmented } from 'antd'
import { Newspaper, RefreshCw, Settings } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { productText } from '../../../shared/i18n/productText'
import type { NewsSentimentItemView, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import { NEWS_SENTIMENT_WINDOW_MS } from '../../../../service/intelligence/schema/newsSentiment'
import { labelText } from './newsSentimentPresentation'
import { passesNeutralFilter } from './newsSentimentFilters'
import { resolveNewsSentimentEmptyState } from './newsSentimentEmptyState'
import { isNewsSentimentOutOfDate } from './newsSentimentFreshness'
import { NewsSentimentStrength } from './NewsSentimentStrength'

export type NewsSentimentText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['newsSentiment']

export function NewsSentimentCard(props: {
  text: NewsSentimentText
  view?: NewsSentimentView
  loading: boolean
  failed: boolean
  onOpenAll: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  onSelectItem: (item: NewsSentimentItemView) => void
  /** Opens the product's source settings; the "sources are off" state has no other way forward. */
  onOpenSources?: () => void
  /** Collects the named sources now: "run once" after a first enable, "try again" after a failure. */
  onRunSources?: (sourceIds: readonly string[]) => void
  includeNeutral?: boolean
  onIncludeNeutralChange?: (includeNeutral: boolean) => void
}): React.ReactElement {
  const { text, view, loading, failed } = props
  const formatTime = useShellTimeFormat()
  const available = view?.state === 'available'
  const [visibleCount, setVisibleCount] = useState(8)
  const includeNeutral = props.includeNeutral ?? true
  const filteredItems = (view?.items ?? []).filter((item) => passesNeutralFilter(item, includeNeutral))
  const drivers = available
    ? [...filteredItems].sort(
        (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.strength * b.confidence - a.strength * a.confidence
      )
    : []
  useEffect(() => { setVisibleCount(8) }, [view?.asOf, view?.window, view?.items?.length ?? 0, includeNeutral])
  const visibleDrivers = drivers.slice(0, visibleCount)
  // A view that did not come from the query (a fixture, a partial DTO) must not throw here: without
  // a usable instant there is no window edge, and the card then says only what it can support.
  const windowStart = view?.asOf && NEWS_SENTIMENT_WINDOW_MS[view.window] !== undefined
    ? new Date(Date.parse(view.asOf) - NEWS_SENTIMENT_WINDOW_MS[view.window]).toISOString()
    : ''
  const emptyState = view
    ? resolveNewsSentimentEmptyState({
        state: view.state,
        itemCount: (view.items ?? []).length,
        windowStart,
        ...(view.readiness ? { readiness: view.readiness } : {}),
        ...(view.latestKnownItemAt ? { latestKnownItemAt: view.latestKnownItemAt } : {})
      })
    : undefined
  // Without a source status an empty window has no known cause. Saying "no related news" there would
  // turn "I cannot tell" into a reading, which is the one thing this card must not do.
  const causeUnknown = view?.state === 'empty' && !view.readiness
  const outOfDate = view && available
    ? isNewsSentimentOutOfDate({
        asOf: view.asOf,
        ...(view.latestKnownItemAt ? { latestKnownItemAt: view.latestKnownItemAt } : {}),
        ...(view.readiness ? { readiness: view.readiness } : {})
      })
    : false
  const emptyAction = emptyState && !causeUnknown ? emptyStateAction(emptyState.kind, props, text) : undefined
  const emptySentence = emptyState && !causeUnknown ? emptyStateText(emptyState, text, formatTime) : undefined
  // IconButton takes keys, not sentences: the two icon-only triggers own this tiny map.
  const iconLabelText: Record<string, string> = {
    'news.sentiment.settings': text.settings,
    'news.sentiment.refresh': text.refresh
  }
  const resolveIconText = (key: string): string => iconLabelText[key] ?? key

  return (
    <section className="mi-news-sentiment" data-news-sentiment-card aria-label={text.title}>
      <header className="mi-news-sentiment__header">
        <Newspaper aria-hidden="true" size={14} />
        <h2>{text.title}</h2>
        <div className="mi-news-sentiment__header-actions">
          <Segmented
            aria-label={text.neutralFilter.label}
            className="mi-news-sentiment__neutral-filter"
            onChange={(value) => props.onIncludeNeutralChange?.(value === 'all')}
            options={[
              { label: text.neutralFilter.all, value: 'all' },
              { label: text.neutralFilter.exclude, value: 'exclude' }
            ]}
            size="small"
            value={includeNeutral ? 'all' : 'exclude'}
          />
          <Button className="mi-news-sentiment__open-all" onClick={props.onOpenAll} size="small" type="link">{text.openAll} →</Button>
          <IconButton
            ariaLabelKey="news.sentiment.settings"
            icon={Settings}
            onSelect={props.onOpenSettings}
            resolveText={resolveIconText}
            size="md"
            tooltipKey="news.sentiment.settings"
          />
          <IconButton
            ariaLabelKey="news.sentiment.refresh"
            icon={RefreshCw}
            onSelect={props.onRefresh}
            resolveText={resolveIconText}
            size="md"
            tooltipKey="news.sentiment.refresh"
          />
        </div>
      </header>

      {failed || causeUnknown ? (
        <div className="mi-news-sentiment__state" data-news-sentiment-state="unavailable">
          <p>{text.unavailable}</p>
          <Button onClick={props.onRefresh} size="small">{text.retry}</Button>
        </div>
      ) : loading && !view ? (
        <div className="mi-news-sentiment__state" data-news-sentiment-state="loading"><LoadingState label={text.loading} minHeight={140} /></div>
      ) : emptyState && emptySentence ? (
        // Five different "no rows" situations, five different sentences, each carrying the next step
        // except the one that is a fact rather than a fault. Nothing here relies on colour.
        <div className="mi-news-sentiment__state" data-news-sentiment-state={emptyState.kind}>
          <p>{emptySentence}</p>
          {emptyAction ? <Button onClick={emptyAction.run} size="small" type="primary">{emptyAction.label}</Button> : null}
        </div>
      ) : !available ? (
        <div className="mi-news-sentiment__state" data-news-sentiment-state="empty">
          <p>{text.drawer.emptyFiltered}</p>
        </div>
      ) : visibleDrivers.length === 0 ? (
        // A read that succeeded but whose rows were filtered out is not an empty window: say which
        // of the two it is, or the reader cannot tell a quiet day from a broken card.
        <div className="mi-news-sentiment__state" data-news-sentiment-state="filtered-empty">
          <p>{text.drawer.emptyFiltered}</p>
        </div>
      ) : (
        <>
          <div
            className="mi-news-sentiment__drivers"
            onScroll={(event) => {
              const node = event.currentTarget
              if (node.scrollTop + node.clientHeight >= node.scrollHeight - 24 && visibleCount < drivers.length) {
                setVisibleCount((count) => Math.min(count + 8, drivers.length))
              }
            }}
          >
            {visibleDrivers.map((item) => (
              <button key={item.itemId} onClick={() => props.onSelectItem(item)} type="button">
                <span className="mi-news-sentiment__driver-line">
                  <span className={`mi-news-sentiment__pill is-${item.polarity}`}>{labelText(text, item.polarity)}</span>
                  <span className="mi-news-sentiment__title">{item.displayTitle ?? item.title}</span>
                </span>
                <small className="mi-news-sentiment__driver-meta">{item.sourceName} · {formatTime(item.publishedAt, 'minute')} <NewsSentimentStrength compact strength={item.strength} text={text} /></small>
              </button>
            ))}
          </div>
          {/* Not a fault indicator: when the newest judgment is older than three collection cycles of
              the slowest source, the rows are still true but they are old, and the reader should know
              that without asking. Same field (`latestKnownItemAt`) as the stale empty state. */}
          {outOfDate && view?.latestKnownItemAt
            ? <p className="mi-news-sentiment__updated" data-news-sentiment-updated>{text.updatedAt.replace('{time}', formatTime(view.latestKnownItemAt, 'minute'))}</p>
            : null}
          {/* The footer used to carry a card-wide "Rules" badge whenever any visible item was
              scored by the rule engine. It named no item, looked like a dead control, and the
              drawer already reports each item's engine, so only the caveat remains — and the
              footer disappears entirely when there is nothing to say. */}
          {view?.caveats.includes('news-body-limited')
            ? <footer className="mi-news-sentiment__footer"><span>{text.bodyLimited}</span></footer>
            : null}
        </>
      )}
    </section>
  )
}

function emptyStateText(
  state: import('./newsSentimentEmptyState').NewsSentimentEmptyState,
  text: NewsSentimentText,
  formatTime: (instant: string, precision?: 'minute') => string
): string {
  switch (state.kind) {
    case 'sources-disabled': return text.emptyStates.sourcesDisabled
    case 'collection-failed': return text.emptyStates.collectionFailed
    case 'never-ran': return text.emptyStates.neverRan
    case 'stale': return text.emptyStates.stale.replace('{time}', formatTime(state.lastKnownItemAt ?? '', 'minute'))
    case 'quiet': return text.emptyStates.quiet
  }
}

/**
 * The next step, once per cause. The quiet case has none on purpose: a quiet period is the answer,
 * not a fault to retry.
 */
function emptyStateAction(
  kind: import('./newsSentimentEmptyState').NewsSentimentEmptyKind,
  props: { onOpenSources?: () => void; onRunSources?: (sourceIds: readonly string[]) => void; onRefresh: () => void; view?: NewsSentimentView },
  text: NewsSentimentText
): Readonly<{ label: string; run: () => void }> | undefined {
  const readiness = props.view?.readiness
  switch (kind) {
    case 'sources-disabled':
      return props.onOpenSources ? { label: text.emptyStates.actions.openSettings, run: props.onOpenSources } : undefined
    case 'collection-failed':
      return props.onRunSources && readiness
        ? { label: text.emptyStates.actions.retry, run: () => props.onRunSources?.(readiness.failedSourceIds) }
        : undefined
    case 'never-ran':
      return props.onRunSources && readiness
        ? { label: text.emptyStates.actions.runNow, run: () => props.onRunSources?.(readiness.neverRanSourceIds) }
        : undefined
    case 'stale':
      return { label: text.emptyStates.actions.refresh, run: props.onRefresh }
    case 'quiet':
      return undefined
  }
}
