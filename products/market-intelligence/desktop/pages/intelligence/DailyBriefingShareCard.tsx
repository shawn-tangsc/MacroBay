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

    {hasNews || hasData ? <div className="mi-brief-poster__columns">
      {hasNews ? <section>
        <h2>{text.sections.news}</h2>
        {doc.news.items.map((item) => <div className="mi-brief-poster__news" key={item.itemId}>
          <span data-polarity={item.polarity}>{item.publishedAt.slice(11, 16)}</span>
          <div>
            <p>{item.translatedTitle ?? item.title}</p>
            {item.why ? <small>{item.why}</small> : null}
          </div>
        </div>)}
        {doc.news.macro.map((item) => <div className="mi-brief-poster__news" key={item.eventKey}>
          <span data-polarity="macro">{formatTime(item.scheduledAt, 'minute')}</span>
          <div>
            <p>{eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title}</p>
            <small>{text.macro.actual} {item.actual ?? '—'} · {text.macro.consensus} {item.consensus ?? text.macro.noConsensus} · {text.macro.surprise[item.surprise.direction]}</small>
          </div>
        </div>)}
      </section> : null}

      {hasData ? <section>
        <h2>{text.sections.data}</h2>
        <div className="mi-brief-poster__numbers">
          {chosen.map((row) => <div className="mi-brief-poster__number" key={row.id}>
            <span>{rowLabel(text, row.labelKey)}</span>
            <strong>{formatBriefingValue(row.value, text.noValue, locale)}</strong>
            <small>{formatBriefingChange(row.change, locale) || stateLabel(row, text)}</small>
          </div>)}
        </div>
        {doc.data.sentiment.news.itemCount ? <p className="mi-brief-poster__news-summary">{text.groups.sentiment} · {doc.data.sentiment.news.itemCount} · {doc.data.sentiment.news.counts?.bearish ?? 0} / {doc.data.sentiment.news.counts?.bullish ?? 0} / {doc.data.sentiment.news.counts?.mixed ?? 0} / {doc.data.sentiment.news.counts?.neutral ?? 0}</p> : null}
      </section> : null}
    </div> : null}

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
      <h2>{text.sections.next}</h2>
      {doc.next.items.map((item) => <p key={item.eventKey}><b>{formatTime(item.at, 'minute')}</b> {eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title}</p>)}
    </section> : null}


    {doc.citations.length > 0 ? <div className="mi-brief-poster__footnotes">
      {doc.citations.map((entry) => <span key={entry.index}>
        <b>[{entry.index}]</b>{entry.statement ? `${entry.statement} · ` : ''}{entry.sourceLabel ?? entry.refId}{entry.observedAt ? ` · ${formatTime(entry.observedAt, 'minute')}` : ''}
      </span>)}
    </div> : null}

    <footer className="mi-brief-poster__foot">
      <span>{text.citations}</span>
      <span>MI · DAILY BRIEF · {formatTime(doc.provenance.readAt, 'minute')}</span>
    </footer>
  </article>
}

function rowLabel(text: DailyBriefingText, labelKey: string): string {
  return text.rows[labelKey.split('.').pop() as keyof DailyBriefingText['rows']] ?? labelKey
}

function stateLabel(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText): string {
  if (row.state === 'source-disabled') return text.states['source-disabled']
  if (row.state === 'unavailable') return text.states.unavailable
  return row.observedAt ? text.states[row.state] : ''
}
