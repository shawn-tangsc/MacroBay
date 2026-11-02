import { Button } from 'antd'
import { StatusPill } from '@platform/ui/components/status-pill'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { useProductTextKey } from '../../shared/i18n/productTextKey'
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'

import './policyPathCard.css'

import { POLICY_PATH_OUTCOME_ORDER, namedOutcomes, formatSignedPp } from '../../../contracts/policyPath'
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
  /** `{month} 月{outcome}` in Chinese; the month and the bucket are separate so English can order them its way. */
  outcomeLead: string
  /** Explains the for-against pair on hover: "10–2" alone is not self-evident. */
  voteHint: string
  outcomes: Readonly<Record<'no-change' | 'hike-25' | 'hike-50-plus' | 'cut-25' | 'cut-50-plus', string>>
  /** Which shape the block is in: the countdown, the settlement, or the verdict. */
  phasePreMeeting: string; phaseSettlement: string
  /** The single repricing chip, and the two ways it can read. */
  markerRepricing: string; markerIntraday: string
  /** Bucket names for the two highest shares, and the remainder label. */
  topRest: string
  shortOutcomes: Readonly<Record<'no-change' | 'hike-25' | 'hike-50-plus' | 'cut-25' | 'cut-50-plus', string>>
  /** The pre-meeting block: what the median implies and what the venue quotes. */
  upgradeGapAbove: string; upgradeGapBelow: string; upgradeGapLevel: string
  upgradeCompare: string; upgradeCompareNoPrevious: string
  upgradeQuote: string; upgradeQuoteOnly: string
  /** The settlement strip: the realised band, the price before it, and the gap. */
  settlementActual: string; settlementPriced: string
  settlementOutcomeLine: string
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

/**
 * The card's freshness word as a state pill.
 *
 * `delayed` and `stale` share `warn` because only one of them can be on screen at a time and the two
 * words differ in what caused them (network lag vs. an old quote); collapsing them would lose that.
 * The shape of the dot (ring for `warn`, filled for `bad`) is what keeps them apart in greyscale —
 * the component owns it, the card only names the tone.
 */
const VOTE_HINT_KEY = 'pages.intelligence.portal.dashboard.policyPath.voteHint'

