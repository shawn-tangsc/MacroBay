import { formatBriefingValue } from '../../../contracts/dailyBriefingFormat'
import { changeLedRowCopy, formatRowChange } from '../../../contracts/dailyBriefingMarkdown'
import { formatBriefingChange } from '../../../contracts/dailyBriefingFormat'
import type { BriefingDataGroups } from '../../../contracts/dailyBriefingDataGroups'
import type { BriefingMarketRow, BriefingPulseRow } from '../../../contracts/dailyBriefing'
import type { PolicyPathOutcome } from '../../../contracts/policyPath'
import type { DailyBriefingText } from './dailyBriefingText'
import { resolveFearGreedSnapshotBucket } from '../../../contracts/intelligenceQueryContracts'
import { changeArrowFor, paymentDirectionFor, type changeArrowWords, type fearGreedBucketWords, type paymentDirectionWords, type policyGaugeWords } from './dailyBriefingPaymentDirections'
import { fallbackLabel, keyMeta, policyOutcomeLabel, rowLabel, toneFor } from './briefingPosterRowCopy'
import { OI_SPARK, POLICY_GAUGE, PRICE_AREA, oiSparkPoints, policyGaugeArcs, policyGaugeLegend, policyGaugeSegments, policyGaugeTrack, priceCurvePaths } from './briefingDataGeometry'

/**
 * The data region, drawn once for the exported card.
 *
 * It takes the partition, not the document: the blocks and the rows they hold are decided before this
 * component runs, so it cannot invent a second opinion about where a reading belongs. The gauge's
 * arithmetic and the price geometry live in pure functions next door, because the assertions count
 * vertices and compare two renders — numbers, not pixels.
 */
export function BriefingDataArea({ groups, text, locale, formatTime, paymentDirectionsCompact, policyWords, changeArrows, fearGreedBuckets }: Readonly<{
  groups: BriefingDataGroups
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  paymentDirectionsCompact: paymentDirectionWords
  policyWords: policyGaugeWords
  /** The ↑/↓ glyphs, owned by the positioning copy; the card prints no arrow of its own. */
  changeArrows: changeArrowWords
  /** The fear-and-greed band words: the band itself is derived from the score, never stored. */
  fearGreedBuckets: fearGreedBucketWords
}>): React.ReactElement {
  const policy = groups.policyPath
  const readings = groups.readings
  const leverage = groups.leverage
  return <div className="mi-brief-poster__data" data-briefing-data-region="true">
    {/* One row, three cards: BTC, ETH, then the rate card — the order the approved sheet has. */}
    <div className="mi-brief-poster__card-row" data-briefing-card-row="true">
      {groups.price.map((row) => <PriceCard key={row.id} row={row} text={text} locale={locale} formatTime={formatTime} />)}
      {policy && policy.visibility !== 'hidden' ? <PolicyCard policy={policy} text={text} locale={locale} formatTime={formatTime} words={policyWords} windowEnd={groups.windowEnd} editionDate={groups.editionDate} /> : null}
    </div>
    {groups.funds.length > 0 ? <div className="mi-brief-poster__funds-block" data-briefing-funds-row="true">
      <span className="mi-brief-poster__block-title">{text.groups.funds}</span>
      {/* Three fixed columns: a missing row leaves its cell empty instead of stretching the other two,
          so a value stays under the same heading on every edition. */}
      <div className="mi-brief-poster__figure-line">{groups.funds.map((row) => <Figure key={row.id} row={row} text={text} locale={locale} buckets={fearGreedBuckets} arrows={changeArrows} />)}</div>
    </div> : null}
    {readings.length > 0 ? <div className="mi-brief-poster__market-block" data-briefing-market-row="true">
      <span className="mi-brief-poster__block-title">{text.sections.markets}</span>
      {/* Three columns by two lines; five cells leave the sixth empty rather than reflowing. */}
      <div className="mi-brief-poster__figure-line">{readings.slice(0, 3).map((row) => <Figure key={row.id} row={row} text={text} locale={locale} buckets={fearGreedBuckets} arrows={changeArrows} />)}</div>
      {/* The table has six cells; today's five leave the sixth blank rather than stretching the row. The
          blank is a node, not an absence: "six cells, five readings" has to be countable. */}
      {readings.length > 3 ? <div className="mi-brief-poster__figure-line">
        {readings.slice(3).map((row) => <Figure key={row.id} row={row} text={text} locale={locale} buckets={fearGreedBuckets} arrows={changeArrows} />)}
        {Array.from({ length: Math.max(0, 3 - (readings.length - 3)) }, (_, index) => <div key={`empty-${index}`} data-reading-empty="true" aria-hidden="true" />)}
      </div> : null}
    </div> : null}
    {leverage && leverage.visibility !== 'hidden' ? <div className="mi-brief-poster__leverage" data-briefing-leverage-block="true">
      <span className="mi-brief-poster__leverage-title">{text.sections.leverage}</span>
      {(['btc', 'eth'] as const).map((asset) => {
        const entry = leverage[asset]
        const rate = entry.fundingRate
        const change = entry.change24hPct
        const spark = entry.series ? oiSparkPoints(entry.series.map((point) => point.value)) : ''
        // The 24-hour change is the card's point: the amount is a level, and a level does not say
        // whether positioning is being added or taken off. The tone rides on this number, never on the
        // funding rate beside it, or the colour and the arrow would belong to different facts.
        return <div className="mi-brief-poster__card mi-brief-poster__leverage-card" key={asset} data-briefing-leverage-card={asset} data-tone={change === undefined || change === 0 ? undefined : change > 0 ? 'up' : 'down'}>
          <span className="mi-brief-poster__leverage-copy" data-briefing-leverage-copy="true">
            <span>{text.positioningChange.replace('{asset}', asset.toUpperCase())}</span>
            {/* The level is the trunk and the change sits beside it: a percentage without its base says
                nothing about how much is open, and the change keeps the colour and the arrow. */}
            <span className="mi-brief-poster__leverage-figures">
              <b className="mi-brief-poster__leverage-amount">{entry.openInterestUsd !== undefined ? `$${(entry.openInterestUsd / 1e9).toFixed(2)}B` : text.noValue}</b>
              <b className="mi-brief-poster__leverage-change" data-briefing-oi-change={asset}>{changeCopy(change, changeArrows, text.noValue)}</b>
            </span>
            <small>1h {entry.change1hPct !== undefined ? `${changeArrowFor(entry.change1hPct, changeArrows)}${Math.abs(entry.change1hPct).toFixed(1)}%` : text.noValue} · {text.positioningFee} {rate === undefined ? text.noValue : `${rate > 0 ? '+' : ''}${rate.toFixed(4)}%`} {paymentDirectionFor(rate, paymentDirectionsCompact)}</small>
          </span>
          {/* Only when the edition carries a series: no series means no element at all, never a flat
              placeholder line, because a flat line claims nothing moved. */}
          {spark ? <svg className="mi-brief-poster__leverage-spark" data-briefing-oi-spark={asset} viewBox={`0 0 ${OI_SPARK.width} ${OI_SPARK.height}`} role="img" aria-label={`${asset.toUpperCase()} ${text.sections.leverage}`}>
            <polyline points={spark} fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" />
            {sparkEnd(spark) ? <circle cx={sparkEnd(spark)!.x} cy={sparkEnd(spark)!.y} r="1.5" fill="currentColor" /> : null}
          </svg> : null}
        </div>
      })}
    </div> : null}
  </div>
}

