import type { BriefingMarketRow, BriefingPulseRow, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { formatBriefingChange, formatBriefingValue } from '../../../contracts/dailyBriefingFormat'
import type { DailyBriefingText } from './dailyBriefingText'
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
  const support = rows.filter((row) => row.importance.tier === 'support')
  const conclusion = doc.conclusion
  const visibleNews = doc.news.items.filter((item) => item.visibility !== 'hidden')
  const visibleMacro = doc.news.macro.filter((item) => item.visibility !== 'hidden')
  const hasNews = visibleNews.length > 0 || visibleMacro.length > 0
  const hasData = chosen.length > 0
  const hasBasis = Boolean(conclusion && (conclusion.conditions.length > 0 || conclusion.counterEvidence.length > 0))
  const keyIds = ['btc', 'eth', 'stablecoin', 'etf-btc'] as const
  const keyRows = keyIds.flatMap((id) => {
    const row = chosen.find((candidate) => candidate.id === id)
    return row && row.value !== null ? [row] : []
  })
  const keySet = new Set(keyRows.map((row) => row.id))
  const reference = rows.filter((row) => row.importance.tier === 'reference')
  const metricRows = [...chosen.filter((row) => !keySet.has(row.id)), ...support, ...reference]
  const etfRows = doc.data.funds.filter((row) => row.id === 'etf-btc' || row.id === 'etf-eth')
  const footnotes = groupCitations(doc.citations)
  const focusEvent = doc.next.focus ?? doc.next.items[0]
  const otherEvents = doc.next.items.filter((item) => item.eventKey !== focusEvent?.eventKey)
  const newsCounts = doc.data.sentiment.news.counts
  const newsTotal = doc.data.sentiment.news.itemCount ?? 0
  const flowMax = niceFlowMax(etfRows)
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
    {doc.comparison ? <p className="mi-brief-poster__comparison">{comparisonText(doc, text, locale)}</p> : null}
    {doc.lede.text ? <p className="mi-brief-poster__lede">{doc.lede.text}</p> : null}

    {hasNews ? <section className="mi-brief-poster__news-section">
      <h2>{text.sections.news}</h2>
      {visibleNews.map((item) => <div className="mi-brief-poster__news" key={item.itemId}>
        <span data-polarity={item.polarity}>{clockWithZone(item.publishedAt, formatTime)}</span>
        <div>
          <p>{item.translatedTitle ?? item.title}{item.why ? <span className="mi-brief-poster__news-focus">{text.newsFocus}</span> : null}</p>
          {item.why ? <small>{item.why}</small> : null}
        </div>
        <span className="mi-brief-poster__news-source">{item.sourceName}</span>
      </div>)}
      {visibleMacro.length > 0 ? <h3 className="mi-brief-poster__macro-head">{text.sections.macro}</h3> : null}
      {visibleMacro.map((item) => <div className="mi-brief-poster__macro" key={item.eventKey}>
        <span data-polarity="macro">{macroTime(item.scheduledAt, formatTime)}</span>
        <div>
          <p>{eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title}</p>
          <small>{text.macro.actual} {item.actual ?? '—'} · {item.consensus ? `${text.macro.consensus} ${item.consensus}` : text.macro.noConsensus}{item.previous ? ` · ${text.macro.previous} ${item.previous}` : ''}{item.surprise.direction !== 'consensus-unavailable' ? ` · ${text.macro.surprise[item.surprise.direction]}` : ''}</small>
          {item.why ? <small className="mi-brief-poster__news-reason">{item.why}</small> : null}
        </div>
      </div>)}
    </section> : null}

    {hasData ? <section className="mi-brief-poster__data-section">
      <h2>{text.sections.data}</h2>
      <div className="mi-brief-poster__numbers" data-count={keyRows.length}>
        {keyRows.map((row) => <div className="mi-brief-poster__number mi-brief-poster__key" key={row.id} data-tone={toneFor(row)}>
          <span>{rowLabel(text, row.labelKey)}</span>
          <strong>{formatBriefingValue(row.value, text.noValue, locale)}</strong>
          <small>{keyMeta(row, text, locale, formatTime)}</small>
        </div>)}
      </div>
      {doc.data.leverage ? <div className="mi-brief-poster__leverage">
        <span>杠杆</span>
        <b>BTC OI {doc.data.leverage.btc.openInterestUsd !== undefined ? `$${(doc.data.leverage.btc.openInterestUsd / 1e9).toFixed(2)}B` : '—'} · 24h {doc.data.leverage.btc.change24hPct !== undefined ? `${doc.data.leverage.btc.change24hPct.toFixed(1)}%` : '—'}</b>
        <b>ETH OI {doc.data.leverage.eth.openInterestUsd !== undefined ? `$${(doc.data.leverage.eth.openInterestUsd / 1e9).toFixed(2)}B` : '—'} · 24h {doc.data.leverage.eth.change24hPct !== undefined ? `${doc.data.leverage.eth.change24hPct.toFixed(1)}%` : '—'}</b>
      </div> : null}
      {metricRows.length > 0 ? <div className="mi-brief-poster__metrics">
        {metricRows.map((row) => <div key={row.id} data-tone={toneFor(row)}><span>{rowLabel(text, row.labelKey)}</span><b>{formatBriefingValue(row.value, text.noValue, locale)}</b></div>)}
      </div> : null}
    </section> : null}

    {newsTotal > 0 ? <p className="mi-brief-poster__news-summary">{text.visuals.news} · {newsTotal} 条：{text.polarity.bearish} {newsCounts?.bearish ?? 0} · {text.polarity.bullish} {newsCounts?.bullish ?? 0} · {text.polarity.mixed} {newsCounts?.mixed ?? 0} · {text.polarity.neutral} {newsCounts?.neutral ?? 0}</p> : null}

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
      </div>
    </section> : null}

    {doc.next.items.length > 0 || doc.next.focus ? <section className="mi-brief-poster__next">
      <div className="mi-brief-poster__next-head">
        <h2>{text.sections.next}</h2>
        <span>{text.next.count.replace('{count}', String(doc.next.items.length + (doc.next.focus ? 1 : 0)))}</span>
      </div>
      {focusEvent ? <div className="mi-brief-poster__next-focus">
        <div className="mi-brief-poster__next-focus-head">
          <span className="mi-brief-poster__next-tag">{text.next.focus}</span>
          <time>{nextTime(focusEvent.at, formatTime)}</time>
        </div>
        <h3>{nextTitle(focusEvent, eventTitles)}</h3>
        <p>{text.next.importance[focusEvent.importance]}{nextCountry(focusEvent, locale) ? ` · ${nextCountry(focusEvent, locale)}` : ''}</p>
        {focusEvent.why ? <p className="mi-brief-poster__next-why"><b>{text.next.why}</b> {focusEvent.why}</p> : null}
        {focusEvent.watch && focusEvent.watch.length > 0 ? <div className="mi-brief-poster__next-watch-grid">{focusEvent.watch.map((entry) => <div className="mi-brief-poster__next-watch" key={entry.condition}><span>{watchLabel(entry.condition, text)}</span><b>{entry.implication}</b></div>)}</div> : null}
        {focusEvent.consensus || focusEvent.previous ? <div className="mi-brief-poster__next-values">
          {focusEvent.consensus ? `${text.next.expected} ${focusEvent.consensus}` : ''}
          {focusEvent.previous ? `${focusEvent.consensus ? ' · ' : ''}${text.next.previous} ${focusEvent.previous}` : ''}
        </div> : null}
        <small className="mi-brief-poster__next-soon">{text.next.soon.replace('{days}', String(daysUntil(focusEvent.at, doc.edition.windowEnd)))}</small>
      </div> : null}
      {otherEvents.length > 0 ? <div className="mi-brief-poster__next-rows">
        {otherEvents.map((item) => <div className="mi-brief-poster__next-row" key={item.eventKey}>
          <time>{nextTime(item.at, formatTime)}</time>
          <div>
            <b>{nextCountry(item, locale) ? `${nextCountry(item, locale)} · ` : ''}{nextTitle(item, eventTitles)}</b>
            <span className="mi-brief-poster__next-pill">{text.next.importance[item.importance]}</span>
          </div>
          <span>{[item.consensus ? `${text.next.expected} ${item.consensus}` : '', item.previous ? `${text.next.previous} ${item.previous}` : ''].filter(Boolean).join(' · ')}</span>
        </div>)}
      </div> : null}
    </section> : null}


    {footnotes.length > 0 ? <div className="mi-brief-poster__footnotes">
      {footnotes.map((entry) => <span key={entry.key}>
        <b>{entry.indexes.map((index) => `[${index}]`).join('')}</b>{entry.statement ? `${entry.statement} · ` : ''}{entry.source}{entry.observedAt ? ` · ${formatTime(entry.observedAt, 'minute')}` : ''}
      </span>)}
    </div> : null}

    <footer className="mi-brief-poster__foot">
      <span>{text.citations}</span>
      <span>MI · DAILY BRIEF · {formatTime(doc.provenance.readAt, 'minute')}</span>
    </footer>
  </article>
}

