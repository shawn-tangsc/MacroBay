import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'

import './policyPathStrip.css'

import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'

/**
 * One line of policy readings. It never fetches: the caller owns the read, and this component only
 * decides how a reading looks. Empty space is deliberate — a policy block that borrows market quotes
 * to fill it would blur two different kinds of number.
 */
export type PolicyPathText = Readonly<{
  title: string; range: string; meeting: string; daysAway: string; projection: string
  probability: string; probabilityLabel: string; lastVote: string; unchanged: string; detail: string; sepMedian: string
  live: string; delayed: string; stale: string; unavailable: string; loading: string
}>

export function PolicyPathStrip({ reading, text, month, onOpen }: Readonly<{
  reading?: PolicyPathReading
  text: PolicyPathText
  month: string
  onOpen?: () => void
}>): React.ReactElement | null {
  if (!reading) return null
  const probability = reading.probability
  const change = probability?.changeInPp24h
  const Direction = change === undefined || change === 0 ? Minus : change > 0 ? TrendingUp : TrendingDown
  const freshness = text[reading.staleness] ?? text.unavailable
  return <section className="mi-policy-path" aria-label={text.title} data-staleness={reading.staleness}>
    <h2 className="mi-policy-path__title">{text.title}</h2>
    <dl className="mi-policy-path__row">
      {reading.targetRange ? <div className="mi-policy-path__item">
        <dt>{text.range}</dt>
        <dd>{reading.targetRange.lowerPercent.toFixed(2)}–{reading.targetRange.upperPercent.toFixed(2)}%</dd>
      </div> : null}
      <div className="mi-policy-path__item">
        <dt>{text.meeting}</dt>
        <dd>{reading.meetingDate.slice(5)}<span className="mi-policy-path__muted"> · {text.daysAway.replace('{days}', String(reading.daysUntilMeeting))}</span>
          {reading.hasProjectionMaterials ? <span className="mi-policy-path__chip">{text.projection}</span> : null}</dd>
      </div>
      {probability ? <div className="mi-policy-path__item">
        <dt>{text.probability.replace('{month}', month)}</dt>
        <dd>{(probability.value * 100).toFixed(0)}%
          {change === undefined ? null : <span className="mi-policy-path__delta" data-direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}>
            <Direction aria-hidden="true" size={12} />{Math.abs(change).toFixed(1)}</span>}
        </dd>
      </div> : null}
      {reading.sep?.medianCurrentYear === undefined ? null : <div className="mi-policy-path__item">
        <dt>{text.sepMedian}</dt>
        <dd>{reading.sep.medianCurrentYear.toFixed(1)}%
          <span className="mi-policy-path__muted">（{reading.sep.asOf.slice(5)}）</span></dd>
      </div>}
      {reading.lastDecision?.vote ? <div className="mi-policy-path__item">
        <dt>{text.lastVote}</dt>
        <dd>{text.unchanged} {reading.lastDecision.vote.for}–{reading.lastDecision.vote.against}</dd>
      </div> : null}
    </dl>
    {/* The freshness word describes the quote; with no quote there is nothing to age, and
        "unavailable" would read as if the whole row had failed. */}
    {probability ? <span className="mi-policy-path__freshness" data-staleness={reading.staleness}>{freshness}</span> : null}
    {onOpen ? <button className="mi-policy-path__open" onClick={onOpen} type="button">
      {text.detail}<ArrowUpRight aria-hidden="true" size={12} />
    </button> : null}
  </section>
}