/**
 * One cell, in two parts: the level it reports and the change beside it.
 *
 * A change is a number, not a sentence: `↑0.08%` with its arrow and colour is a figure, while "24h" and
 * "+0.08%" at one weight read as prose. The window word appears only when it is *not* the block's own —
 * the block already says 过去 24 小时数据 — and the tone rides on the change alone, because a tinted level
 * reads as a move.
 */
type CellChange = Readonly<{ text: string; window?: string; tone?: 'up' | 'down'; arrow?: string }>
type CellCopy = Readonly<{ primary: string; change?: CellChange; note?: string }>

function cellCopy(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText, locale: 'zh-CN' | 'en-US', buckets: fearGreedBucketWords, arrows: changeArrowWords): CellCopy {
  const level = formatBriefingValue(row.value, text.noValue, locale)
  // The arrow carries the direction, so the number beside it must not repeat it: "↓+1.7B" is one fact
  // stated twice, and the plus is what a reader trips over.
  const magnitude = (value: string): string => value.replace(/^[+\-]/, '')
  const windowWord = (window: string): string =>
    window === '24h' || window === '1d' ? '' : (text.changeWindows[window as keyof typeof text.changeWindows] ?? window)
  const changeOf = (value: number, window: string, printed: string): CellChange => {
    const word = windowWord(window)
    const tone = value === 0 ? undefined : value > 0 ? 'up' as const : 'down' as const
    return { text: magnitude(printed), ...(word ? { window: word } : {}), ...(tone ? { tone, arrow: changeArrowFor(value, arrows) } : {}) }
  }
  if (row.id === 'stablecoin') {
    const day = (row.auxiliaryChanges ?? []).find((change) => change.window === '1d' && change.unit === 'usd')
    if (!day || day.unit !== 'usd') return { primary: level }
    return { primary: level, change: changeOf(day.value, '1d', formatBriefingChange({ value: day.value, unit: 'usd' }, locale)) }
  }
  if (row.id === 'fear-greed') {
    // The band is derived from the score by the collector's own table: the document holds the number,
    // and a stored band would be the same fact twice — disagreeing at 24/25 the moment one moves.
    const band = row.value ? resolveFearGreedSnapshotBucket(row.value.number) : undefined
    const scored = band ? `${level}（${buckets[band]}）` : level
    if (!row.change) return { primary: scored, ...(row.changeReason ? { note: text.changeReasons[row.changeReason] ?? '' } : {}) }
    return { primary: scored, change: changeOf(row.change.value, row.change.window, formatRowChange(row.change, text, locale)) }
  }
  return row.change
    ? { primary: level, change: changeOf(row.change.value, row.change.window, formatBriefingChange({ value: row.change.value, unit: row.change.unit === 'points' ? 'percent' : row.change.unit }, locale)) }
    : { primary: level, ...(keyMeta(row, text, locale) ? { note: keyMeta(row, text, locale) } : {}) }
}


