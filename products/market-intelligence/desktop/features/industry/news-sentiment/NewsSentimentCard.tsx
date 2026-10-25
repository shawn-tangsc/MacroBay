import { useEffect, useState } from 'react'
import { GitCompareArrows, Minus, Newspaper, RefreshCw, Settings, TrendingDown, TrendingUp } from 'lucide-react'

import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { productText } from '../../../shared/i18n/productText'
import type { NewsSentimentItemView, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'
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
}): React.ReactElement {
  const { text, view, loading, failed } = props
  const formatTime = useShellTimeFormat()
  const summary = view?.state === 'available' ? view.summary : undefined
  const [visibleCount, setVisibleCount] = useState(8)
  const [includeNeutral, setIncludeNeutral] = useState(true)
  const filteredItems = includeNeutral ? (view?.items ?? []) : (view?.items ?? []).filter((item) => item.polarity !== 'neutral')
  const drivers = summary
    ? [...filteredItems].sort(
        (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.strength * b.confidence - a.strength * a.confidence
      )
    : []
  useEffect(() => { setVisibleCount(8) }, [view?.asOf, view?.window, view?.items?.length ?? 0, includeNeutral])
  const visibleDrivers = drivers.slice(0, visibleCount)

  return (
    <section className="mi-news-sentiment" data-news-sentiment-card aria-label={text.title}>
      <header className="mi-news-sentiment__header">
        <Newspaper aria-hidden="true" size={14} />
        <h2>{text.title}</h2>
        <div className="mi-news-sentiment__header-actions">
          <span className="mi-news-sentiment__neutral-filter" role="group" aria-label={text.neutralFilter.label}>
            <button aria-pressed={includeNeutral} className={includeNeutral ? 'is-on' : undefined} onClick={() => setIncludeNeutral(true)} type="button">{text.neutralFilter.all}</button>
            <button aria-pressed={!includeNeutral} className={!includeNeutral ? 'is-on' : undefined} onClick={() => setIncludeNeutral(false)} type="button">{text.neutralFilter.exclude}</button>
          </span>
          <button className="mi-news-sentiment__open-all" onClick={props.onOpenAll} type="button">{text.openAll} →</button>
          <button aria-label={text.settings} className="mi-news-sentiment__icon" onClick={props.onOpenSettings} type="button">
            <Settings aria-hidden="true" size={13} />
          </button>
          <button aria-label={text.refresh} className="mi-news-sentiment__icon" onClick={props.onRefresh} type="button">
            <RefreshCw aria-hidden="true" size={13} />
          </button>
        </div>
      </header>

      {failed ? (
        <div className="mi-news-sentiment__state" data-news-sentiment-state="unavailable">
          <p>{text.unavailable}</p>
          <button onClick={props.onRefresh} type="button">{text.retry}</button>
        </div>
      ) : loading && !view ? (
        <div className="mi-news-sentiment__state" data-news-sentiment-state="loading"><p>{text.loading}</p></div>
      ) : !summary ? (
        <div className="mi-news-sentiment__state" data-news-sentiment-state="empty">
          <p>{text.empty}</p>
        </div>
      ) : (
        <>
          <div className="mi-news-sentiment__summary">
            <span className={`mi-news-sentiment__pill is-${summary.label}`} data-news-sentiment-label={summary.label}>
              {labelText(text, summary.label)}
            </span>
            <strong>{text.counts.replace('{count}', String(filteredItems.length))}</strong>
            <span className="mi-news-sentiment__breakdown">
              {text.breakdown
                .replace('{bull}', String(count(items(view), 'bullish')))
                .replace('{bear}', String(count(items(view), 'bearish')))
                .replace('{flat}', String(filteredItems.filter((item) => item.polarity === 'neutral').length))}
            </span>
          </div>
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
          <footer className="mi-news-sentiment__footer">
            {summary.engineMix.rules > 0 ? <span className="mi-news-sentiment__badge">{text.engine.rules}</span> : null}
            {view?.caveats.includes('news-body-limited') ? <span>{text.bodyLimited}</span> : null}
          </footer>
        </>
      )}
    </section>
  )
}

export function sentimentIcon(polarity: string): React.ReactElement {
  if (polarity === 'bullish') return <TrendingUp aria-hidden="true" size={12} />
  if (polarity === 'bearish') return <TrendingDown aria-hidden="true" size={12} />
  if (polarity === 'mixed') return <GitCompareArrows aria-hidden="true" size={12} />
  return <Minus aria-hidden="true" size={12} />
}

export function labelText(text: NewsSentimentText, label: string): string {
  if (label === 'positive' || label === 'bullish') return text.labels.bullish
  if (label === 'negative' || label === 'bearish') return text.labels.bearish
  if (label === 'mixed') return text.labels.mixed
  return text.labels.neutral
}

function items(view: NewsSentimentView | undefined): NewsSentimentItemView[] {
  return view?.items ?? []
}

function count(rows: NewsSentimentItemView[], polarity: string): number {
  return rows.filter((row) => row.polarity === polarity).length
}
