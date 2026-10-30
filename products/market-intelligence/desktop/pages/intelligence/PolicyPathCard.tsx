import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'

import './policyPathCard.css'

import { formatSignedPp } from '../../../contracts/policyPath'
import type { PolicyPathSettlement } from '../../../contracts/policyPath'
import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import { conclusionView, judgedView, percentOf, settledFor } from './policyPathSettlementText'

/**
 * The policy reading as a rail card.
 *
 * It leads with the only fast-moving number (the odds), then the two slow facts the reader needs to
 * place it: which meeting, and the range the odds are relative to. It never fetches — the caller owns
 * the read.
 *
 * The card keeps one skeleton in every shape. What changes is one block: outside the window it is the
 * odds and the meeting, inside it a countdown with what the committee median still implies, on the
 * day a settlement strip, and for three days after a verdict line at the bottom. Nothing else on the
 * page moves with it.
 */
export type PolicyPathCardText = Readonly<{
  title: string; range: string; meeting: string; daysAway: string; projection: string
  lastVote: string; unchanged: string
  detail: string; sepMedian: string; live: string; delayed: string; stale: string; unavailable: string
  helpLabel: string; helpLines: readonly string[]
  /** Explains the for-against pair on hover: "10–2" alone is not self-evident. */
  voteHint: string
  outcomes: Readonly<Record<'no-change' | 'hike-25' | 'hike-50-plus' | 'cut-25' | 'cut-50-plus', string>>
  /** Which shape the block is in: the countdown, the settlement, or the verdict. */
  phasePreMeeting: string; phaseSettlement: string
  /** The single repricing chip, and the two ways it can read. */
  markerRepricing: string; markerIntraday: string
  /** The pre-meeting block: what the median implies and what the venue quotes. */
  upgradeGapAbove: string; upgradeGapBelow: string; upgradeGapLevel: string
  upgradeCompare: string; upgradeCompareNoPrevious: string
  upgradeQuote: string; upgradeQuoteOnly: string
  /** The settlement strip: the realised band, the price before it, and the gap. */
  settlementActual: string; settlementPriced: string; settlementPricedMissing: string
  settlementOutcomeLine: string; settlementOutcomeLineNoPricing: string
  settlementPricedConclusion: string; settlementHawkish: string; settlementDovish: string
  settlementConclusionMissing: string
  /** The verdict line under the facts: what the last decision was, against what was priced. */
  judgedLabel: string; judgedPriced: string; judgedHawkish: string; judgedDovish: string
  newTargetRange: string; voteTally: string
  settledMinutes: string; settledHours: string
  /** The last decision's direction, for the "last" row when the settlement knows it. */
  decisionHike: string; decisionCut: string
}>

const signedCount = (value: number): string => `${value > 0 ? '+' : ''}${value}`

/**
 * What the last decision did. The reading derives it from the two ranges; the settlement's own
 * answer is only a fallback for older payloads, because a card that always says "维持" would be
 * wrong the first time the committee moves.
 */
