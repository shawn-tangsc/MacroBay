import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'

import './policyPathCard.css'

import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'

/**
 * The policy reading as a rail card.
 *
 * It leads with the only fast-moving number (the odds), then the two slow facts the reader needs to
 * place it: which meeting, and the range the odds are relative to. It never fetches — the caller owns
 * the read.
 */
export type PolicyPathCardText = Readonly<{
  title: string; range: string; meeting: string; daysAway: string; projection: string
  probability: string; probabilityLabel: string; cardOutcome: string; lastVote: string; unchanged: string
  detail: string; sepMedian: string; live: string; delayed: string; stale: string; unavailable: string
}>

export function PolicyPathCard({ reading, text, month, onOpen }: Readonly<{
  reading: PolicyPathReading
  text: PolicyPathCardText
  month: string
  onOpen?: () => void
}>): React.ReactElement {
  const probability = reading.probability
  const change = probability?.changeInPp24h
  const Direction = change === undefined || change === 0 ? Minus : change > 0 ? TrendingUp : TrendingDown
  const freshness = text[reading.staleness] ?? text.unavailable
  return <section className="mi-policy-card" aria-label={text.title} data-staleness={reading.staleness}>
    <header className="mi-policy-card__head">
      <h2>{text.title}</h2>
      {reading.hasProjectionMaterials ? <span className="mi-policy-card__chip">{text.projection}</span> : null}
    </header>

    {/* One skeleton for every state: a missing value becomes a dash, so the card never changes
        shape - only its colour says whether the number is live, late, or absent. */}
    <p className="mi-policy-card__lead">
      <span className="mi-policy-card__value">{probability ? `${(probability.value * 100).toFixed(0)}%` : '—'}</span>
      <span className="mi-policy-card__outcome">{text.cardOutcome.replace('{month}', month)}</span>
      {change === undefined ? null : <span className="mi-policy-card__delta" data-direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}>
        <Direction aria-hidden="true" size={12} />{Math.abs(change).toFixed(1)}pp
      </span>}
    </p>

    <dl className="mi-policy-card__facts">
      <div>
        <dt>{text.meeting}</dt>
        <dd>{reading.meetingDate.slice(5)}<span className="mi-policy-card__muted"> · {text.daysAway.replace('{days}', String(reading.daysUntilMeeting))}</span></dd>
      </div>
      <div>
        <dt>{text.range}</dt>
        <dd>{reading.targetRange
          ? `${reading.targetRange.lowerPercent.toFixed(2)}–${reading.targetRange.upperPercent.toFixed(2)}%`
          : '—'}</dd>
      </div>
      <div>
        <dt>{text.sepMedian}</dt>
        <dd>{reading.sep?.medianCurrentYear === undefined
          ? '—'
          : <>{reading.sep.medianCurrentYear.toFixed(1)}%<span className="mi-policy-card__muted">（{reading.sep.asOf.slice(5)}）</span></>}</dd>
      </div>
      <div>
        <dt>{text.lastVote}</dt>
        <dd>{reading.lastDecision?.vote
          ? `${text.unchanged} ${reading.lastDecision.vote.for}–${reading.lastDecision.vote.against}`
          : '—'}</dd>
      </div>
    </dl>

    <footer className="mi-policy-card__foot">
      <span className="mi-policy-card__status">
        <i aria-hidden="true" />{freshness}{probability ? ` · ${probability.venue}` : ''}
      </span>
      {onOpen ? <button className="mi-policy-card__open" onClick={onOpen} type="button">
        {text.detail}<ArrowUpRight aria-hidden="true" size={12} />
      </button> : null}
    </footer>
  </section>
}