const STALENESS_TONE = { live: 'ok', delayed: 'warn', stale: 'warn', unavailable: 'bad' } as const
const STALENESS_KEY = {
  live: 'pages.intelligence.portal.dashboard.policyPath.live',
  delayed: 'pages.intelligence.portal.dashboard.policyPath.delayed',
  stale: 'pages.intelligence.portal.dashboard.policyPath.stale',
  unavailable: 'pages.intelligence.portal.dashboard.policyPath.unavailable'
} as const

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
  const resolveKey = useProductTextKey()
  const outcomeLabel = probability
    ? text.outcomeLead.replace('{month}', month).replace('{outcome}', text.outcomes[probability.outcome])
    : ''
  const phase = reading.phase
  // The markers describe the meeting the body is about. During the settlement strip the body is the
  // decision just made, while the stored series already belongs to the next meeting - a repricing
  // chip there would be read as part of the verdict.
  const marker = phase.kind === 'settlement' ? undefined : reading.markers?.[0]
  // The strip is the settlement body; the verdict keeps the normal body and only remembers the
  // conclusion in its footer, which is why the two uses are kept apart.
  const settlement = reading.settlement
  const distribution = probability?.distribution
  // One line, and only the buckets worth naming: anything under 5% is folded into "其他" so the
  // card says "hike or hold" without turning into a table. The full ramp lives in the drawer.
  const named = distribution === undefined
    ? undefined
    : namedOutcomes(distribution)
      // The leading answer comes first; ties keep the dovish-to-hawkish reading order.
      .sort((left, right) => distribution[right] - distribution[left])
      .map((outcome) => ({ outcome, share: distribution[outcome] }))
  // The remainder is the sum of the buckets that were folded away, not `1 - named`: the two agree
  // on normalised data, and summing keeps the line honest when a payload does not add to exactly 1.
  const rest = distribution === undefined || named === undefined
    ? 0
    : POLICY_PATH_OUTCOME_ORDER
      .filter((outcome) => !named.some((item) => item.outcome === outcome))
      .reduce((sum, outcome) => sum + distribution[outcome], 0)
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

  const facts: ReadonlyArray<Readonly<{ label: string; value: React.ReactNode; hintParams?: Readonly<Record<string, string>> }>> = strip
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
            // The numbers ride as parameters, not as a sentence built here: the template stays in the
            // copy table and the callsite only formats what it already knows.
            ...(reading.lastDecision?.vote ? { hintParams: {
              for: String(reading.lastDecision.vote.for), against: String(reading.lastDecision.vote.against) } } : {})
          }
        ]

  return <section className="mi-policy-card" aria-label={text.title} data-staleness={reading.staleness} data-phase={phase.kind}>
    <header className="mi-policy-card__head">
      <h2>{text.title}</h2>
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
          <span className="mi-policy-card__value">{probability ? percentOf(probability.value) : '—'}</span>
          {probability ? <span className="mi-policy-card__outcome">{outcomeLabel}</span> : null}
          {change === undefined ? null : <span className="mi-policy-card__delta" data-direction={change > 0 ? 'up' : change < 0 ? 'down' : 'flat'}>
            <Direction aria-hidden="true" size={12} />{Math.abs(change).toFixed(1)}pp
          </span>}
        </p>}

    {named === undefined || strip ? null : <span className="mi-policy-card__bar" aria-hidden="true">
      {/* Left to right by share, then everything folded away as one grey block at the end: the bar
          and the line under it say the same thing in the same order. */}
      {named.map(({ outcome, share }) => <i key={outcome} data-outcome={outcome}
        style={{ width: `${share * 100}%` }} />)}
      {rest > 0 ? <i data-outcome="other" style={{ width: `${rest * 100}%` }} /> : null}
    </span>}

    {named === undefined || strip ? null : <p className="mi-policy-card__mix">
      {named.map(({ outcome, share }) => <span key={outcome} data-outcome={outcome}>
        <em>{text.shortOutcomes[outcome]}</em> <b>{percentOf(share)}</b>
      </span>)}
      {rest > 0 ? <span className="mi-policy-card__mix-rest">
        {text.topRest.replace('{value}', percentOf(rest))}
      </span> : null}
    </p>}

    {phase.kind === 'pre-meeting' ? <PreMeetingBlock reading={reading} text={text} /> : null}
    {strip ? <SettlementBlock settlement={strip} text={text} /> : null}

    <dl className="mi-policy-card__facts">
      {facts.map((row) => <div key={row.label}>
        <dt>{row.label}</dt>
        {/* The hint rides the accessible name, not a focus stop: a `dd` is not a control, so giving
            it focus put a stop in the Tab order where pressing anything does nothing. The numbers
            still come from the template through the shared filler. */}
        {row.hintParams
          ? <dd aria-label={fillLabelParams(resolveKey(VOTE_HINT_KEY), row.hintParams)}>{row.value}</dd>
          : <dd>{row.value}</dd>}
      </div>)}
    </dl>

    {/* The verdict survives the strip as one clickable grey line: the full explanation lives in the
        drawer, so the card keeps the normal reading position and only adds a memory. */}
    {phase.kind === 'verdict' && judged && judged.direction !== 'missing' ? <Button type="text" className="mi-policy-card__judged" onClick={onOpen}>
      <span>{text.judgedLabel}</span>
      <b data-direction={judged.direction}>{judged.label}</b>
    </Button> : null}

    <footer className="mi-policy-card__foot">
      {/* The state word and where the odds come from are one reading, not two cells of a row: the
          footer spreads its children apart, so as siblings they sat at opposite ends with the
          venue floating in the middle. Grouping them keeps the provenance together on the left. */}
      <span className="mi-policy-card__provenance">
        {phase.kind === 'settlement'
          // A time phrase ("2 hours after the decision"), not a state word: it stays text.
          ? <span className="mi-policy-card__status">{settledFor(phase.minutesSinceDecision, text)}</span>
          : <>
              <StatusPill tone={STALENESS_TONE[reading.staleness]} labelKey={STALENESS_KEY[reading.staleness]} resolveText={resolveKey} />
              {probability ? <span className="mi-policy-card__status">· {probability.venue}</span> : null}
            </>}
      </span>
      {onOpen ? <Button type="link" className="mi-policy-card__open" onClick={onOpen}>
        {text.detail}<ArrowUpRight aria-hidden="true" size={12} />
      </Button> : null}
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
function SettlementBlock({ settlement, text }: Readonly<{ settlement: PolicyPathSettlement; text: PolicyPathCardText }>): React.ReactElement | null {
  // The strip only mounts when the settlement has a conclusion, and a conclusion needs both numbers;
  // the guard keeps the type honest instead of carrying copy for a state that cannot happen.
  if (settlement.priced === undefined || settlement.pricedOutcome === undefined) return null
  return <div className="mi-policy-card__upgrade">
    <b>{text.settlementPriced.replace('{value}', percentOf(settlement.priced))}</b>
    <span>{text.settlementOutcomeLine
      .replace('{actual}', text.outcomes[settlement.actualOutcome])
      .replace('{priced}', text.outcomes[settlement.pricedOutcome])}</span>
  </div>
}
