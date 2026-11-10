import { useEffect, useState } from 'react'
import { Newspaper, RefreshCw } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Segmented } from '@platform/ui/components/segmented'
import { StateView, STATE_VIEW_ACTION_KEYS } from '@platform/ui/components/state'
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
import { NewsSentimentAvailabilityVeil, type NewsSentimentAvailability } from './NewsSentimentAvailability'
import { NewsSentimentStrength } from './NewsSentimentStrength'

/** 空卡片的原因 → 三态。`quiet` / `stale` 是「确实没有数据」，不盖遮罩。 */
function veilState(state: import('./newsSentimentEmptyState').NewsSentimentEmptyState): NewsSentimentAvailability | undefined {
  if (state.kind === 'sources-disabled') return 'disabled'
  if (state.kind === 'collection-failed' || state.kind === 'never-ran') return 'unreadable'
  return undefined
}

function veilReason(
  state: import('./newsSentimentEmptyState').NewsSentimentEmptyState,
  text: NewsSentimentText
): string {
  if (state.kind === 'sources-disabled') return text.availability.reasonDisabled
  return state.kind === 'collection-failed' ? text.availability.reasonFailed : text.availability.reasonNeverRan
}

function veilActionLabel(
  state: import('./newsSentimentEmptyState').NewsSentimentEmptyState,
  text: NewsSentimentText
): string {
  return state.kind === 'sources-disabled' ? text.availability.actionEnable : text.availability.actionRetry
}

/** 未启用只把读者送到抽屉（不替他开源）；读不到只重试本次读取。没有去处就不给动作。 */
function veilAction(
  state: import('./newsSentimentEmptyState').NewsSentimentEmptyState,
  props: { onOpenSources?: (focus: Readonly<{ business: 'sentiment' }>) => void; onRefresh: () => void }
): (() => void) | undefined {
  if (state.kind === 'sources-disabled') {
    return props.onOpenSources === undefined ? undefined : () => props.onOpenSources!({ business: 'sentiment' })
  }
  return () => props.onRefresh()
}

export type NewsSentimentText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['newsSentiment']

export function NewsSentimentCard(props: {
  text: NewsSentimentText
  view?: NewsSentimentView
  loading: boolean
  failed: boolean
  onRefresh: () => void
  onSelectItem: (item: NewsSentimentItemView) => void
  /**
   * 「来源没有启用」的去处：**只打开配置抽屉**（`focus.business = 'sentiment'`），不替读者开源。
   * 不给就不画那颗动作——留一颗点了没反应的按钮就是假控件。
   */
  onOpenSources?: (focus: Readonly<{ business: 'sentiment' }>) => void
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
  // "Nothing read yet" is not "nothing there": only a read that came back may end in empty or error.
  const hasRows = Boolean(view && (view.items?.length ?? 0) > 0)
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
            ariaLabelKey="pages.intelligence.portal.newsSentiment.neutralFilter.label"
            items={[
              { labelKey: 'pages.intelligence.portal.newsSentiment.neutralFilter.all', value: 'all' },
              { labelKey: 'pages.intelligence.portal.newsSentiment.neutralFilter.exclude', value: 'exclude' }
            ]}
            onChange={(value) => props.onIncludeNeutralChange(value === 'all')}
            resolveText={resolveProductText}
            value={includeNeutral ? 'all' : 'exclude'}
          />
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

      {(failed || causeUnknown) && !hasRows ? (
        // Nothing was ever read, so the card has nothing to keep: error plus the way out.
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
      ) : emptyState && !causeUnknown && veilState(emptyState) !== undefined ? (
        <div
          className="mi-source-veil-host"
          data-news-sentiment-state={emptyState.kind}
          data-veiled="true">
          {/* 底下是数据区本身（这一格为空）：焦点与读屏只走遮罩里那颗按钮。 */}
          <div aria-hidden="true" className="mi-news-sentiment__drivers" inert />
          <NewsSentimentAvailabilityVeil
            actionLabel={veilActionLabel(emptyState, text)}
            {...(veilAction(emptyState, props) === undefined ? {} : { onAction: veilAction(emptyState, props)! })}
            reason={veilReason(emptyState, text)}
            state={veilState(emptyState)!}
            text={text} />
        </div>
      ) : emptyState && !causeUnknown ? (
        <EmptyCause
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
          {failed && hasRows ? (
            // A refresh that failed keeps what the reader already had; replacing it with an error
            // panel would throw away a reading that is still true, only older.
            <p className="mi-news-sentiment__stale-read" data-news-sentiment-stale-read role="status">
              <span>{text.staleRead}</span>
              <button type="button" className="text-action" onClick={props.onRefresh}>{text.retry}</button>
            </p>
          ) : null}
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
              // 整行即动作（ui-spec「可点击行」）：保留原生 button 与既有 class，antd `Button` 表达不了
              // 这种多行富内容（换它要重写高度/内距），所以这里按组件表达不了登记。可访问名说明点开去哪；
              // 键盘可达与焦点环由原生 button 与全仓统一的 `:focus-visible` 提供；悬停底色在样式表里一条。
              <button
                aria-label={text.openItem.replace('{title}', item.displayTitle ?? item.title)}
                key={item.itemId}
                onClick={() => props.onSelectItem(item)}
                type="button"
              >
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
        </>
      )}
    </section>
  )
}

/**
 * 「确实没有数据」的两种：超出窗口（可放大窗口看更早的）与这段时间真的没有消息。
 *
 * 来源不可用那三种（未配置 / 未启用 / 读不到）**不走这里**：它们只在数据区盖一层遮罩，
 * 卡框、标题与头部工具照常（规范 §二 第 1 条）。
 */
function EmptyCause(props: {
  state: import('./newsSentimentEmptyState').NewsSentimentEmptyState
  resolve: (key: string, params?: Record<string, string>) => string
  onWidenWindow: () => void
  timeText: string
}): React.ReactElement {
  const { state } = props
  // StateView's platform copy; the reason sentence comes from `props.resolve` above.
  const resolveStateText = useStateViewText()
  const wrap = (node: React.ReactElement) => (
    <div className="mi-news-sentiment__state" data-news-sentiment-state={state.kind}>{node}</div>
  )
  switch (state.kind) {
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
    default:
      // A quiet window is a fact, not a fault — but the reader can still look further back, so this
      // code carries the widen action (the contract makes every `nothing-in-window` actionable).
      return wrap(
        <StateView
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.widen_time_window, onSelect: props.onWidenWindow }}
          productReason={{ key: 'mi.newsSentiment.quiet', resolve: (key, params) => props.resolve(key, params) }}
          reasonCode="nothing-in-window"
          resolveText={resolveStateText}
          size="md"
          state="empty"
        />
      )
  }
}
