import { formatBriefingValue } from '../../../contracts/dailyBriefingFormat'
import { changeLedRowCopy } from '../../../contracts/dailyBriefingMarkdown'
import type { BriefingDataGroups } from '../../../contracts/dailyBriefingDataGroups'
import type { BriefingMarketRow, BriefingPulseRow } from '../../../contracts/dailyBriefing'
import type { PolicyPathOutcome } from '../../../contracts/policyPath'
import type { DailyBriefingText } from './dailyBriefingText'
import { changeArrowFor, paymentDirectionFor, type changeArrowWords, type paymentDirectionWords, type policyGaugeWords } from './dailyBriefingPaymentDirections'
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
export function BriefingDataArea({ groups, text, locale, formatTime, paymentDirectionsCompact, policyWords, changeArrows }: Readonly<{
  groups: BriefingDataGroups
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  paymentDirectionsCompact: paymentDirectionWords
  policyWords: policyGaugeWords
  /** The ↑/↓ glyphs, owned by the positioning copy; the card prints no arrow of its own. */
  changeArrows: changeArrowWords
}>): React.ReactElement {
  const policy = groups.policyPath
  const readings = groups.readings
  const leverage = groups.leverage
  return <div className="mi-brief-poster__data" data-briefing-data-region="true">
    {policy && policy.visibility !== 'hidden' ? <PolicyCard policy={policy} text={text} formatTime={formatTime} words={policyWords} /> : null}
    <div className="mi-brief-poster__price-row" data-briefing-price-row="true">
      {groups.price.map((row) => <PriceCard key={row.id} row={row} text={text} locale={locale} formatTime={formatTime} />)}
    </div>
    {readings.length > 0 ? <div className="mi-brief-poster__readings-line" data-briefing-readings-line="true">
      {readings.map((row) => {
        const copy = changeLedRowCopy(row, text, locale)
        // Only a market row can carry an amplitude; a pulse row never has one.
        const amplitude = 'amplitude' in row ? row.amplitude : undefined
        return <span className="mi-brief-poster__reading" key={row.id} data-reading={READING_IDS[row.id] ?? row.id} data-tone={toneFor(row)} data-lead={copy ? 'change' : 'value'} {...(amplitude ? { 'data-briefing-amplitude': READING_IDS[row.id] ?? row.id } : {})}>
          <span className="mi-brief-poster__reading-label">{rowLabel(text, row.labelKey)}{fallbackLabel(row, text)}</span>
          <b>{copy ? copy.primary : formatBriefingValue(row.value, text.noValue, locale)}</b>
          <small>{copy ? copy.secondary : keyMeta(row, text, locale, formatTime)}</small>
          {amplitude ? <small className="mi-brief-poster__amplitude">{amplitudeCopy(amplitude, text)}</small> : null}
        </span>
      })}
    </div> : null}
    {groups.funds.length > 0 ? <div className="mi-brief-poster__etf" data-briefing-etf-line="true">
      {groups.funds.map((row) => <span key={row.id}>
        <span>{text.rows[row.labelKey.replace('dailyBriefing.row.', '') as keyof typeof text.rows] ?? row.labelKey}</span>
        <b>{formatBriefingValue(row.value, text.noValue, locale)}</b>
      </span>)}
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
            <span>{asset.toUpperCase()}</span>
            <b className="mi-brief-poster__leverage-change" data-briefing-oi-change={asset}>{changeCopy(change, changeArrows, text.noValue)}</b>
            <small>1h {entry.change1hPct !== undefined ? `${entry.change1hPct.toFixed(1)}%` : text.noValue} · {rate === undefined ? text.noValue : `${rate > 0 ? '+' : ''}${rate.toFixed(4)}%`} {paymentDirectionFor(rate, paymentDirectionsCompact)} · OI {entry.openInterestUsd !== undefined ? `$${(entry.openInterestUsd / 1e9).toFixed(2)}B` : text.noValue}</small>
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

const READING_IDS: Readonly<Record<string, string>> = Object.freeze({
  index: 'nasdaq', dxy: 'dxy', gold: 'gold', us10y: 'ust10y', stablecoin: 'stablecoin', 'fear-greed': 'fear-greed'
})

function PolicyCard({ policy, text, formatTime, words }: Readonly<{
  policy: NonNullable<BriefingDataGroups['policyPath']>
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  words: policyGaugeWords
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
  // Two columns, placed explicitly: the dial on the left, the reading on the right. Automatic placement
  // put the title into the dial's cell and the copy underneath it — attributes all correct, the printed
  // card wrong, which is exactly what a DOM without layout cannot catch.
  return <div className="mi-brief-poster__card mi-brief-poster__policy-card" data-briefing-policy-card="true">
    <span className="mi-brief-poster__policy-dial" data-briefing-policy-dial="true">
      <svg className="mi-brief-poster__policy-gauge" data-briefing-policy-gauge="true" viewBox={`0 0 ${POLICY_GAUGE.width} ${POLICY_GAUGE.height}`} role="img" aria-label={`${probability}%`}>
        <path className="mi-brief-poster__gauge-track" d={policyGaugeTrack()} fill="none" vectorEffect="non-scaling-stroke" />
        {arcs.map((arc) => <path key={arc.outcome} className={GAUGE_CLASS[arc.outcome]} d={arc.path} fill="none" vectorEffect="non-scaling-stroke" data-outcome={arc.outcome} />)}
      </svg>
      {/* HTML, not svg text: the number stays selectable and the svg keeps zero text nodes. */}
      <b className="mi-brief-poster__policy-probability">{probability}% · {policyOutcomeLabel(policy.outcome, text)}</b>
    </span>
    <div className="mi-brief-poster__policy-copy" data-briefing-policy-copy="true">
      <span className="mi-brief-poster__policy-title">{text.sections.policyPath}</span>
      <span className="mi-brief-poster__policy-change">{text.sections.policyRange}</span>
      <small>{policy.targetLower !== undefined ? `${policy.targetLower}–${policy.targetUpper}%` : text.sections.rangeUnavailable}</small>
      {legend.length > 0 ? <span className="mi-brief-poster__policy-outcomes" data-briefing-policy-outcomes="true">
        {legend.map((segment) => <span key={segment.outcome} data-outcome={segment.outcome}>{shareCopy(segment, words)}{INDEX_SEPARATOR}</span>)}
      </span> : null}
      <small className="mi-brief-poster__policy-meeting">{policy.meetingDate}</small>
      <small className="mi-brief-poster__policy-observed">{formatTime(policy.observedAt, 'minute')}</small>
    </div>
  </div>
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
      {/* The number and its amplitude share one baseline row: they are one reading, not two lines. */}
      <span className="mi-brief-poster__price-figures">
        <b className="mi-brief-poster__price-value">{copy ? copy.primary : formatBriefingValue(row.value, text.noValue, locale)}</b>
        {copy ? <small>{copy.secondary}</small> : null}
        {/* Small, and never toned: amplitude is how much it moved, not which way. */}
        {row.amplitude ? <small className="mi-brief-poster__amplitude" data-briefing-amplitude={row.id}>{amplitudeCopy(row.amplitude, text)}</small> : null}
      </span>
      <small className="mi-brief-poster__price-observed">{formatTime(row.observedAt ?? '', 'minute')}</small>
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

/** The last plotted point, for the "now" dot: one dot, at the end of the line, never a marker per point. */
function sparkEnd(points: string): Readonly<{ x: number; y: number }> | undefined {
  const last = points.split(' ').at(-1)
  if (!last) return undefined
  const [x, y] = last.split(',').map(Number)
  return x !== undefined && y !== undefined && Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined
}
