import type { productText } from '../../shared/i18n/productText'
import type { BriefingMacroItem, BriefingNewsItem, BriefingPulseRow, BriefingMarketRow, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { analysisConclusionDirectionPolicy, analysisDirectionKey, localizedDirectionTerm } from './analysisConclusionDirectionPolicy'

type DashboardText = typeof productText['zh-CN' | 'en-US']['pages']['intelligence']['portal']['dashboard']
export type DailyBriefingText = DashboardText['dailyBriefing']

type Row = BriefingMarketRow | BriefingPulseRow

export function DailyBriefingDocumentView({ document: doc, text, locale, eventTitles, formatTime }: Readonly<{
  document: DailyBriefingDocument
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  eventTitles?: Record<string, string>
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  const rows = [
    ...doc.data.market,
    ...doc.data.funds,
    ...(doc.data.sentiment.fearGreed ? [doc.data.sentiment.fearGreed] : [])
  ]
  const must = rows.filter((row) => row.importance.tier === 'must')
  const support = rows.filter((row) => row.importance.tier === 'support')
  const reference = rows.filter((row) => row.importance.tier === 'reference')
  const conclusion = doc.conclusion
  return <div className="mi-daily-briefing__body">
    <header className="mi-daily-briefing__doc-head">
      <div>
        <p className="mi-daily-briefing__kicker">MI · DAILY BRIEF</p>
        <h2>{text.title}</h2>
        <p className="mi-daily-briefing__meta">
          {doc.edition.date}
          <em>·</em>{text.window.replace('{time}', formatTime(doc.edition.windowEnd, 'minute'))}
          <em>·</em>{text.edition.replace('{time}', formatTime(doc.edition.generatedAt, 'minute'))}
        </p>
      </div>
      <span className="mi-daily-briefing__readings" data-state={doc.status.readingsAvailable === 0 ? 'empty' : 'ok'}>
        {doc.status.readingsAvailable === 0
          ? text.readingsAllMissing
          : text.readings.replace('{available}', String(doc.status.readingsAvailable)).replace('{total}', String(doc.status.readingsTotal))}
      </span>
    </header>

    {doc.lede.text ? <p className="mi-daily-briefing__lede">{doc.lede.text}</p> : null}

    <section className="mi-daily-briefing__section" aria-label={text.sections.news}>
      <h3>{text.sections.news}</h3>
      {doc.news.items.map((item) => <NewsRow key={item.itemId} item={item} text={text} />)}
      {doc.news.macro.map((item) => <MacroRow key={item.eventKey} item={item} text={text} eventTitles={eventTitles} formatTime={formatTime} />)}
      {doc.news.items.length === 0
        ? <p className="mi-daily-briefing__empty">{doc.news.notes.newsEmpty ? text.newsEmptyCodes[doc.news.notes.newsEmpty as keyof typeof text.newsEmptyCodes] ?? text.empty.news : text.empty.news}</p>
        : null}
      {doc.news.macro.length === 0
        ? <p className="mi-daily-briefing__empty">{doc.news.notes.macroEmpty ? text.macroEmptyCodes[doc.news.notes.macroEmpty as keyof typeof text.macroEmptyCodes] ?? text.empty.macro : text.empty.macro}</p>
        : null}
    </section>

    <section className="mi-daily-briefing__section" aria-label={text.sections.data}>
      <h3>{text.sections.data}</h3>
      {must.length > 0 ? <div className="mi-daily-briefing__must-grid" data-must-count={must.length}>
        {must.map((row) => <RowCard key={row.id} row={row} text={text} formatTime={formatTime} />)}
      </div> : null}
      {support.length > 0 ? <div className="mi-daily-briefing__support">
        {support.map((row) => <RowLine key={row.id} row={row} text={text} formatTime={formatTime} />)}
      </div> : null}
      {reference.length > 0 ? <details className="mi-daily-briefing__details">
        <summary>{text.moreNumbers}</summary>
        {reference.map((row) => <RowLine key={row.id} row={row} text={text} formatTime={formatTime} />)}
      </details> : null}
      <BriefingVisuals document={doc} text={text} formatTime={formatTime} />
      {must.length > 8 ? <p className="mi-daily-briefing__dense">{text.denseDay}</p> : null}
    </section>

    <section className="mi-daily-briefing__section" aria-label={text.sections.conclusion}>
      <h3>{text.sections.conclusion}</h3>
      {conclusion ? <>
        <div className="mi-daily-briefing__conclusion" data-direction={analysisDirectionKey(conclusion.direction) ?? 'none'}>
          <div className="mi-daily-briefing__conclusion-head">
            <span className="mi-daily-briefing__direction">{localizedDirectionTerm(conclusion.direction, locale)}</span>
            {conclusion.directions.length > 0 ? <DirectionRibbon directions={conclusion.directions} text={text} locale={locale} /> : null}
          </div>
          <p>{conclusion.summary}</p>
          {conclusion.invalidations[0] ? <p className="mi-daily-briefing__invalidate"><b>{text.conclusion.invalidation}</b>：{conclusion.invalidations[0].text}</p> : null}
        </div>
        <details className="mi-daily-briefing__details">
          <summary>{text.sections.basis}</summary>
          {conclusion.topSignal ? <p className="mi-daily-briefing__basis-line">
            {conclusion.topSignal.horizon} · {localizedDirectionTerm(conclusion.topSignal.direction, locale)} · {conclusion.topSignal.confidence}
            {conclusion.topSignal.citations.length > 0 ? ` ${conclusion.topSignal.citations.map((index) => `[${index}]`).join('')}` : ''}
          </p> : null}
          {conclusionConditions(conclusion.conditions, text)}
          {conclusion.counterEvidence.map((claim) => <p className="mi-daily-briefing__basis-line" key={claim.statement}>
            {text.conclusion.counter}：{claim.statement} {claim.citations.map((index) => `[${index}]`).join('')}
          </p>)}
          {conclusion.dataGaps.length > 0 ? <p className="mi-daily-briefing__basis-line">{text.conclusion.gaps}：{conclusion.dataGaps.join(' · ')}</p> : null}
          {conclusion.caveats.length > 0 ? <p className="mi-daily-briefing__basis-line">{text.conclusion.caveats}：{conclusion.caveats.join(' · ')}</p> : null}
        </details>
      </> : <p className="mi-daily-briefing__empty">{text.empty.conclusion}</p>}
    </section>

    <section className="mi-daily-briefing__section" aria-label={text.sections.next}>
      <h3>{text.sections.next}</h3>
      <p className="mi-daily-briefing__visual-caption">{text.visuals.next}</p>
      {doc.next.items.length > 0 ? <ol className="mi-daily-briefing__timeline">
        {doc.next.items.map((item) => <li key={item.eventKey}>
          <time>{formatTime(item.at, 'minute')}</time>
          <span>{eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title}</span>
          <small>{text.next.category[item.category]}</small>
        </li>)}
      </ol> : <p className="mi-daily-briefing__empty">{doc.next.note ? text.nextEmptyCodes[doc.next.note as keyof typeof text.nextEmptyCodes] ?? text.empty.next : text.empty.next}</p>}
    </section>

    <footer className="mi-daily-briefing__foot">
      <span>{text.citations}：{doc.citations.length > 0 ? doc.citations.map((entry) => `[${entry.index}]`).join(' ') : '—'}</span>
      <span>{formatTime(doc.provenance.readAt, 'minute')}</span>
    </footer>
  </div>
}

function NewsRow({ item, text }: Readonly<{ item: BriefingNewsItem; text: DailyBriefingText }>): React.ReactElement {
  return <div className="mi-daily-briefing__news-row" data-polarity={item.polarity}>
    <span className="mi-daily-briefing__news-time">{item.publishedAt.slice(11, 16)}</span>
    <div>
      <p>{item.translatedTitle ?? item.title}</p>
      {item.why ? <small>{item.why}</small> : null}
    </div>
    <span className="mi-daily-briefing__news-side">{item.sourceName}</span>
  </div>
}

function MacroRow({ item, text, eventTitles, formatTime }: Readonly<{ item: BriefingMacroItem; text: DailyBriefingText; eventTitles?: Record<string, string>; formatTime: (value: string, precision?: 'minute' | 'second') => string }>): React.ReactElement {
  return <div className="mi-daily-briefing__news-row" data-polarity="macro">
    <span className="mi-daily-briefing__news-time">{formatTime(item.scheduledAt, 'minute')}</span>
    <div>
      <p>{eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title}</p>
      <small>
        {text.macro.actual} {item.actual ?? '—'}
        {' · '}{text.macro.consensus} {item.consensus ?? text.macro.noConsensus}
        {' · '}{text.macro.previous} {item.previous ?? '—'}
        {' · '}{text.macro.surprise[item.surprise.direction]}
      </small>
    </div>
    <span className="mi-daily-briefing__news-side">{text.macro.surprise[item.surprise.direction]}</span>
  </div>
}

function RowCard({ row, text, formatTime }: Readonly<{ row: Row; text: DailyBriefingText; formatTime: (value: string, precision?: 'minute' | 'second') => string }>): React.ReactElement {
  const label = rowLabel(text, row.labelKey)
  return <div className="mi-daily-briefing__card" data-state={row.state}>
    <span className="mi-daily-briefing__card-label">{label}</span>
    <strong className="mi-daily-briefing__card-value">{row.state === 'available' || row.state === 'stale' ? formatValue(row.value, text) : stateText(row, text)}</strong>
    <span className="mi-daily-briefing__card-meta">
      {row.state === 'available' || row.state === 'stale'
        ? [formatChange(row.change, text), row.observedAt ? formatTime(row.observedAt, 'minute') : ''].filter(Boolean).join(' · ')
        : reasonText(row, text)}
    </span>
  </div>
}

function RowLine({ row, text, formatTime }: Readonly<{ row: Row; text: DailyBriefingText; formatTime: (value: string, precision?: 'minute' | 'second') => string }>): React.ReactElement {
  return <div className="mi-daily-briefing__line" data-state={row.state}>
    <span>{rowLabel(text, row.labelKey)}</span>
    <b>{row.state === 'available' || row.state === 'stale' ? formatValue(row.value, text) : stateText(row, text)}</b>
    <small>{row.state === 'available' || row.state === 'stale' ? formatChange(row.change, text) || (row.observedAt ? formatTime(row.observedAt, 'minute') : '') : reasonText(row, text)}</small>
  </div>
}

function DirectionRibbon({ directions, text, locale }: Readonly<{ directions: readonly Readonly<{ horizon: string; direction: string; confidence: string }>[]; text: DailyBriefingText; locale: 'zh-CN' | 'en-US' }>): React.ReactElement {
  return <span className="mi-daily-briefing__ribbon" aria-label={directions.map((entry) => `${text.horizons[entry.horizon as keyof typeof text.horizons] ?? entry.horizon} ${localizedDirectionTerm(entry.direction, locale)}`).join(' · ')}>
    {directions.map((entry) => {
      const key = analysisDirectionKey(entry.direction) ?? 'undecided'
      return <i key={entry.horizon} data-confidence={entry.confidence} style={{ background: `var(${analysisConclusionDirectionPolicy.colorTokens[key]})` }} />
    })}
  </span>
}

function BriefingVisuals({ document: doc, text, formatTime }: Readonly<{ document: DailyBriefingDocument; text: DailyBriefingText; formatTime: (value: string, precision?: 'minute' | 'second') => string }>): React.ReactElement | null {
  const etfs = doc.data.funds.filter((row) => row.id === 'etf-btc' || row.id === 'etf-eth')
  const summary = doc.data.sentiment.news
  const hasFlow = etfs.some((row) => row.value)
  const hasNews = Boolean(summary.counts) && summary.itemCount !== 0
  if (!hasFlow && !hasNews) return null
  return <div className="mi-daily-briefing__visuals">
    {hasFlow ? <div className="mi-daily-briefing__visual" data-visual="etf-flow">
      <p className="mi-daily-briefing__visual-caption">{text.visuals.etf}</p>
      {etfs.map((row) => <EtfBar key={row.id} row={row} text={text} formatTime={formatTime} />)}
    </div> : null}
    {hasNews ? <div className="mi-daily-briefing__visual" data-visual="news-polarity">
      <p className="mi-daily-briefing__visual-caption">{text.visuals.news}</p>
      <PolarityStrip counts={summary.counts!} />
      <p className="mi-daily-briefing__visual-fallback">
        {text.groups.sentiment} · {summary.itemCount} · {summary.counts!.bearish} / {summary.counts!.bullish} / {summary.counts!.mixed} / {summary.counts!.neutral}
      </p>
    </div> : null}
  </div>
}

function EtfBar({ row, text, formatTime }: Readonly<{ row: BriefingPulseRow; text: DailyBriefingText; formatTime: (value: string, precision?: 'minute' | 'second') => string }>): React.ReactElement {
  const label = rowLabel(text, row.labelKey)
  if (!row.value) return <div className="mi-daily-briefing__etf-row"><span>{label}</span><b>{stateText(row, text)}</b></div>
  const width = Math.min(100, Math.max(4, Math.abs(row.value.number) / 200_000_000 * 100))
  return <div className="mi-daily-briefing__etf-row">
    <span>{label}</span>
    <div className="mi-daily-briefing__etf-track"><i data-positive={row.value.number >= 0 ? 'true' : 'false'} style={{ width: `${width}%` }} /></div>
    <b>{formatValue(row.value, text)}</b>
    <small>{row.observedAt ? formatTime(row.observedAt, 'minute') : ''}</small>
  </div>
}

function PolarityStrip({ counts }: Readonly<{ counts: NonNullable<DailyBriefingDocument['data']['sentiment']['news']['counts']> }>): React.ReactElement {
  const total = counts.bearish + counts.bullish + counts.mixed + counts.neutral || 1
  return <div className="mi-daily-briefing__polarity" role="img" aria-label={`bearish ${counts.bearish}, bullish ${counts.bullish}, mixed ${counts.mixed}, neutral ${counts.neutral}`}>
    {(['bearish', 'bullish', 'mixed', 'neutral'] as const).map((key) => <i key={key} data-polarity={key} style={{ width: `${counts[key] / total * 100}%` }} />)}
  </div>
}

function conclusionConditions(conditions: readonly string[], text: DailyBriefingText): React.ReactElement | null {
  if (conditions.length === 0) return null
  return <p className="mi-daily-briefing__basis-line">{text.conclusion.conditions}：{conditions.join(' · ')}</p>
}

function rowLabel(text: DailyBriefingText, labelKey: string): string {
  const key = labelKey.split('.').pop() as keyof DailyBriefingText['rows']
  return text.rows[key] ?? labelKey
}

function stateText(row: Row, text: DailyBriefingText): string {
  if (row.state === 'source-disabled') return text.states['source-disabled']
  if (row.state === 'unavailable') return text.states.unavailable
  return text.states[row.state]
}

function reasonText(row: Row, text: DailyBriefingText): string {
  if (!row.reason) return stateText(row, text)
  return text.reasons[row.reason as keyof typeof text.reasons] ?? text.states.unavailable
}

function formatValue(value: Row['value'], text: DailyBriefingText): string {
  if (!value) return text.noValue
  switch (value.format) {
    case 'score': return String(Math.round(value.number))
    case 'percent': return `${value.number > 0 ? '+' : ''}${value.number.toFixed(2)}%`
    case 'usd': return compactUsd(value.number)
    case 'flow-usd': return compactUsd(value.number, true)
    case 'yield': return `${value.number.toFixed(2)}%`
    case 'level': return value.number.toFixed(2)
  }
}

function compactUsd(value: number, signed = false): string {
  const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(value))
  return `${value < 0 ? '-' : signed && value > 0 ? '+' : ''}${compact} USD`
}

function formatChange(change: Row['change'], text: DailyBriefingText): string {
  if (!change) return ''
  const sign = change.value > 0 ? '+' : ''
  switch (change.unit) {
    case 'pp': return `${sign}${change.value.toFixed(4)}pp`
    case 'percent': return `${sign}${change.value.toFixed(2)}%`
    case 'bp': return `${sign}${Math.round(change.value)}bp`
    case 'usd': return compactUsd(change.value, true)
  }
}