function lastActionOf(reading: PolicyPathReading, settlement: PolicyPathSettlement | undefined, text: PolicyPathCardText): string {
  const outcome = reading.lastDecision?.outcome ?? settlement?.actualOutcome
  if (!outcome) return '—'
  // A hold stays one short word here; only a real move needs the band spelled out.
  return outcome === 'no-change' ? text.unchanged : text.outcomes[outcome]
}

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
  // The leading bucket is the market's answer, not necessarily a hike.
  const outcomeLabel = probability ? `${month} 月${text.outcomes[probability.outcome]}` : ''
  const phase = reading.phase
  const marker = reading.markers?.[0]
  // The strip is the settlement body; the verdict keeps the normal body and only remembers the
  // conclusion in its footer, which is why the two uses are kept apart.
  const settlement = reading.settlement
  const strip = phase.kind === 'settlement' ? settlement : undefined
  const nextMeeting = strip?.nextMeeting

  const markerChip = marker ? <span className="mi-policy-card__marker" data-level={marker.level}>
    {(marker.kind === 'repricing' ? text.markerRepricing : text.markerIntraday)
      .replace('{value}', formatSignedPp(marker.changeInPp))}
  </span> : null

  const phaseChip = phase.kind === 'pre-meeting'
    ? <span className="mi-policy-card__phase" data-phase="pre">{text.phasePreMeeting.replace('{days}', String(phase.daysLeft))}</span>
    : phase.kind === 'settlement'
      // The verdict does not chip the header: its memory is the clickable line under the facts.
      ? <span className="mi-policy-card__phase" data-phase="settle">{text.phaseSettlement}</span>
      : null

  const conclusion = conclusionView(settlement, text)
  const judged = judgedView(settlement, text)
  const meetingValue = (date: string, days: number) => <>
    {date.slice(5)}<span className="mi-policy-card__muted"> · {text.daysAway.replace('{days}', String(days))}</span>
  </>
  const rangeValue = reading.targetRange
    ? `${reading.targetRange.lowerPercent.toFixed(2)}–${reading.targetRange.upperPercent.toFixed(2)}%`
    : '—'
  const sepMedianValue = reading.sep?.medianCurrentYear === undefined
    ? '—'
    : <>{reading.sep.medianCurrentYear.toFixed(1)}%<span className="mi-policy-card__muted">（{reading.sep.asOf.slice(5)}）</span></>

  const facts: ReadonlyArray<Readonly<{ label: string; value: React.ReactNode; hint?: string }>> = strip
    ? [
        { label: text.newTargetRange, value: rangeValue },
        { label: text.voteTally, value: reading.lastDecision?.vote ? `${reading.lastDecision.vote.for}–${reading.lastDecision.vote.against}` : '—' },
        { label: text.meeting, value: meetingValue(nextMeeting?.meetingDate ?? reading.meetingDate, nextMeeting?.daysUntil ?? reading.daysUntilMeeting) }
      ]
    : phase.kind === 'pre-meeting'
      // The countdown block already carries the median and the venue quote, so the row does not
      // repeat them: two facts, not four competing copies of the same number.
      ? [
          { label: text.meeting, value: meetingValue(reading.meetingDate, reading.daysUntilMeeting) },
          { label: text.range, value: rangeValue }
        ]
      : [
          { label: text.meeting, value: meetingValue(reading.meetingDate, reading.daysUntilMeeting) },
          { label: text.range, value: rangeValue },
          { label: text.sepMedian, value: sepMedianValue },
          {
            label: text.lastVote,
            value: reading.lastDecision?.vote
              ? `${lastActionOf(reading, settlement, text)} · ${reading.lastDecision.vote.for}–${reading.lastDecision.vote.against}`
              : '—',
            ...(reading.lastDecision?.vote ? { hint: text.voteHint
              .replace('{for}', String(reading.lastDecision.vote.for))
              .replace('{against}', String(reading.lastDecision.vote.against)) } : {})
          }
        ]

  return <section className="mi-policy-card" aria-label={text.title} data-staleness={reading.staleness} data-phase={phase.kind}>
    <header className="mi-policy-card__head">
      <h2>{text.title}</h2>
      {/* The odds are the one number on this card a reader cannot derive from anything else here. */}
      <span className="mi-policy-card__help" tabIndex={0} aria-label={text.helpLabel} role="note">
        ?
        <span className="mi-policy-card__help-pop" role="tooltip">
          <b>{text.helpLabel}</b>
          {text.helpLines.map((line) => <span key={line}>{line}</span>)}
        </span>
      </span>
      {markerChip}
      {phaseChip}
      {phase.kind === 'normal' || phase.kind === 'verdict'
        ? reading.hasProjectionMaterials ? <span className="mi-policy-card__chip">{text.projection}</span> : null
        : null}
    </header>

    {/* One skeleton for every state: a missing value becomes a dash, so the card never changes
        shape - only its colour says whether the number is live, late, or absent. */}
    {strip
      ? <p className="mi-policy-card__settle">
          <b>{text.outcomes[strip.actualOutcome]}</b>
          <span>{text.settlementActual.replace('{date}', strip.decidedMeetingDate.slice(5))}</span>
          {conclusion === undefined ? null : <span className="mi-policy-card__verdict" data-direction={conclusion.direction}>
            {conclusion.label}
          </span>}
        </p>
      : <p className="mi-policy-card__lead">
          <span className="mi-policy-card__value">{probability ? `${(probability.value * 100).toFixed(0)}%` : '—'}</span>
          {probability ? <span className="mi-policy-card__outcome">{outcomeLabel}</span> : null}
          {change === undefined ? null : <span className="mi-policy-card__delta" data-direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}>
            <Direction aria-hidden="true" size={12} />{Math.abs(change).toFixed(1)}pp
          </span>}
        </p>}

    {phase.kind === 'pre-meeting' ? <PreMeetingBlock reading={reading} text={text} /> : null}
    {strip ? <SettlementBlock settlement={strip} text={text} /> : null}

    <dl className="mi-policy-card__facts">
      {facts.map((row) => <div key={row.label}>
        <dt>{row.label}</dt>
        <dd title={row.hint}>{row.value}</dd>
      </div>)}
    </dl>

    {/* The verdict survives the strip as one clickable grey line: the full explanation lives in the
        drawer, so the card keeps the normal reading position and only adds a memory. */}
    {phase.kind === 'verdict' && judged ? <button type="button" className="mi-policy-card__judged" onClick={onOpen}>
      <span>{text.judgedLabel}</span>
      <b data-direction={judged.direction}>{judged.label}</b>
    </button> : null}

    <footer className="mi-policy-card__foot">
      {phase.kind === 'settlement'
        ? <span className="mi-policy-card__status"><i aria-hidden="true" />{settledFor(phase.minutesSinceDecision, text)}</span>
        : <span className="mi-policy-card__status"><i aria-hidden="true" />{freshness}{probability ? ` · ${probability.venue}` : ''}</span>}
      {onOpen ? <button className="mi-policy-card__open" onClick={onOpen} type="button">
        {text.detail}<ArrowUpRight aria-hidden="true" size={12} />
      </button> : null}
    </footer>
  </section>
}

