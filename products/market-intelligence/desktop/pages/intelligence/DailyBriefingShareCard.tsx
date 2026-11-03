import type { BriefingConclusionSynthesis, BriefingMarketRow, BriefingPulseRow, DailyBriefingDocument } from '../../../contracts/dailyBriefing'
import { formatBriefingValue } from '../../../contracts/dailyBriefingFormat'
import { changeLedRowCopy, formatRowChange } from '../../../contracts/dailyBriefingMarkdown'
import type { DailyBriefingText } from './dailyBriefingText'
import { localizedDirectionTerm } from './analysisConclusionDirectionPolicy'
import { hasChangeToShow } from '../../../contracts/dailyBriefingMarkdown'
import { withWindowHours } from './dailyBriefingWindowText'
import { shortenEventTitle } from './dailyBriefingEventTitle'

/**
 * The image edition. It deliberately drops the app chrome and the rail: a reader posts one page,
 * so the type is larger, the hierarchy is editorial, and the background is paper rather than the
 * product's dark working surface.
 */
export function DailyBriefingShareCard({ document: doc, text: baseText, locale, eventTitles, readOnly = false, omitFallbackReadings = false, completenessNote, formatTime }: Readonly<{
  document: DailyBriefingDocument
  /** Already produced by the one place that decides completeness; the card only renders it. */
  completenessNote?: string
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  eventTitles?: Record<string, string>
  readOnly?: boolean
  /**
   * The exported image leaves out rows whose only value is a fallback reading.
   *
   * The card gets forwarded, so a number that is not that day's exact reading must not travel as if
   * it were; the page keeps those rows, labelled, because a reader judging the day needs them.
   * "The card is for forwarding, the page is for reading" is the rule behind this switch.
   */
  omitFallbackReadings?: boolean
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  const text = withWindowHours(baseText, doc.edition.windowHours ?? 24)
  // The data region is a selection, not a dump: a row the editor did not include stays out of the
  // poster even when its value is present, and a hidden row's reason lives only in the audit.
  const rows = [...doc.data.market, ...doc.data.funds, ...(doc.data.sentiment.fearGreed ? [doc.data.sentiment.fearGreed] : [])].filter(hasChangeToShow)
    .filter((row) => row.visibility !== 'hidden')
    // A stale row carries a fallback number, never the exact reading; the exported image drops it.
    .filter((row) => !omitFallbackReadings || row.state !== 'stale')
  const must = rows.filter((row) => row.importance.tier === 'must')
  const chosen = must.length > 0 ? must : rows.filter((row) => row.importance.tier === 'support')
  const support = rows.filter((row) => row.importance.tier === 'support')
  const conclusion = doc.conclusion
  const visibleNews = doc.news.items.filter((item) => item.visibility !== 'hidden')
  const visibleMacro = doc.news.macro.filter((item) => item.visibility !== 'hidden')
  const hasNews = visibleNews.length > 0 || visibleMacro.length > 0
  const hasData = chosen.length > 0
  // What the forecast stands on: the synthesis's own premises and falsifiers, plus the one line that
  // says whether the earlier read held. The audit-only detail also carries the forward view, the
  // catalysts and the overturn threshold; they are rendered under the conclusion, not repeated here.
  const synthesis = conclusion?.synthesisDetail
  const standing = conclusion && synthesis ? basisStanding(synthesis, text) : undefined
  const regimeMarker = synthesis ? regimeChangeMarker(synthesis.regimeChange) : undefined
  const hasBasis = Boolean(conclusion && (conclusion.conditions.length > 0 || conclusion.counterEvidence.length > 0 || standing))
  const keyIds = ['btc', 'eth', 'stablecoin', 'etf-btc'] as const
  const keyRows = keyIds.flatMap((id) => {
    const row = chosen.find((candidate) => candidate.id === id)
    return row && row.value !== null ? [row] : []
  })
  const keySet = new Set(keyRows.map((row) => row.id))
  const reference = rows.filter((row) => row.importance.tier === 'reference')
  const metricRows = [...chosen.filter((row) => !keySet.has(row.id)), ...support, ...reference]
  const etfRows = doc.data.funds.filter((row) => row.id === 'etf-btc' || row.id === 'etf-eth')
  const footnotes = groupCitations(doc.citations, text)
  const focusEvent = doc.next.focus ?? doc.next.items[0]
  const otherEvents = doc.next.items.filter((item) => item.eventKey !== focusEvent?.eventKey)
  const newsCounts = doc.data.sentiment.news.counts
  const newsTotal = doc.data.sentiment.news.itemCount ?? 0
  const flowMax = niceFlowMax(etfRows)
  // `符合预期` is the baseline, not a third scenario: only the two surprises get a card, and the
  // baseline survives at most as one small footnote when it carries an actionable implication.
  const focusWatch = orderWatch(focusEvent?.watch ?? [], text)
  const watchScenarios = focusWatch.filter((entry) => entry.kind === 'lower' || entry.kind === 'higher')
  const watchBaseline = focusWatch.find((entry) => entry.kind === 'inline' && entry.implication.trim().length > 0)
  return <article className="mi-brief-poster">
    <header className="mi-brief-poster__head">
      <div>
        <p className="mi-brief-poster__kicker">MI · DAILY BRIEF</p>
        <h1>{text.title}</h1>
        <p className="mi-brief-poster__meta">{doc.edition.date} · {text.window.replace('{time}', formatTime(doc.edition.windowEnd, 'minute'))} · {text.edition.replace('{time}', formatTime(doc.edition.generatedAt, 'minute'))}</p>
        {/* The exported image carries this only when the edition is short; a complete edition says nothing. */}
        {completenessNote ? <p className="mi-brief-poster__completeness" data-completeness-note="true">{completenessNote}</p> : null}
      </div>
      <div className="mi-brief-poster__head-side">
        {readOnly ? <span className="mi-brief-poster__readonly">{text.history.readOnly}</span> : null}
        <span className="mi-brief-poster__readings">{doc.status.readingsAvailable} {text.readingsUnit}</span>
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
          <p>{macroCountry(item, text) ? `${macroCountry(item, text)} · ` : ''}{eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title}</p>
          <small>{text.macro.actual} {item.actual ?? '—'} · {item.consensus ? `${text.macro.consensus} ${item.consensus}` : text.macro.noConsensus}{item.previous ? ` · ${text.macro.previous} ${item.previous}` : ''}{item.surprise.direction !== 'consensus-unavailable' ? ` · ${text.macro.surprise[item.surprise.direction]}` : ''}</small>
          {item.why ? <small className="mi-brief-poster__news-reason">{item.why}</small> : null}
        </div>
      </div>)}
    </section> : null}

    {hasData ? <section className="mi-brief-poster__data-section">
      <h2>{text.sections.data}</h2>
      <div className="mi-brief-poster__numbers" data-count={keyRows.length}>
        {keyRows.map((row) => {
          // The poster and the Markdown copy read one rule: a change-led row headlines its move and
          // keeps the level in the caption, so a screenshot and an export cannot disagree.
          const copy = changeLedRowCopy(row, text, locale)
          return <div className="mi-brief-poster__number mi-brief-poster__key" key={row.id} data-tone={toneFor(row)} data-lead={copy ? 'change' : 'value'}>
            <span>{rowLabel(text, row.labelKey)}{fallbackLabel(row, text)}</span>
            <strong>{copy ? copy.primary : formatBriefingValue(row.value, text.noValue, locale)}</strong>
            <small>{copy ? copy.secondary : keyMeta(row, text, locale, formatTime)}</small>
          </div>
        })}
      </div>
      {doc.data.leverage && doc.data.leverage.visibility !== 'hidden' ? <div className="mi-brief-poster__leverage">
        <span>{text.sections.leverage}</span>
        <b>BTC OI {doc.data.leverage.btc.openInterestUsd !== undefined ? `$${(doc.data.leverage.btc.openInterestUsd / 1e9).toFixed(2)}B` : '—'} · 24h {doc.data.leverage.btc.change24hPct !== undefined ? `${doc.data.leverage.btc.change24hPct.toFixed(1)}%` : '—'}</b>
        <b>ETH OI {doc.data.leverage.eth.openInterestUsd !== undefined ? `$${(doc.data.leverage.eth.openInterestUsd / 1e9).toFixed(2)}B` : '—'} · 24h {doc.data.leverage.eth.change24hPct !== undefined ? `${doc.data.leverage.eth.change24hPct.toFixed(1)}%` : '—'}</b>
      </div> : null}
      {doc.data.policyPath && doc.data.policyPath.visibility !== 'hidden' ? <div className="mi-brief-poster__policy"><span>{text.sections.policyPath}</span><b>{Math.round(doc.data.policyPath.probability)}% · {policyOutcomeLabel(doc.data.policyPath.outcome, text)} · {doc.data.policyPath.meetingDate}</b><small>{text.sections.marketImplied} · {doc.data.policyPath.targetLower !== undefined ? `${doc.data.policyPath.targetLower}–${doc.data.policyPath.targetUpper}%` : text.sections.rangeUnavailable}</small></div> : null}
      {metricRows.length > 0 ? <div className="mi-brief-poster__metrics">
        {metricRows.map((row) => {
          const copy = changeLedRowCopy(row, text, locale)
          return <div key={row.id} data-tone={toneFor(row)} data-lead={copy ? 'change' : 'value'}>
            <span>{rowLabel(text, row.labelKey)}{fallbackLabel(row, text)}</span>
            <b>{copy ? copy.primary : formatBriefingValue(row.value, text.noValue, locale)}</b>
            {copy ? <small>{copy.secondary}</small> : null}
          </div>
        })}
      </div> : null}
    </section> : null}

    {newsTotal > 0 ? <p className="mi-brief-poster__news-summary">{text.visuals.news} · {text.newsCount.replace('{count}', String(newsTotal))}{text.labelSeparator}{text.polarity.bearish} {newsCounts?.bearish ?? 0} · {text.polarity.bullish} {newsCounts?.bullish ?? 0} · {text.polarity.mixed} {newsCounts?.mixed ?? 0} · {text.polarity.neutral} {newsCounts?.neutral ?? 0}</p> : null}

    {conclusion ? <section className="mi-brief-poster__conclusion">
      <h2>{text.sections.conclusion}</h2>
        <p className="mi-brief-poster__summary"><span className="mi-brief-poster__direction" data-direction={conclusion.direction}>{localizedDirectionTerm(conclusion.direction, locale)}</span>{regimeMarker ? <><span className="mi-brief-poster__regime" data-regime-change="true">{text.conclusion.regimeChanged}</span><span>{text.labelSeparator}{regimeMarker.title}</span></> : null}{conclusion.summary}</p>
        {conclusion.translation ? <p className="mi-brief-poster__translation">{text.translated} · {conclusion.translation}</p> : null}
        {synthesis ? <div className="mi-brief-poster__forward">
          <p className="mi-brief-poster__outlook"><span className="mi-brief-poster__forward-label">{text.conclusion.outlook}</span>{synthesis.outlook}</p>
          {synthesis.watch.length > 0 ? <div className="mi-brief-poster__watch">
            <span className="mi-brief-poster__forward-label">{text.conclusion.watch}</span>
            <ul>{synthesis.watch.map((entry) => <li key={entry}>{entry}</li>)}</ul>
          </div> : null}
          <p className="mi-brief-poster__overturn"><span className="mi-brief-poster__forward-label">{text.conclusion.whatWouldChange}</span>{synthesis.whatWouldChange}</p>
        </div> : null}
        {conclusion.invalidations[0] ? <p className="mi-brief-poster__invalidate">{text.conclusion.invalidation}{text.labelSeparator}{conclusion.invalidations[0].text}</p> : null}
    </section> : null}

    {hasBasis && conclusion ? <section className="mi-brief-poster__basis">
      <h2>{text.sections.basis}</h2>
      {standing ? <p className="mi-brief-poster__standing" data-standing={standing.kind}><b>{standing.label}</b>{text.labelSeparator}{standing.text}</p> : null}
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
        <h3>{nextTitle(focusEvent, eventTitles, locale)}</h3>
        <p className="mi-brief-poster__next-meta">{nextMeta(focusEvent, text)}</p>
        {focusEvent.why ? <p className="mi-brief-poster__next-why"><b>{text.next.why}</b> {focusEvent.why}</p> : null}
        {watchScenarios.length > 0 || watchBaseline ? <div className="mi-brief-poster__next-watch-block">
          {watchScenarios.length > 0 ? <div className="mi-brief-poster__next-watch-grid" data-watch-count={watchScenarios.length}>
            {watchScenarios.map((entry) => <div className="mi-brief-poster__next-watch" data-watch-kind={entry.kind} key={entry.key}>
              <span>{entry.label}</span><b>{entry.implication}</b>
            </div>)}
          </div> : null}
          {watchBaseline ? <p className="mi-brief-poster__next-watch-baseline" data-watch-baseline="true">
            {text.next.watchInline}{text.labelSeparator}{watchBaseline.implication}
          </p> : null}
        </div> : null}
        <small className="mi-brief-poster__next-soon">{text.next.soon.replace('{days}', String(daysUntil(focusEvent.at, doc.edition.windowEnd)))}</small>
      </div> : null}
      {otherEvents.length > 0 ? <div className="mi-brief-poster__next-rows">
        {otherEvents.map((item) => <div className="mi-brief-poster__next-row" key={item.eventKey}>
          <time>{nextTime(item.at, formatTime)}</time>
          <div>
            <b>{nextCountry(item, text) ? `${nextCountry(item, text)} · ` : ''}{nextTitle(item, eventTitles, locale)}</b>
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
  // The qualifier names the baseline: a session close is never described as a day move.
  const change = row.change
    ? `${text.changeWindows[row.change.window] ?? row.change.window} ${formatRowChange(row.change, text, locale)}`.trim()
    : ''
  if (row.id === 'etf-btc' || row.id === 'etf-eth') {
    const flow = (row.value?.number ?? 0) >= 0 ? text.flow.in : text.flow.out
    return `${flow}${row.observedAt ? ` · ${row.observedAt.slice(0, 10)}` : ''}`
  }
  return change || (row.observedAt ? formatTime(row.observedAt, 'minute') : '')
}

function nextTitle(item: DailyBriefingDocument['next']['items'][number], eventTitles: Record<string, string> | undefined, locale: 'zh-CN' | 'en-US'): string {
  const raw = eventTitles && item.titleKey ? eventTitles[item.titleKey] ?? item.title : item.title
  return shortenEventTitle(raw, locale)
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

function macroCountry(item: DailyBriefingDocument['news']['macro'][number], text: DailyBriefingText): string {
  const code = item.countryCode ?? ''
  return (text.countries as Record<string, string>)[code] ?? item.countryName ?? ''
}

function nextCountry(item: DailyBriefingDocument['next']['items'][number], text: DailyBriefingText): string {
  const code = item.countryCode
  const label = code ? text.countries[code as keyof DailyBriefingText['countries']] : undefined
  if (label) return label
  if (item.countryName && item.countryName !== code) return item.countryName
  return code ?? ''
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

function groupCitations(citations: readonly Citation[], text: DailyBriefingText): readonly Readonly<{ key: string; indexes: readonly number[]; statement?: string; source: string; observedAt?: string }>[] {
  const groups = new Map<string, { indexes: number[]; statement?: string; source: string; observedAt?: string }>()
  for (const entry of citations) {
    const statement = entry.statement ? entry.statement.length > 80 ? `${entry.statement.slice(0, 80)}…` : entry.statement : undefined
    const source = citationSource(entry, text)
    const key = `${statement ?? ''}|${source}|${entry.observedAt ?? ''}`
    const group = groups.get(key) ?? { indexes: [], ...(statement ? { statement } : {}), source, ...(entry.observedAt ? { observedAt: entry.observedAt } : {}) }
    group.indexes.push(entry.index)
    groups.set(key, group)
  }
  return [...groups.entries()].map(([key, value]) => Object.freeze({ key, indexes: Object.freeze([...value.indexes]), ...(value.statement ? { statement: value.statement } : {}), source: value.source, ...(value.observedAt ? { observedAt: value.observedAt } : {}) }))
}

function citationSource(entry: Readonly<{ refId: string; sourceLabel?: string }>, text: DailyBriefingText): string {
  if (entry.sourceLabel) return SOURCE_LABELS[entry.sourceLabel] ?? entry.sourceLabel
  if (entry.refId.startsWith('query:defillama-stablecoins')) return 'DefiLlama Stablecoins'
  if (entry.refId.startsWith('query:0xrouter')) return '0xRouter'
  if (entry.refId.startsWith('macro-calendar')) return text.citationSources.macroCalendar
  if (entry.refId.startsWith('news')) return text.citationSources.news
  return text.citationSources.analysis
}

function citationTime(entry: Readonly<{ refId: string; observedAt?: string }>, formatTime: (value: string, precision?: 'minute' | 'second') => string): string {
  if (entry.observedAt) return formatTime(entry.observedAt, 'minute')
  const match = entry.refId.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/)
  return match ? formatTime(match[0], 'minute') : ''
}

function rowLabel(text: DailyBriefingText, labelKey: string): string {
  return text.rows[labelKey.split('.').pop() as keyof DailyBriefingText['rows']] ?? labelKey
}

type StaleBasis = NonNullable<BriefingMarketRow['valueBasis']>

/**
 * The label a fallback reading wears on the page: which source it came from and over what window.
 *
 * Only the page shows it — the exported image omits these rows entirely — so this exists to tell the
 * reader judging the day where the number came from, never to travel with the image.
 */
function fallbackLabel(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText): React.ReactNode {
  if (row.state !== 'stale') return null
  const basis: StaleBasis | undefined = 'valueBasis' in row ? row.valueBasis : undefined
  // Only say something when the number is not the thing its name promises. A 24-hour move computed
  // from a curve or from the daily series is still a 24-hour move, and the timestamp under the row
  // already says which instant it is — repeating "about 24 hours ago (from the curve)" tells the
  // reader how we computed it, which is ours to know, not theirs to read.
  const spoken: Partial<Record<StaleBasis, string>> = {
    'last-close': text.staleBasis.lastClose,
    'series-level': text.staleBasis.seriesLevel,
    published: text.staleBasis.published
  }
  const label = basis === undefined ? undefined : spoken[basis]
  if (!label) return null
  return <em className="mi-brief-poster__stale" data-basis={basis}>{label}</em>
}

function stateLabel(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText): string {
  if (row.state === 'source-disabled') return text.states['source-disabled']
  if (row.state === 'unavailable') return text.states.unavailable
  return row.observedAt ? text.states[row.state] : ''
}

type WatchKind = 'lower' | 'inline' | 'higher' | 'other'
type WatchEntry = Readonly<{ key: string; kind: WatchKind; label: string; implication: string }>

function nextMeta(item: DailyBriefingDocument['next']['items'][number], text: DailyBriefingText): string {
  const country = nextCountry(item, text)
  return [
    text.next.importance[item.importance],
    country,
    item.consensus ? `${text.next.expected} ${item.consensus}` : '',
    item.previous ? `${text.next.previous} ${item.previous}` : ''
  ].filter(Boolean).join(' · ')
}

/**
 * The model writes the watch conditions as free text, and its third one (`inline with consensus`)
 * used to leak into the Chinese poster because only the two English phrases were mapped. Map the
 * conditions so the two surprises lead the row in low → high order; `inline` is the baseline, and
 * an unrecognized phrase is dropped rather than printed raw.
 */
function orderWatch(
  watch: readonly Readonly<{ condition: string; implication: string }>[],
  text: DailyBriefingText
): readonly WatchEntry[] {
  const rank: Readonly<Record<WatchKind, number>> = { lower: 0, higher: 1, inline: 2, other: 3 }
  return watch
    .map((entry, index) => ({ key: `${index}:${entry.condition}`, implication: entry.implication, ...watchLabel(entry.condition, text) }))
    .sort((left, right) => rank[left.kind] - rank[right.kind])
}

function watchLabel(condition: string, text: DailyBriefingText): Readonly<{ kind: WatchKind; label: string }> {
  // Chinese conditions are matched on the raw string: word boundaries do not apply to CJK text.
  if (/高于|超出|上行|超预期/.test(condition)) return { kind: 'higher', label: text.next.watchHigher }
  if (/低于|不及|下行|弱于/.test(condition)) return { kind: 'lower', label: text.next.watchLower }
  if (/符合|持平|一致|如期/.test(condition)) return { kind: 'inline', label: text.next.watchInline }
  const normalized = condition.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (/\b(higher|above|beat|beats|exceed|exceeds|greater|upside)\b/.test(normalized)) return { kind: 'higher', label: text.next.watchHigher }
  if (/\b(lower|below|miss|misses|less|downside)\b/.test(normalized)) return { kind: 'lower', label: text.next.watchLower }
  if (/\b(inline|consensus|expected|expectations|meets?|neutral|flat)\b/.test(normalized)) return { kind: 'inline', label: text.next.watchInline }
  return { kind: 'other', label: /[a-z]/i.test(condition) ? text.next.watchOther : condition.trim() }
}

function macroTime(value: string, formatTime: (value: string, precision: 'minute') => string): React.ReactNode {
  const [date, ...rest] = formatTime(value, 'minute').split(' ')
  return <>{date}<br />{rest.join(' ')}</>
}

function clockWithZone(value: string, formatTime: (value: string, precision: 'minute') => string): string {
  const [date, time, ...zone] = formatTime(value, 'minute').split(' ')
  return `${date}\n${[time, ...zone].filter(Boolean).join(' ')}`
}

function policyOutcomeLabel(outcome: string, text: DailyBriefingText): string {
  return text.policyOutcomes[outcome as keyof DailyBriefingText['policyOutcomes']] ?? outcome
}

/**
 * The call-changing marker. The model writes the no-change sentinel when nothing moved, and a chip
 * that always says "view changed" is worse than no chip, so the sentinel renders nothing.
 */
function regimeChangeMarker(value: string): Readonly<{ title: string }> | undefined {
  const text = value.trim()
  if (text.length === 0) return undefined
  if (/^(?:无重要变化|无变化|没有变化|no\s+(?:material\s+|important\s+)?change)/i.test(text)) return undefined
  return { title: text }
}

/**
 * One line for what the earlier read deserved: held, overturned, or partly both.
 *
 * The two lists are rendered together because splitting them into two paragraphs repeats the same
 * point twice; a reader only needs to know whether the basis still stands.
 */
function basisStanding(
  synthesis: BriefingConclusionSynthesis,
  text: DailyBriefingText
): Readonly<{ kind: 'held' | 'overturned' | 'partly'; label: string; text: string }> | undefined {
  const held = synthesis.confirmed.filter((entry) => entry.trim().length > 0)
  const refuted = synthesis.refuted.filter((entry) => entry.trim().length > 0)
  if (held.length === 0 && refuted.length === 0) return undefined
  if (refuted.length === 0) return { kind: 'held', label: text.conclusion.basisHeld, text: held.join(' · ') }
  if (held.length === 0) return { kind: 'overturned', label: text.conclusion.basisOverturned, text: refuted.join(' · ') }
  return { kind: 'partly', label: text.conclusion.basisPartlyHeld, text: `${held.join(' · ')} · ${refuted.join(' · ')}` }
}