function toneFor(row: BriefingMarketRow | BriefingPulseRow): 'positive' | 'negative' | 'neutral' {
  if (row.id === 'fear-greed') return 'neutral'
  const value = row.change?.value ?? row.value?.number ?? 0
  return value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'
}

function keyMeta(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText, locale: 'zh-CN' | 'en-US', formatTime: (value: string, precision?: 'minute' | 'second') => string): string {
  const change = formatBriefingChange(row.change, locale)
  if (row.id === 'etf-btc' || row.id === 'etf-eth') {
    const flow = (row.value?.number ?? 0) >= 0 ? text.flow.in : text.flow.out
    return `${flow}${row.observedAt ? ` · ${row.observedAt.slice(0, 10)}` : ''}`
  }
  return change || (row.observedAt ? formatTime(row.observedAt, 'minute') : '')
}

function shortenEventTitle(value: string): string {
  return value
    .replace(/制造业采购经理人指数/g, '制造业 PMI')
    .replace(/采购经理人指数/g, 'PMI')
    .replace(/消费者物价指数/g, 'CPI')
    .replace(/生产者物价指数/g, 'PPI')
    .replace(/非农就业人口变动/g, '非农就业')
}

function nextTime(value: string, formatTime: (value: string, precision?: 'minute' | 'second') => string): string {
  const [date, time, ...zone] = formatTime(value, 'minute').split(' ')
  return [date.slice(5), time, ...zone].filter(Boolean).join(' ')
}

