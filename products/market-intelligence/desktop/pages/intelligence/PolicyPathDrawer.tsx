import { ExternalLink } from 'lucide-react'

import { MiSideDrawer } from './MiSideDrawer'

import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import './policyPathDrawer.css'

/**
 * The policy reading's detail: the projection path, the vote behind the last decision, and the basis
 * of the odds. Every number here can be opened at its source, which is the point of the drawer.
 *
 * It opens on the left because the card that opens it lives in the right rail: the rail stays
 * visible, and the reader keeps the calendar in sight while reading the same meeting's projections.
 */
export type PolicyPathDrawerText = Readonly<{
  title: string; sepPath: string; decision: string; basis: string; close: string; openSource: string
  median: string; sepRange: string; previous: string; vote: string; dissents: string; venue: string; asOf: string; empty: string
  odds: string; change24h: string; range30d: string; quote: string
  sepMissing: string; decisionMissing: string
  meeting: string; daysAway: string; projection: string; unchanged: string; range: string
  preferred: Readonly<Record<'raise' | 'lower' | 'maintain', string>>
  /** Why a dash appears where a 24h change belongs: the series is younger than the window. */
  change24hPending: string
  outcomes: Readonly<Record<'no-change' | 'hike-25' | 'hike-50-plus' | 'cut-25' | 'cut-50-plus', string>>
}>

/**
 * The projection columns come from the stored table, not from a fixed list: next year's SEP covers a
 * different four-year window, and a hardcoded 2026–2029 would print four dashes for it.
 */
function projectionColumns(medianPath: Readonly<Record<string, number>> | undefined) {
  const keys = Object.keys(medianPath ?? {}).filter((key) => key === 'longerRun' || /^y\d{4}$/.test(key))
  return keys.sort((left, right) => (left === 'longerRun' ? 1 : right === 'longerRun' ? -1 : left.localeCompare(right)))
    .map((key) => ({ key, label: key === 'longerRun' ? '长期' : key.slice(1) }))
}

export function PolicyPathDrawer({ reading, text, onClose }: Readonly<{
  reading: PolicyPathReading
  text: PolicyPathDrawerText
  onClose: () => void
}>): React.ReactElement {
  const probability = reading.probability
  const vote = reading.lastDecision?.vote
  return <MiSideDrawer title={text.title} closeLabel={text.close} onClose={onClose}
    meta={<>
      <span>{text.meeting} {reading.meetingDate.slice(5)} · {text.daysAway.replace('{days}', String(reading.daysUntilMeeting))}</span>
      {reading.hasProjectionMaterials ? <em className="mi-policy-drawer__chip">{text.projection}</em> : null}
    </>}>

    <div className="mi-policy-drawer__hero">
      <span className="mi-policy-drawer__value">{probability ? `${(probability.value * 100).toFixed(0)}%` : '—'}</span>
      <span className="mi-policy-drawer__hero-label">{probability
        ? `${Number(reading.meetingDate.slice(5, 7))} 月${text.outcomes[probability.outcome]}`
        : ''}</span>
      {probability?.changeInPp24h === undefined ? null : <span className="mi-policy-drawer__delta" data-direction={probability.changeInPp24h > 0 ? 'up' : probability.changeInPp24h < 0 ? 'down' : 'flat'}>
        {probability.changeInPp24h > 0 ? '+' : ''}{probability.changeInPp24h.toFixed(1)}pp · {text.change24h}
      </span>}
    </div>

    <section className="mi-policy-drawer__section">
      <h3>{text.sepPath}
        {reading.sep ? <a href={reading.sep.sourceUrl} rel="noreferrer" target="_blank">{text.openSource}<ExternalLink aria-hidden="true" size={11} /></a> : null}
      </h3>
      {reading.sep ? <>
        <div className="mi-policy-drawer__path">
          {projectionColumns(reading.sep.medianPath).map(({ key, label }) => <div key={key} data-empty={reading.sep?.medianPath?.[key] === undefined ? 'true' : undefined}>
            <b>{reading.sep?.medianPath?.[key]?.toFixed(1) ?? '—'}</b><span>{label}</span>
          </div>)}
        </div>
        <p className="mi-policy-drawer__note">
          {text.asOf} {reading.sep.asOf}
          {reading.sep.rangeCurrentYear ? ` · ${text.sepRange} ${reading.sep.rangeCurrentYear.low}–${reading.sep.rangeCurrentYear.high}%` : ''}
          {reading.sep.previousMedian === undefined ? '' : ` · ${text.previous} ${reading.sep.previousMedian}%`}
        </p>
      </> : <p className="mi-policy-drawer__empty">{text.sepMissing}</p>}
    </section>

    <section className="mi-policy-drawer__section">
      <h3>{text.decision}
        {reading.lastDecision?.statementUrl ? <a href={reading.lastDecision.statementUrl} rel="noreferrer" target="_blank">{text.openSource}<ExternalLink aria-hidden="true" size={11} /></a> : null}
      </h3>
      {vote ? <>
        <div className="mi-policy-drawer__vote">
          <b>{vote.for}–{vote.against}</b><span>{text.unchanged}</span>
        </div>
        <p className="mi-policy-drawer__note">{text.dissents} {(reading.lastDecision?.dissents ?? [])
          .map((row) => `${row.name}（${text.preferred[row.preferred]}）`).join('、') || '—'}</p>
      </> : <p className="mi-policy-drawer__empty">{text.decisionMissing}</p>}
    </section>

    <section className="mi-policy-drawer__section">
      <h3>{text.basis}
        <a href="https://fred.stlouisfed.org/series/DFEDTARU" rel="noreferrer" target="_blank">FRED · DFEDTARU<ExternalLink aria-hidden="true" size={11} /></a>
      </h3>
      <dl className="mi-policy-drawer__kv">
        {probability ? <>
          <div><dt>{text.change24h}</dt><dd title={probability.changeInPp24h === undefined ? text.change24hPending : undefined}>
            {probability.changeInPp24h === undefined ? '—' : `${probability.changeInPp24h > 0 ? '+' : ''}${probability.changeInPp24h.toFixed(1)}pp`}
          </dd></div>
          <div><dt>{text.range30d}</dt><dd>{probability.range30d ? `${(probability.range30d.min * 100).toFixed(0)}–${(probability.range30d.max * 100).toFixed(0)}%` : '—'}</dd></div>
          <div><dt>{text.quote}</dt><dd>{probability.quote ? `${(probability.quote.bid * 100).toFixed(0)} / ${(probability.quote.ask * 100).toFixed(0)}` : '—'}</dd></div>
        </> : null}
        <div><dt>{text.venue}</dt><dd>{probability?.venue ?? '—'}</dd></div>
        <div><dt>{text.range}</dt><dd>{reading.targetRange ? `${reading.targetRange.lowerPercent.toFixed(2)}–${reading.targetRange.upperPercent.toFixed(2)}%` : '—'}</dd></div>
        {probability?.asOf ? <div><dt>{text.asOf}</dt><dd>{probability.asOf.replace('T', ' ').slice(0, 19)}</dd></div> : null}
      </dl>
    </section>
  </MiSideDrawer>
}
