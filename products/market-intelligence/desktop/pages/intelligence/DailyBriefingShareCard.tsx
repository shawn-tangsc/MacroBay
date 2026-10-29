import type { BriefingMarketRow, BriefingPulseRow, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { formatBriefingChange, formatBriefingValue } from '../../../contracts/dailyBriefingFormat'
import type { DailyBriefingText } from './DailyBriefingDocumentView'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

/**
 * The image edition. It deliberately drops the app chrome and the rail: a reader posts one page,
 * so the type is larger, the hierarchy is editorial, and the background is paper rather than the
 * product's dark working surface.
 */
export function DailyBriefingShareCard({ document: doc, text, locale, eventTitles, readOnly = false, formatTime }: Readonly<{
  document: DailyBriefingDocument
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  eventTitles?: Record<string, string>
  readOnly?: boolean
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  const rows = [...doc.data.market, ...doc.data.funds, ...(doc.data.sentiment.fearGreed ? [doc.data.sentiment.fearGreed] : [])]
  const must = rows.filter((row) => row.importance.tier === 'must')
  const chosen = must.length > 0 ? must : rows.filter((row) => row.importance.tier === 'support')
  const conclusion = doc.conclusion
  const hasNews = doc.news.items.length > 0 || doc.news.macro.length > 0
  const hasData = chosen.length > 0
  const hasBasis = Boolean(conclusion && (conclusion.conditions.length > 0 || conclusion.counterEvidence.length > 0 || conclusion.dataGaps.length > 0 || conclusion.caveats.length > 0))
  const keyRows = chosen.slice(0, 4)
  const metricRows = chosen.slice(4, 8)
  const etfRows = doc.data.funds.filter((row) => row.id === 'etf-btc' || row.id === 'etf-eth')
  const focusEvent = doc.next.items.find((item) => item.titleKey && FOCUS_TITLE_KEYS.has(item.titleKey)) ?? doc.next.items[0]
  const otherEvents = doc.next.items.filter((item) => item !== focusEvent)
  const newsCounts = doc.data.sentiment.news.counts
  const newsTotal = doc.data.sentiment.news.itemCount ?? 0
  return <article className="mi-brief-poster">
    <header className="mi-brief-poster__head">
      <div>
        <p className="mi-brief-poster__kicker">MI · DAILY BRIEF</p>
        <h1>{text.title}</h1>
        <p className="mi-brief-poster__meta">{doc.edition.date} · {text.window.replace('{time}', formatTime(doc.edition.windowEnd, 'minute'))} · {text.edition.replace('{time}', formatTime(doc.edition.generatedAt, 'minute'))}</p>
      </div>
      <div className="mi-brief-poster__head-side">
        {readOnly ? <span className="mi-brief-poster__readonly">{text.history.readOnly}</span> : null}
        <span className="mi-brief-poster__readings">{doc.status.readingsAvailable}/{doc.status.readingsTotal} {text.readingsUnit}</span>
      </div>
    </header>
    {doc.lede.text ? <p className="mi-brief-poster__lede">{doc.lede.text}</p> : null}
    {conclusion ? <div className="mi-brief-poster__signal">
      <span>{localizedDirectionTerm(conclusion.direction, locale)}</span>
      <b>{conclusion.summary.split(/[。.!?]/)[0]}</b>
      <small>{text.sections.conclusion} · {formatTime(conclusion.publishedAt, 'minute')}</small>
    </div> : null}

    {hasNews ? <section className="mi-brief-poster__news-section">
      <h2>{text.sections.news}</h2>
      {doc.news.items.map((item) => <div className="mi-brief-poster__news" key={item.itemId}>
        <span data-polarity={item.polarity}>{item.publishedAt.slice(11, 16)}</span>
        <div>
          <p>{item.translatedTitle ?? item.title}</p>
          {item.why ? <small>{item.why}</small> : null}
        </div>
        <span className="mi-brief-poster__news-source">{item.sourceName}</span>
      </div>)}
      {doc.news.macro.map((item) => <div className="mi-brief-poster__news" key={item.eventKey}>
        <span data-polarity="macro">{formatTime(item.scheduledAt, 'minute')}</span>
        <div>
          <p>{eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title}</p>
          <small>{text.macro.actual} {item.actual ?? '—'} · {text.macro.consensus} {item.consensus ?? text.macro.noConsensus} · {text.macro.surprise[item.surprise.direction]}</small>
        </div>
      </div>)}
    </section> : null}

    {hasData ? <section className="mi-brief-poster__data-section">
      <h2>{text.sections.data}</h2>
      <div className="mi-brief-poster__numbers">
        {keyRows.map((row) => <div className="mi-brief-poster__number" key={row.id}>
          <span>{rowLabel(text, row.labelKey)}</span>
          <strong>{formatBriefingValue(row.value, text.noValue, locale)}</strong>
          <small>{formatBriefingChange(row.change, locale) || stateLabel(row, text)}</small>
        </div>)}
      </div>
      {metricRows.length > 0 ? <div className="mi-brief-poster__metrics">
        {metricRows.map((row) => <div key={row.id}><span>{rowLabel(text, row.labelKey)}</span><b>{formatBriefingValue(row.value, text.noValue, locale)}</b></div>)}
      </div> : null}
      {etfRows.length > 0 || newsCounts ? <div className="mi-brief-poster__visuals">
        {etfRows.length > 0 ? <div className="mi-brief-poster__visual">
          <h3>{text.visuals.etf}</h3>
          {etfRows.map((row) => <div className="mi-brief-poster__flow" key={row.id}>
            <span>{rowLabel(text, row.labelKey)}</span>
            <div className="mi-brief-poster__flow-track"><i data-positive={Boolean(row.value && row.value.number >= 0)} style={{ width: `${Math.min(100, Math.max(4, Math.abs(row.value?.number ?? 0) / 200_000_000 * 100))}%` }} /></div>
            <b>{formatBriefingValue(row.value, text.noValue, locale)}</b>
          </div>)}
        </div> : null}
        {newsCounts && newsTotal > 0 ? <div className="mi-brief-poster__visual">
          <h3>{text.visuals.news}</h3>
          <div className="mi-brief-poster__polarity">
            <i style={{ width: `${newsCounts.bearish / newsTotal * 100}%`, background: '#be3a2b' }} />
            <i style={{ width: `${newsCounts.bullish / newsTotal * 100}%`, background: '#2f7d45' }} />
            <i style={{ width: `${newsCounts.mixed / newsTotal * 100}%`, background: '#b45309' }} />
            <i style={{ width: `${newsCounts.neutral / newsTotal * 100}%`, background: '#b9b1a2' }} />
          </div>
          <small>{text.groups.sentiment} · {newsTotal} · {newsCounts.bearish} / {newsCounts.bullish} / {newsCounts.mixed} / {newsCounts.neutral}</small>
        </div> : null}
      </div> : null}
    </section> : null}

    {conclusion ? <section className="mi-brief-poster__conclusion">
      <h2>{text.sections.conclusion}</h2>
        <div className="mi-brief-poster__direction" data-direction={conclusion.direction}>{localizedDirectionTerm(conclusion.direction, locale)}</div>
        <p className="mi-brief-poster__summary">{conclusion.summary}</p>
        {conclusion.translation ? <p className="mi-brief-poster__translation">{text.translated} · {conclusion.translation}</p> : null}
        {conclusion.invalidations[0] ? <p className="mi-brief-poster__invalidate">{text.conclusion.invalidation}：{conclusion.invalidations[0].text}</p> : null}
    </section> : null}

    {hasBasis && conclusion ? <section className="mi-brief-poster__basis">
      <h2>{text.sections.basis}</h2>
      <div className="mi-brief-poster__basis-grid">
        {conclusion.conditions.length > 0 ? <div className="mi-brief-poster__basis-card cond"><h3>{text.conclusion.conditions}</h3><p>{conclusion.conditions.join(' · ')}</p></div> : null}
        {conclusion.counterEvidence.length > 0 ? <div className="mi-brief-poster__basis-card counter"><h3>{text.conclusion.counter}</h3><p>{conclusion.counterEvidence.map((claim) => `${claim.statement}${claim.citations.length ? ` [${claim.citations.join('][')}]` : ''}`).join(' · ')}</p></div> : null}
        {conclusion.dataGaps.length > 0 || conclusion.caveats.length > 0 ? <div className="mi-brief-poster__basis-card gaps"><h3>{text.conclusion.gaps} / {text.conclusion.caveats}</h3><p>{[...conclusion.dataGaps, ...conclusion.caveats].join(' · ')}</p></div> : null}
      </div>
    </section> : null}

    {doc.next.items.length > 0 ? <section className="mi-brief-poster__next">
      <div className="mi-brief-poster__next-head">
        <h2>{text.sections.next}</h2>
        <span>{text.next.count.replace('{count}', String(doc.next.items.length))}</span>
      </div>
      {focusEvent ? <div className="mi-brief-poster__next-focus">
        <div className="mi-brief-poster__next-focus-head">
          <span className="mi-brief-poster__next-tag">{text.next.focus}</span>
          <time>{formatTime(focusEvent.at, 'minute')}</time>
        </div>
        <h3>{nextTitle(focusEvent, eventTitles)}</h3>
        <p>{text.next.category[focusEvent.category]} · {text.next.importance[focusEvent.importance]}{nextCountry(focusEvent) ? ` · ${nextCountry(focusEvent)}` : ''}</p>
        <div className="mi-brief-poster__next-values">
          {focusEvent.consensus ? `${text.next.expected} ${focusEvent.consensus}` : ''}
          {focusEvent.previous ? `${focusEvent.consensus ? ' · ' : ''}${text.next.previous} ${focusEvent.previous}` : ''}
        </div>
        <small className="mi-brief-poster__next-soon">{text.next.soon.replace('{days}', String(daysUntil(focusEvent.at, doc.edition.windowEnd)))}</small>
      </div> : null}
      {otherEvents.length > 0 ? <div className="mi-brief-poster__next-rows">
        {otherEvents.map((item) => <div className="mi-brief-poster__next-row" key={item.eventKey}>
          <time>{formatTime(item.at, 'minute')}</time>
          <div><b>{nextTitle(item, eventTitles)}</b><small>{text.next.category[item.category]} · {text.next.importance[item.importance]}{nextCountry(item) ? ` · ${nextCountry(item)}` : ''}</small></div>
          <span>{[item.consensus ? `${text.next.expected} ${item.consensus}` : '', item.previous ? `${text.next.previous} ${item.previous}` : ''].filter(Boolean).join(' · ')}</span>
        </div>)}
      </div> : null}
    </section> : null}


    {doc.citations.length > 0 ? <div className="mi-brief-poster__footnotes">
      {doc.citations.map((entry) => <span key={entry.index}>
        <b>[{entry.index}]</b>{entry.statement ? `${entry.statement} · ` : ''}{citationSource(entry)}{citationTime(entry, formatTime) ? ` · ${citationTime(entry, formatTime)}` : ''}
      </span>)}
    </div> : null}

    <footer className="mi-brief-poster__foot">
      <span>{text.citations}</span>
      <span>MI · DAILY BRIEF · {formatTime(doc.provenance.readAt, 'minute')}</span>
    </footer>
  </article>
}

const FOCUS_TITLE_KEYS = new Set(['nonfarm-payrolls', 'unemployment', 'average-hourly-earnings', 'fomc', 'cpi', 'pce', 'gdp'])

function nextTitle(item: DailyBriefingDocument['next']['items'][number], eventTitles?: Record<string, string>): string {
  return eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title
}

function nextCountry(item: DailyBriefingDocument['next']['items'][number]): string {
  return item.countryName ?? item.countryCode ?? ''
}

function daysUntil(at: string, from: string): number {
  const diff = Date.parse(at) - Date.parse(from)
  return Number.isFinite(diff) ? Math.max(0, Math.ceil(diff / 86_400_000)) : 0
}

function citationSource(entry: Readonly<{ refId: string; sourceLabel?: string }>): string {
  if (entry.sourceLabel) return entry.sourceLabel
  if (entry.refId.startsWith('query:defillama-stablecoins')) return 'DefiLlama Stablecoins'
  if (entry.refId.startsWith('query:0xrouter')) return '0xRouter'
  if (entry.refId.startsWith('macro-calendar')) return '宏观日历'
  if (entry.refId.startsWith('news')) return '新闻'
  return '分析证据'
}

function citationTime(entry: Readonly<{ refId: string; observedAt?: string }>, formatTime: (value: string, precision?: 'minute' | 'second') => string): string {
  if (entry.observedAt) return formatTime(entry.observedAt, 'minute')
  const match = entry.refId.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
  return match ? formatTime(match[0], 'minute') : ''
}

function rowLabel(text: DailyBriefingText, labelKey: string): string {
  return text.rows[labelKey.split('.').pop() as keyof DailyBriefingText['rows']] ?? labelKey
}

function stateLabel(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText): string {
  if (row.state === 'source-disabled') return text.states['source-disabled']
  if (row.state === 'unavailable') return text.states.unavailable
  return row.observedAt ? text.states[row.state] : ''
}