function Figure({ row, text, locale, buckets, arrows }: Readonly<{
  row: BriefingMarketRow | BriefingPulseRow
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  buckets: fearGreedBucketWords
  arrows: changeArrowWords
}>): React.ReactElement {
  const amplitude = 'amplitude' in row ? row.amplitude : undefined
  const cell = cellCopy(row, text, locale, buckets, arrows)
  return <span className="mi-brief-poster__figure" data-reading={READING_IDS[row.id] ?? row.id} data-lead={cell.change ? 'change' : 'value'} {...(amplitude ? { 'data-briefing-amplitude': READING_IDS[row.id] ?? row.id } : {})}>
    <span className="mi-brief-poster__figure-label">{rowLabel(text, row.labelKey)}{fallbackLabel(row, text)}</span>
    {/* The level is never tinted: only a move is. */}
    <b>{cell.primary}</b>
    {cell.change ? <small className="mi-brief-poster__figure-change">
      {cell.change.window ? <span className="mi-brief-poster__figure-window">{cell.change.window}</span> : null}
      <b data-tone={cell.change.tone}>{`${cell.change.arrow ?? ''}${cell.change.text}`}</b>
    </small> : null}
    {cell.note ? <small>{cell.note}</small> : null}
    {amplitude ? <small className="mi-brief-poster__amplitude">{amplitudeCopy(amplitude, text)}</small> : null}
  </span>
}

const READING_IDS: Readonly<Record<string, string>> = Object.freeze({
  index: 'nasdaq', dxy: 'dxy', gold: 'gold', us10y: 'ust10y', stablecoin: 'stablecoin', 'fear-greed': 'fear-greed'
})