/**
 * What the median implies while the meeting is inside two weeks: the gap itself, the same gap last
 * quarter, and what the venue quotes. Only lines with data render, so a missing SEP shortens the
 * block instead of printing three dashes.
 */
function PreMeetingBlock({ reading, text }: Readonly<{ reading: PolicyPathReading; text: PolicyPathCardText }>): React.ReactElement | null {
  const gap = reading.sep?.stepsFromCurrent
  const gapLine = gap === undefined ? undefined
    : gap === 0 ? text.upgradeGapLevel
      : (gap > 0 ? text.upgradeGapAbove : text.upgradeGapBelow).replace('{steps}', String(Math.abs(gap)))
  const median = reading.sep?.medianCurrentYear
  const midpoint = reading.targetRange
    ? (reading.targetRange.lowerPercent + reading.targetRange.upperPercent) / 2
    : undefined
  const compareLine = median === undefined || midpoint === undefined ? undefined
    : (reading.sep?.previousStepsFromCurrent === undefined
      ? text.upgradeCompareNoPrevious
      : text.upgradeCompare.replace('{previousSteps}', signedCount(reading.sep.previousStepsFromCurrent)))
      .replace('{median}', median.toFixed(1))
      .replace('{midpoint}', midpoint.toFixed(2))
  const quote = reading.probability?.quote
  const range30d = reading.probability?.range30d
  const quoteLine = quote === undefined ? undefined
    : (range30d ? text.upgradeQuote : text.upgradeQuoteOnly)
      .replace('{bid}', (quote.bid * 100).toFixed(0))
      .replace('{ask}', (quote.ask * 100).toFixed(0))
      .replace('{min}', range30d ? (range30d.min * 100).toFixed(0) : '')
      .replace('{max}', range30d ? (range30d.max * 100).toFixed(0) : '')
  if (gapLine === undefined && compareLine === undefined && quoteLine === undefined) return null
  return <div className="mi-policy-card__upgrade">
    {gapLine === undefined ? null : <b>{gapLine}</b>}
    {compareLine === undefined ? null : <span>{compareLine}</span>}
    {quoteLine === undefined ? null : <span>{quoteLine}</span>}
  </div>
}

/** The strip under the realised band: what it was priced at, and which band was leading instead. */
function SettlementBlock({ settlement, text }: Readonly<{ settlement: PolicyPathSettlement; text: PolicyPathCardText }>): React.ReactElement {
  const actual = text.outcomes[settlement.actualOutcome]
  return <div className="mi-policy-card__upgrade">
    <b>{settlement.priced === undefined
      ? text.settlementPricedMissing
      : text.settlementPriced.replace('{value}', percentOf(settlement.priced))}</b>
    <span>{settlement.pricedOutcome
      ? text.settlementOutcomeLine.replace('{actual}', actual).replace('{priced}', text.outcomes[settlement.pricedOutcome])
      : text.settlementOutcomeLineNoPricing.replace('{actual}', actual)}</span>
  </div>
}