function comparisonText(doc: DailyBriefingDocument, text: DailyBriefingText, locale: 'zh-CN' | 'en-US'): string {
  const comparison = doc.comparison
  if (!comparison) return ''
  const parts = [comparison.directionChanged
    ? text.comparison.directionChanged.replace('{from}', localizedDirectionTerm(comparison.previousDirection ?? doc.conclusion?.direction ?? 'undecided', locale)).replace('{to}', localizedDirectionTerm(doc.conclusion?.direction ?? 'undecided', locale))
    : text.comparison.sameDirection]
  if (comparison.fundingBtcDelta !== undefined) parts.push(text.comparison.funding.replace('{value}', `${comparison.fundingBtcDelta >= 0 ? '+' : ''}${comparison.fundingBtcDelta.toFixed(4)}pp`))
  if (comparison.stablecoinDelta !== undefined) parts.push(text.comparison.stablecoin.replace('{value}', formatBriefingValue({ number: comparison.stablecoinDelta, format: 'flow-usd' }, '—', locale)))
  if (comparison.etfBtcDelta !== undefined) parts.push(text.comparison.etf.replace('{value}', formatBriefingValue({ number: comparison.etfBtcDelta, format: 'flow-usd' }, '—', locale)))
  if (comparison.newMacroEvents) parts.push(text.comparison.newMacro.replace('{count}', String(comparison.newMacroEvents)))
  return `${text.comparison.label} · ${parts.join(' · ')}`
}

function nextTitle(item: DailyBriefingDocument['next']['items'][number], eventTitles?: Record<string, string>): string {
  const raw = eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title
  return shortenEventTitle(raw)
}

