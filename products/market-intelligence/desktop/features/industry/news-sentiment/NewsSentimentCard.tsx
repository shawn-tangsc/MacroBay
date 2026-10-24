import { GitCompareArrows, Minus, Newspaper, RefreshCw, Settings, TrendingDown, TrendingUp } from 'lucide-react'

import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { productText } from '../../../shared/i18n/productText'
import type { NewsSentimentWindow } from '../../../../service/intelligence/schema/newsSentiment'
import type { NewsSentimentItemView, NewsSentimentView } from '../../../../service/intelligence/news-sentiment/newsSentimentQuery'

export type NewsSentimentText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['newsSentiment']

const WINDOWS: NewsSentimentWindow[] = ['1h', '4h', '24h']

export function NewsSentimentCard(props: {
  text: NewsSentimentText
  view?: NewsSentimentView
  loading: boolean
  failed: boolean
  window: NewsSentimentWindow
  onWindowChange: (window: NewsSentimentWindow) => void
  onOpenAll: () => void
  onOpenSettings: () => void
  onRefresh: () => void
  onSelectItem: (item: NewsSentimentItemView) => void
}): React.ReactElement {
  const { text, view, loading, failed } = props
  const formatTime = useShellTimeFormat()
  const summary = view?.state === 'available' ? view.summary : undefined
  const drivers = summary ? [...(view?.items ?? [])].sort((a, b) => b.strength * b.confidence - a.strength * a.confidence).slice(0, 3) : []

  return (
    <section className="mi-news-sentiment" data-news-sentiment-card aria-label={text.title}>
      <header className="mi-news-sentiment__header">
        <Newspaper aria-hidden="true" size={14} />
        <h2>{text.title}</h2>
        <div className="mi-news-sentiment__window" role="group" aria-label={text.title}>
          {WINDOWS.map((window) => (
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
        <button aria-label={text.settings} className="mi-news-sentiment__icon" onClick={props.onOpenSettings} type="button">
          <Settings aria-hidden="true" size={13} />
        </button>
        <button aria-label={text.refresh} className="mi-news-sentiment__icon" onClick={props.onRefresh} type="button">
          <RefreshCw aria-hidden="true" size={13} />
        </button>
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
          <button onClick={props.onOpenAll} type="button">{text.openAll}</button>
        </div>
      ) : (
        <>
          <div className="mi-news-sentiment__summary">
            <span className={`mi-news-sentiment__pill is-${summary.label}`} data-news-sentiment-label={summary.label}>
              {labelText(text, summary.label)}
            </span>
            <strong>{text.counts.replace('{count}', String(summary.itemCount))}</strong>
            <span className="mi-news-sentiment__breakdown">
              {text.breakdown
                .replace('{bull}', String(count(items(view), 'bullish')))
                .replace('{bear}', String(count(items(view), 'bearish')))
                .replace('{flat}', String(summary.neutralCount))}
            </span>
          </div>
          <div className="mi-news-sentiment__drivers">
            {drivers.map((item) => (
              <button key={item.itemId} onClick={() => props.onSelectItem(item)} type="button">
                <i className={`is-${item.polarity}`} aria-hidden="true" />
                <span className="mi-news-sentiment__title">{item.displayTitle ?? item.title}</span>
                <small>{item.sourceName} · {formatTime(item.publishedAt, 'minute')}</small>
              </button>
            ))}
          </div>
          <footer className="mi-news-sentiment__footer">
            {summary.engineMix.rules > 0 ? <span className="mi-news-sentiment__badge">{text.engine.rules}</span> : null}
            {view?.caveats.includes('news-body-limited') ? <span>{text.bodyLimited}</span> : null}
            <button onClick={props.onOpenAll} type="button">{text.openAll} →</button>
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