function PolicyCard({ policy, text, locale, formatTime, words, windowEnd, editionDate }: Readonly<{
  policy: NonNullable<BriefingDataGroups['policyPath']>
  locale: 'zh-CN' | 'en-US'
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  words: policyGaugeWords
  windowEnd: string
  editionDate: string
}>): React.ReactElement {
  // One source for the number and the arcs: with a distribution both read the same bucket, so the card
  // cannot print 77.5% and draw 77.2°. Without one there is nothing to reconcile and the dial is two
  // segments — the event and "not the event" — which is what `residual` names.
  const released = policy.distribution ? Math.round((policy.distribution[policy.outcome as PolicyPathOutcome] ?? 0) * 1000) / 10 : undefined
  const probability = released ?? Math.round(policy.probability * 10) / 10
  const dial = { probability, outcome: policy.outcome, distribution: policy.distribution }
  const arcs = policyGaugeArcs(policyGaugeSegments(dial))
  // The event is already the number in the middle of the dial; the legend only carries the other two,
  // and a zero one is printed anyway — "维持 0.0%" is a fact, a missing line would be an omission.
  const legend = policyGaugeLegend(dial)
  const days = countdownDays(editionDate, policy.meetingDate)
  return <div className="mi-brief-poster__card mi-brief-poster__policy-card" data-briefing-policy-card="true">
    {/* The heading spans the card: the dial below it is the left column, the reading the right. */}
    <span className="mi-brief-poster__policy-title">{text.sections.policyProbability}</span>
    <span className="mi-brief-poster__policy-row">
    <span className="mi-brief-poster__policy-dial" data-briefing-policy-dial="true">
      <svg className="mi-brief-poster__policy-gauge" data-briefing-policy-gauge="true" viewBox={`0 0 ${POLICY_GAUGE.width} ${POLICY_GAUGE.height}`} role="img" aria-label={`${probability}%`}>
        <path className="mi-brief-poster__gauge-track" d={policyGaugeTrack()} fill="none" vectorEffect="non-scaling-stroke" />
        {arcs.map((arc) => <path key={arc.outcome} className={GAUGE_CLASS[arc.outcome]} d={arc.path} fill="none" vectorEffect="non-scaling-stroke" data-outcome={arc.outcome} />)}
      </svg>
      {/* The ring is the number's only home: "3.4% · 加息 25bp" is wider than the dial and wrapped across
          the copy, which is how it came to be printed as two broken lines. */}
      <b className="mi-brief-poster__policy-probability" data-briefing-policy-probability="true">{probability}%</b>
    </span>
    <div className="mi-brief-poster__policy-copy" data-briefing-policy-copy="true">
      {/* Which meeting, then how much it moved and how far away that meeting is — the sheet's order. */}
      <span className="mi-brief-poster__policy-outcome" data-briefing-policy-outcome="true">{outcomeLead(policy.meetingDate, policy.outcome, text, locale)}</span>
      <small className="mi-brief-poster__policy-change">
        {policy.probabilityChangePp !== undefined ? <><b>{`${policy.probabilityChangePp > 0 ? '+' : ''}${policy.probabilityChangePp}pp`}</b>{INDEX_SEPARATOR}</> : null}
        {`${policy.meetingDate.slice(5)}${days === undefined ? '' : `${INDEX_SEPARATOR}${text.policyDaysAway.replace('{days}', String(days))}`}`}
      </small>
    </div>
    </span>
    {/* One line, as the sheet has it: the shares, then the target range, joined and never trailing. */}
    <span className="mi-brief-poster__policy-bottom">
      {legend.length > 0 ? <span className="mi-brief-poster__policy-outcomes" data-briefing-policy-outcomes="true">
        {legend.map((segment) => <span key={segment.outcome} data-outcome={segment.outcome}>{shareCopy(segment, words)}</span>).reduce<React.ReactNode[]>((joined, node, index) => (index === 0 ? [node] : [...joined, INDEX_SEPARATOR, node]), [])}
      </span> : null}
      {legend.length > 0 ? INDEX_SEPARATOR : null}
      <span className="mi-brief-poster__policy-range">{text.sections.policyRange}{' '}
        {policy.targetLower !== undefined && policy.targetUpper !== undefined
          ? `${policy.targetLower.toFixed(2)}–${policy.targetUpper.toFixed(2)}%`
          : text.sections.rangeUnavailable}</span>
    </span>
  </div>
}

/** `12 月加息 25bp` in Chinese, `Hike 25bp in Dec` in English: the month is the meeting's own. */
function outcomeLead(meetingDate: string, outcome: string, text: DailyBriefingText, locale: 'zh-CN' | 'en-US'): string {
  const month = monthName(meetingDate, locale)
  return text.policyOutcomeLead.replace('{month}', month).replace('{outcome}', policyOutcomeLabel(outcome, text))
}

/** The reader's own month label for the meeting date; an unreadable date falls back to the lead word. */
function monthName(meetingDate: string, locale: 'zh-CN' | 'en-US'): string {
  const at = Date.parse(`${meetingDate}T12:00:00.000Z`)
  if (!Number.isFinite(at)) return ''
  return new Intl.DateTimeFormat(locale, { month: locale === 'zh-CN' ? 'numeric' : 'short', timeZone: 'UTC' }).format(at)
}

/** Whole days from the issue day to the meeting; the meeting day itself is zero, never "in 0 days". */
function countdownDays(editionDate: string, meetingDate: string): number | undefined {
  const from = Date.parse(`${editionDate}T00:00:00.000Z`)
  const to = Date.parse(`${meetingDate}T00:00:00.000Z`)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return undefined
  const days = Math.round((to - from) / 86_400_000)
  return days >= 0 ? days : undefined
}

const GAUGE_CLASS: Readonly<Record<string, string>> = Object.freeze({
  event: 'mi-brief-poster__gauge-event',
  hold: 'mi-brief-poster__gauge-rest',
  other: 'mi-brief-poster__gauge-other',
  residual: 'mi-brief-poster__gauge-rest'
})

/** The dial's own separator: the copy is a word plus a number, so the join is punctuation, not prose. */
const INDEX_SEPARATOR = ' · '

