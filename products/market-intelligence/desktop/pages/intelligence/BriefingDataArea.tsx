import { formatBriefingValue } from '../../../contracts/dailyBriefingFormat'
import { changeLedRowCopy } from '../../../contracts/dailyBriefingMarkdown'
import type { BriefingDataGroups } from '../../../contracts/dailyBriefingDataGroups'
import type { BriefingMarketRow, BriefingPulseRow } from '../../../contracts/dailyBriefing'
import type { DailyBriefingText } from './dailyBriefingText'
import { paymentDirectionFor, type paymentDirectionWords } from './dailyBriefingPaymentDirections'
import { fallbackLabel, keyMeta, policyOutcomeLabel, rowLabel, toneFor } from './briefingPosterRowCopy'
import { POLICY_GAUGE, PRICE_AREA, policyGaugeArcs, policyGaugeTrack, priceAreaPath, priceLinePoints } from './briefingDataGeometry'

/**
 * The data region, drawn once for the exported card.
 *
 * It takes the partition, not the document: the blocks and the rows they hold are decided before this
 * component runs, so it cannot invent a second opinion about where a reading belongs. The gauge's
 * arithmetic and the price geometry live in pure functions next door, because the assertions count
 * vertices and compare two renders — numbers, not pixels.
 */
export function BriefingDataArea({ groups, text, locale, formatTime, paymentDirectionsCompact }: Readonly<{
  groups: BriefingDataGroups
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  paymentDirectionsCompact: paymentDirectionWords
}>): React.ReactElement {
  const policy = groups.policyPath
  const readings = groups.readings
  const leverage = groups.leverage
  return <div className="mi-brief-poster__data" data-briefing-data-region="true">
    {policy && policy.visibility !== 'hidden' ? <PolicyCard policy={policy} text={text} formatTime={formatTime} /> : null}
    <div className="mi-brief-poster__price-row" data-briefing-price-row="true">
      {groups.price.map((row) => <PriceCard key={row.id} row={row} text={text} locale={locale} formatTime={formatTime} />)}
    </div>
    {readings.length > 0 ? <div className="mi-brief-poster__readings-line" data-briefing-readings-line="true">
      {readings.map((row) => {
        const copy = changeLedRowCopy(row, text, locale)
        return <span className="mi-brief-poster__reading" key={row.id} data-reading={READING_IDS[row.id] ?? row.id} data-tone={toneFor(row)} data-lead={copy ? 'change' : 'value'}>
          <span className="mi-brief-poster__reading-label">{rowLabel(text, row.labelKey)}{fallbackLabel(row, text)}</span>
          <b>{copy ? copy.primary : formatBriefingValue(row.value, text.noValue, locale)}</b>
          <small>{copy ? copy.secondary : keyMeta(row, text, locale, formatTime)}</small>
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
        return <div className="mi-brief-poster__leverage-card" key={asset} data-briefing-leverage-card={asset} data-tone={rate === undefined || rate === 0 ? undefined : rate > 0 ? 'up' : 'down'}>
          <span>{asset.toUpperCase()}</span>
          <b>{rate === undefined ? text.noValue : `${rate > 0 ? '+' : ''}${rate.toFixed(4)}%`}</b>
          <small>{paymentDirectionFor(rate, paymentDirectionsCompact)}</small>
          <small>OI {entry.openInterestUsd !== undefined ? `$${(entry.openInterestUsd / 1e9).toFixed(2)}B` : text.noValue}</small>
          <small>1h {entry.change1hPct !== undefined ? `${entry.change1hPct.toFixed(1)}%` : text.noValue} · 24h {entry.change24hPct !== undefined ? `${entry.change24hPct.toFixed(1)}%` : text.noValue}</small>
        </div>
      })}
    </div> : null}
  </div>
}

const READING_IDS: Readonly<Record<string, string>> = Object.freeze({
  index: 'nasdaq', dxy: 'dxy', gold: 'gold', us10y: 'ust10y', 'us10y-real': 'ust10y-real', stablecoin: 'stablecoin', 'fear-greed': 'fear-greed'
})

