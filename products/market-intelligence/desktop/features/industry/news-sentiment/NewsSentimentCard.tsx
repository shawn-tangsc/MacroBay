import { useEffect, useState } from 'react'
import { Button, Segmented } from 'antd'
import { Newspaper, RefreshCw, Settings } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { StateView } from '@platform/ui/components/state'
import { useStateViewText } from '@platform/ui/components/state/stateViewText'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { productText } from '../../../shared/i18n/productText'
import type { NewsSentimentItemView, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
import { NEWS_SENTIMENT_WINDOW_MS } from '../../../../service/intelligence/schema/newsSentiment'
import { labelText } from './newsSentimentPresentation'
import { passesNeutralFilter } from './newsSentimentFilters'
import { resolveNewsSentimentEmptyState } from './newsSentimentEmptyState'
import { createIconTextResolver, hasIconText } from './newsSentimentIconText'
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
  /** Enables the four sources: the action `target-disabled` advertises. Always provided. */
  onEnableSources: () => void
  /** Collects the named sources now: "run once" after a first enable, "try again" after a failure. */
  onRunSources: (sourceIds: readonly string[]) => void
  /** Moves to the next wider window: the actions `older-than-window` and `nothing-in-window` advertise. */
  onWidenWindow: () => void
  includeNeutral?: boolean
  /** Clears the neutral filter: the action `filtered-out` advertises. Always provided. */
  onIncludeNeutralChange: (includeNeutral: boolean) => void
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
  // IconButton takes keys, not sentences; the resolver never falls back to the key itself.
  const resolveIconText = createIconTextResolver(text)
  // StateView owns the skeleton and takes only a key for the reason sentence; the five product
  // sentences carry `{time}`, so the resolver interpolates already-formatted strings.
  const resolveProductText = useProductTextKey()
  // StateView's own copy (status word, title) stays platform-owned; the reason sentence is ours.
  const resolveStateText = useStateViewText()
  const resolveStateReason = (key: string, params?: Record<string, string>): string => {
    const sentence = resolveProductText(key)
    if (!sentence) return ''
    return params
      ? Object.entries(params).reduce((copy, [name, value]) => copy.split(`{${name}}`).join(value), sentence)
      : sentence
  }

  return (
    <section className="mi-news-sentiment" data-news-sentiment-card aria-label={text.title}>
      <header className="mi-news-sentiment__header">
        <Newspaper aria-hidden="true" size={14} />
        <h2>{text.title}</h2>
        <div className="mi-news-sentiment__header-actions">
          <Segmented
            aria-label={text.neutralFilter.label}
            className="mi-news-sentiment__neutral-filter"
            onChange={(value) => props.onIncludeNeutralChange(value === 'all')}
            options={[
              { label: text.neutralFilter.all, value: 'all' },
              { label: text.neutralFilter.exclude, value: 'exclude' }
            ]}
            size="small"
            value={includeNeutral ? 'all' : 'exclude'}
          />
          <Button className="mi-news-sentiment__open-all" onClick={props.onOpenAll} size="small" type="link">{text.openAll} →</Button>
          {hasIconText(text, 'news.sentiment.settings') ? (
            <IconButton
              ariaLabelKey="news.sentiment.settings"
              icon={Settings}
              onSelect={props.onOpenSettings}
              resolveText={resolveIconText}
              size="md"
              tooltipKey="news.sentiment.settings"
            />
          ) : null}
          {hasIconText(text, 'news.sentiment.refresh') ? (
            <IconButton
              ariaLabelKey="news.sentiment.refresh"
              icon={RefreshCw}
              onSelect={props.onRefresh}
              resolveText={resolveIconText}
              size="md"
              tooltipKey="news.sentiment.refresh"
            />
          ) : null}
        </div>
      </header>

      {failed || causeUnknown ? (
        // The whole read is unavailable: the feature itself cannot tell which number would come back.
        <div className="mi-news-sentiment__state" data-news-sentiment-state="unavailable">
          <StateView
            action={{ labelKey: 'ui.state.action.retry', onSelect: props.onRefresh }}
            productReason={{ key: 'mi.newsSentiment.unavailable', resolve: (key, params) => resolveStateReason(key, params) }}
            reasonCode="unreadable"
            resolveText={resolveStateText}
            size="md"
            state="error"
          />
        </div>
      ) : loading && !view ? (
        <div className="mi-news-sentiment__state" data-news-sentiment-state="loading">
          <StateView resolveText={resolveStateText} size="md" state="loading" />
        </div>
      ) : emptyState && !causeUnknown ? (
        <EmptyCause
          neverRanSourceIds={view?.readiness?.neverRanSourceIds ?? []}
          onEnableSources={props.onEnableSources}
          onRefresh={props.onRefresh}
          onRunSources={props.onRunSources}
          onWidenWindow={props.onWidenWindow}
          resolve={resolveStateReason}
          state={emptyState}
          timeText={emptyState.lastKnownItemAt ? formatTime(emptyState.lastKnownItemAt, 'minute') : ''}
        />
      ) : !available ? (
        <div className="mi-news-sentiment__state" data-news-sentiment-state="empty">
          <p>{text.drawer.emptyFiltered}</p>
        </div>
      ) : visibleDrivers.length === 0 ? (
        // A read that succeeded but whose rows were filtered out is not an empty window: say which
        // of the two it is, or the reader cannot tell a quiet day from a broken card.
        <div className="mi-news-sentiment__state" data-news-sentiment-state="filtered-empty">
          <StateView
            action={{ labelKey: 'ui.state.action.clear-filter', onSelect: () => props.onIncludeNeutralChange(true) }}
            reasonCode="filtered-out"
            resolveText={resolveStateText}
            size="md"
            state="empty"
          />
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

/**
 * The five ways a window can have no rows, each rendered by the platform StateView.
 *
 * Why these five codes: a source that never ran is `not-yet` (its next step is to run it); all
 * sources switched off is `target-disabled` (the reader must re-enable them); a failing collection is
 * `error · unreadable` (retry reads again); only-out-of-window data is `older-than-window` (the
 * advertised action widens the window); a genuinely quiet period is `nothing-in-window`, which is a
 * fact and carries no action. The reason sentence stays the product's own (it carries the time in the
 * stale case); the title, status word, icon and action all stay the platform's.
 */
function EmptyCause(props: {
  state: import('./newsSentimentEmptyState').NewsSentimentEmptyState
  resolve: (key: string, params?: Record<string, string>) => string
  /** Enables the four sources: the action `target-disabled` advertises. Always provided. */
  onEnableSources: () => void
  onRunSources: (sourceIds: readonly string[]) => void
  onRefresh: () => void
  onWidenWindow: () => void
  neverRanSourceIds: readonly string[]
  timeText: string
}): React.ReactElement {
  const { state } = props
  // StateView's platform copy; the reason sentence comes from `props.resolve` above.
  const resolveStateText = useStateViewText()
  const wrap = (node: React.ReactElement) => (
    <div className="mi-news-sentiment__state" data-news-sentiment-state={state.kind}>{node}</div>
  )
  switch (state.kind) {
    case 'sources-disabled':
      return wrap(
        <StateView
          action={{ labelKey: 'ui.state.action.enable', onSelect: props.onEnableSources }}
          productReason={{ key: 'mi.newsSentiment.sources-disabled', resolve: (key, params) => props.resolve(key, params) }}
          reasonCode="target-disabled"
          resolveText={resolveStateText}
          size="md"
          state="disabled"
        />
      )
    case 'collection-failed':
      return wrap(
        <StateView
          action={{ labelKey: 'ui.state.action.retry', onSelect: props.onRefresh }}
          productReason={{ key: 'mi.newsSentiment.collection-failed', resolve: (key, params) => props.resolve(key, params) }}
          reasonCode="unreadable"
          resolveText={resolveStateText}
          size="md"
          state="error"
        />
      )
    case 'never-ran':
      return wrap(
        <StateView
          action={{ labelKey: 'ui.state.action.run-now', onSelect: () => props.onRunSources(props.neverRanSourceIds) }}
          productReason={{ key: 'mi.newsSentiment.never-ran', resolve: (key, params) => props.resolve(key, params) }}
          reasonCode="never-ran"
          resolveText={resolveStateText}
          size="md"
          state="empty"
        />
      )
    case 'stale':
      return wrap(
        <StateView
          action={{ labelKey: 'ui.state.action.widen-time-window', onSelect: props.onWidenWindow }}
          productReason={{
            key: 'mi.newsSentiment.stale',
            // Already formatted by the shell formatter; the entry takes strings, never a Date.
            params: { time: props.timeText },
            resolve: (key, params) => props.resolve(key, params)
          }}
          reasonCode="older-than-window"
          resolveText={resolveStateText}
          size="md"
          state="empty"
        />
      )
    case 'quiet':
      // A quiet window is a fact, not a fault: no next step (the product rule, D2).
      return wrap(
        <StateView
          productReason={{ key: 'mi.newsSentiment.quiet', resolve: (key, params) => props.resolve(key, params) }}
          reasonCode="nothing-in-window"
          resolveText={resolveStateText}
          size="md"
          state="empty"
        />
      )
  }
}