function shareCopy(segment: Readonly<{ outcome: string; share: number }>, words: policyGaugeWords): string {
  const share = `${Math.round(segment.share * 10) / 10}%`
  // `rest` is a template in the copy that owns it ("其余 {value}"); the hold word is a bare word.
  return segment.outcome === 'other' ? words.rest.replace('{value}', share) : `${words.hold} ${share}`
}

function PriceCard({ row, text, locale, formatTime }: Readonly<{
  row: BriefingMarketRow
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  const copy = changeLedRowCopy(row, text, locale)
  // The stored curve, drawn as stored: the segments are already rebased and thinned, so the renderer
  // neither resamples nor re-anchors. No curve is an empty column with its zero line and nothing else.
  const paths = priceCurvePaths(row.curve ?? [])
  // The text column and the plot column, placed explicitly: with automatic placement the number landed
  // in the 100px plot column, on top of the chart, and the implicit second row pushed the card past its
  // 114px. Same attributes, wrong paper.
  return <div className="mi-brief-poster__card mi-brief-poster__price-card" data-tone={toneOf(row)} data-briefing-price-card={row.id}>
    <div className="mi-brief-poster__price-lead" data-briefing-price-lead="true">
      <span className="mi-brief-poster__price-label">{rowLabel(text, row.labelKey)}{fallbackLabel(row, text)}</span>
      <span className="mi-brief-poster__price-figures">
        <b className="mi-brief-poster__price-value">{copy ? copy.primary : formatBriefingValue(row.value, text.noValue, locale)}</b>
        {copy ? <small>{copy.secondary}</small> : null}
      </span>
      {/* The third line is the amplitude, where the instant used to sit: three lines keep the column
          balanced against the plot, and two left the middle of the card empty. Small, grey, never toned
          — amplitude says how far it travelled, not which way. */}
      {row.amplitude ? <small className="mi-brief-poster__amplitude" data-briefing-amplitude={row.id}>{amplitudeCopy(row.amplitude, text)}</small> : null}
    </div>
    <svg className="mi-brief-poster__price-area" data-briefing-price-area={row.id} viewBox={`0 0 ${PRICE_AREA.width} ${PRICE_AREA.height}`} preserveAspectRatio="none">
      <line x1="0" y1={PRICE_AREA.zeroY} x2={PRICE_AREA.width} y2={PRICE_AREA.zeroY} className="mi-brief-poster__price-zero" vectorEffect="non-scaling-stroke" />
      {paths.areas.map((area, index) => area ? <path key={`area-${index}`} d={area} className="mi-brief-poster__price-fill" fill="currentColor" opacity=".18" /> : null)}
      {paths.lines.map((line, index) => <polyline key={`line-${index}`} points={line} className="mi-brief-poster__price-line" fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" />)}
    </svg>
  </div>
}

function toneOf(row: BriefingMarketRow | BriefingPulseRow): 'up' | 'down' | undefined {
  const value = row.change?.value ?? row.value?.number
  if (value === undefined || value === 0) return undefined
  return value > 0 ? 'up' : 'down'
}

/** The window's travel, as the copy that owns the word spells it. */
function amplitudeCopy(amplitude: NonNullable<BriefingMarketRow['amplitude']>, text: DailyBriefingText): string {
  return text.amplitude.replace('{value}', `${Math.round(amplitude.percent * 10) / 10}%`)
}

/**
 * The card's main number: an arrow and a magnitude, or a signed zero.
 *
 * The arrow already says which way, so the number beside it carries no sign — "↑+3.5%" is the same fact
 * twice. A zero has no arrow and prints as "+0.0%", which is the one value a reader must not confuse
 * with a missing reading.
 */
function changeCopy(change: number | undefined, arrows: changeArrowWords, noValue: string): string {
  if (change === undefined) return noValue
  const arrow = changeArrowFor(change, arrows)
  const magnitude = `${Math.abs(change).toFixed(1)}%`
  if (arrow) return `${arrow}${magnitude}`
  return `${change < 0 ? '' : '+'}${magnitude}`
}

/**
 * Whether two instants fall in the same minute.
 *
 * Compared as instants, never as formatted text: a formatter that rounds or is stubbed would make every
 * pair look equal and silently hide a stamp that really does differ.
 */
function sameMinute(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false
  const a = Date.parse(left)
  const b = Date.parse(right)
  return Number.isFinite(a) && Number.isFinite(b) && Math.floor(a / 60_000) === Math.floor(b / 60_000)
}

/** The last plotted point, for the "now" dot: one dot, at the end of the line, never a marker per point. */
function sparkEnd(points: string): Readonly<{ x: number; y: number }> | undefined {
  const last = points.split(' ').at(-1)
  if (!last) return undefined
  const [x, y] = last.split(',').map(Number)
  return x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
}