function PolicyCard({ policy, text, formatTime }: Readonly<{
  policy: NonNullable<BriefingDataGroups['policyPath']>
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  const probability = Math.round(policy.probability * 10) / 10
  // The rest is computed here and nowhere else: two places subtracting from 100 is how an arc ends up
  // a sliver short or past the end of the dial. With a distribution in the document this becomes three
  // shares and the layout does not move.
  const arcs = policyGaugeArcs([probability, 100 - probability])
  return <div className="mi-brief-poster__policy-card" data-briefing-policy-card="true">
    <span className="mi-brief-poster__policy-title">{text.sections.policyPath}</span>
    <svg className="mi-brief-poster__policy-gauge" data-briefing-policy-gauge="true" viewBox={`0 0 ${POLICY_GAUGE.width} ${POLICY_GAUGE.height}`} role="img" aria-label={`${probability}%`}>
      <path className="mi-brief-poster__gauge-track" d={policyGaugeTrack()} fill="none" vectorEffect="non-scaling-stroke" />
      {/* Two segments today: the lead outcome and "not the lead outcome". The value names the role,
          not a bucket — once the distribution arrives these become hike-25 / no-change / other, and
          `residual` disappears. */}
      {arcs.map((path, index) => <path key={index} className={index === 0 ? 'mi-brief-poster__gauge-event' : 'mi-brief-poster__gauge-rest'} d={path} fill="none" vectorEffect="non-scaling-stroke" data-outcome={index === 0 ? 'event' : 'residual'} />)}
    </svg>
    {/* HTML, not svg text: the number stays selectable and the svg keeps zero text nodes. */}
    <b className="mi-brief-poster__policy-probability">{probability}% · {policyOutcomeLabel(policy.outcome, text)}</b>
    <span className="mi-brief-poster__policy-change">{text.sections.policyRange}</span>
    <small>{policy.targetLower !== undefined ? `${policy.targetLower}–${policy.targetUpper}%` : text.sections.rangeUnavailable}</small>
    <small className="mi-brief-poster__policy-meeting">{policy.meetingDate}</small>
    <small className="mi-brief-poster__policy-observed">{formatTime(policy.observedAt, 'minute')}</small>
  </div>
}

function PriceCard({ row, text, locale, formatTime }: Readonly<{
  row: BriefingMarketRow
  text: DailyBriefingText
  locale: 'zh-CN' | 'en-US'
  formatTime: (value: string, precision?: 'minute' | 'second') => string
}>): React.ReactElement {
  const copy = changeLedRowCopy(row, text, locale)
  // No series in the document yet: the slot draws its zero line and nothing else. The series arrives
  // with the contract version, and this component starts drawing it without moving.
  const values: readonly number[] = []
  const area = priceAreaPath(values)
  const line = priceLinePoints(values)
  return <div className="mi-brief-poster__price-card" data-tone={toneOf(row)} data-briefing-price-card={row.id}>
    <span className="mi-brief-poster__price-label">{rowLabel(text, row.labelKey)}{fallbackLabel(row, text)}</span>
    <b className="mi-brief-poster__price-value">{copy ? copy.primary : formatBriefingValue(row.value, text.noValue, locale)}</b>
    {copy ? <small>{copy.secondary}</small> : null}
    <svg className="mi-brief-poster__price-area" data-briefing-price-area={row.id} viewBox={`0 0 ${PRICE_AREA.width} ${PRICE_AREA.height}`} preserveAspectRatio="none">
      <line x1="0" y1={PRICE_AREA.zeroY} x2={PRICE_AREA.width} y2={PRICE_AREA.zeroY} className="mi-brief-poster__price-zero" vectorEffect="non-scaling-stroke" />
      {area ? <path d={area} className="mi-brief-poster__price-fill" fill="currentColor" opacity=".18" /> : null}
      {line ? <polyline points={line} className="mi-brief-poster__price-line" fill="none" stroke="currentColor" vectorEffect="non-scaling-stroke" /> : null}
    </svg>
    <small className="mi-brief-poster__price-observed">{formatTime(row.observedAt ?? '', 'minute')}</small>
  </div>
}

function primaryOf(row: BriefingMarketRow | BriefingPulseRow, text: DailyBriefingText, locale: 'zh-CN' | 'en-US'): string {
  const copy = changeLedRowCopy(row, text, locale)
  return copy ? copy.primary : formatBriefingValue(row.value, text.noValue, locale)
}

function toneOf(row: BriefingMarketRow | BriefingPulseRow): 'up' | 'down' | undefined {
  const value = row.change?.value ?? row.value?.number
  if (value === undefined || value === 0) return undefined
  return value > 0 ? 'up' : 'down'
}