function nextCountry(item: DailyBriefingDocument['next']['items'][number], locale: 'zh-CN' | 'en-US'): string {
  if (item.countryName && item.countryName !== item.countryCode) return item.countryName
  const code = item.countryCode
  if (!code) return ''
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    US: ['美国', 'United States'], EU: ['欧元区', 'Euro area'], EZ: ['欧元区', 'Euro area'],
    DE: ['德国', 'Germany'], FR: ['法国', 'France'], GB: ['英国', 'United Kingdom'], JP: ['日本', 'Japan'], CN: ['中国', 'China']
  }
  const label = labels[code]
  return label ? label[locale === 'zh-CN' ? 0 : 1] : code
}

function daysUntil(at: string, from: string): number {
  const diff = Date.parse(at) - Date.parse(from)
  return Number.isFinite(diff) ? Math.max(0, Math.floor(diff / 86_400_000)) : 0
}

function niceFlowMax(rows: readonly Readonly<{ value: Readonly<{ number: number }> | null }>[]): number {
  const largest = rows.reduce((max, row) => Math.max(max, Math.abs(row.value?.number ?? 0)), 0)
  if (largest <= 0) return 0
  const step = largest >= 1_000_000_000 ? 500_000_000 : largest >= 100_000_000 ? 50_000_000 : 10_000_000
  return Math.ceil(largest / step) * step
}

function flowLabel(max: number, locale: 'zh-CN' | 'en-US'): string {
  return formatBriefingValue({ number: max, format: 'flow-usd' }, '—', locale).replace(' USD', '')
}

function flowBarStyle(value: number, max: number): { left: string; width: string } {
  if (max <= 0) return { left: '50%', width: '0%' }
  const percent = Math.min(50, Math.abs(value) / max * 50)
  return value >= 0 ? { left: '50%', width: `${percent}%` } : { left: `${50 - percent}%`, width: `${percent}%` }
}

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  'defillama-stablecoins': 'DefiLlama Stablecoins',
  'binance-futures-positioning': 'Binance Futures',
  '0xrouter-aggregate-provider': '0xRouter ETF',
  'alternative-fear-greed': 'Alternative.me',
  'coindesk-rss': 'CoinDesk RSS'
}

type Citation = DailyBriefingDocument['citations'][number]

function groupCitations(citations: readonly Citation[]): readonly Readonly<{ key: string; indexes: readonly number[]; statement?: string; source: string; observedAt?: string }>[] {
  const groups = new Map<string, { indexes: number[]; statement?: string; source: string; observedAt?: string }>()
  for (const entry of citations) {
    const statement = entry.statement ? entry.statement.length > 80 ? `${entry.statement.slice(0, 80)}…` : entry.statement : undefined
    const source = citationSource(entry)
    const key = `${statement ?? ''}|${source}|${entry.observedAt ?? ''}`
    const group = groups.get(key) ?? { indexes: [], ...(statement ? { statement } : {}), source, ...(entry.observedAt ? { observedAt: entry.observedAt } : {}) }
    group.indexes.push(entry.index)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, value]) => Object.freeze({ key, indexes: Object.freeze([...value.indexes]), ...(value.statement ? { statement: value.statement } : {}), source: value.source, ...(value.observedAt ? { observedAt: value.observedAt } : {}) }))
}

function citationSource(entry: Readonly<{ refId: string; sourceLabel?: string }>): string {
  if (entry.sourceLabel) return SOURCE_LABELS[entry.sourceLabel] ?? entry.sourceLabel
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

function watchLabel(condition: string, text: { next: { watchHigher: string; watchLower: string } }): string {
  const normalized = condition.trim().toLowerCase()
  if (normalized === 'higher than expected') return text.next.watchHigher
  if (normalized === 'lower than expected') return text.next.watchLower
  return condition
}

function macroTime(value: string, formatTime: (value: string, precision: 'minute') => string): React.ReactNode {
  const [date, ...rest] = formatTime(value, 'minute').split(' ')
  return <>{date}<br />{rest.join(' ')}</>
}

function clockWithZone(value: string, formatTime: (value: string, precision: 'minute') => string): string {
  const [date, time, ...zone] = formatTime(value, 'minute').split(' ')
  return `${date}\n${[time, ...zone].filter(Boolean).join(' ')}`
}
