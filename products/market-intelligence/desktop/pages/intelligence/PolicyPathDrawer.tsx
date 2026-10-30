import { ExternalLink, X } from 'lucide-react'

import type { PolicyPathReading } from '../../../service/intelligence/policy-path/policyPathQueryService'
import './policyPathDrawer.css'

/**
 * The policy block's detail: the median path, the vote, and where each of those came from.
 *
 * Every section carries its own link to the official page. A number a reader cannot open is a
 * number they have to trust, and this product does not ask for that.
 */
export type PolicyPathDrawerText = Readonly<{
  title: string; sepPath: string; decision: string; basis: string; close: string; openSource: string
  median: string; sepRange: string; previous: string; vote: string; dissents: string; venue: string; asOf: string; empty: string
}>

export function PolicyPathDrawer({ reading, text, onClose }: Readonly<{
  reading: PolicyPathReading
  text: PolicyPathDrawerText
  onClose: () => void
}>): React.ReactElement {
  const years = ['y2026', 'y2027', 'y2028', 'y2029', 'longerRun']
  return <aside className="mi-policy-drawer" role="dialog" aria-label={text.title}>
    <header className="mi-policy-drawer__head">
      <h2>{text.title}</h2>
      <button aria-label={text.close} onClick={onClose} type="button"><X aria-hidden="true" size={14} /></button>
    </header>
    {reading.sep ? <section className="mi-policy-drawer__section">
      <h3>{text.sepPath}<a href={reading.sep.sourceUrl} rel="noreferrer" target="_blank">{text.openSource}<ExternalLink aria-hidden="true" size={11} /></a></h3>
      <table>
        <thead><tr>{years.map((year) => <th key={year}>{year === 'longerRun' ? 'LR' : year.slice(1)}</th>)}</tr></thead>
        <tbody><tr>{years.map((year) => <td key={year}>{reading.sep?.medianPath?.[year]?.toFixed(1) ?? '—'}</td>)}</tr></tbody>
      </table>
      <p className="mi-policy-drawer__meta">{text.asOf} {reading.sep.asOf}
        {reading.sep.rangeCurrentYear ? <span> · {text.sepRange} {reading.sep.rangeCurrentYear.low}–{reading.sep.rangeCurrentYear.high}%</span> : null}
        {reading.sep.previousMedian === undefined ? null : <span> · {text.previous} {reading.sep.previousMedian}%</span>}</p>
    </section> : null}
    {reading.lastDecision?.vote ? <section className="mi-policy-drawer__section">
      <h3>{text.decision}{reading.lastDecision.statementUrl
        ? <a href={reading.lastDecision.statementUrl} rel="noreferrer" target="_blank">{text.openSource}<ExternalLink aria-hidden="true" size={11} /></a>
        : null}</h3>
      <p className="mi-policy-drawer__row">{text.vote} {reading.lastDecision.vote.for}–{reading.lastDecision.vote.against}</p>
      <p className="mi-policy-drawer__row">{text.dissents} {(reading.lastDecision.dissents ?? []).map((row) => row.name).join('、') || '—'}</p>
    </section> : null}
    <section className="mi-policy-drawer__section">
      <h3>{text.basis}</h3>
      <p className="mi-policy-drawer__row">{text.venue} {reading.probability?.venue ?? '—'}</p>
      {reading.probability?.asOf ? <p className="mi-policy-drawer__row">{text.asOf} {reading.probability.asOf}</p> : null}
      {reading.targetRange ? <p className="mi-policy-drawer__row">
        <a href="https://fred.stlouisfed.org/series/DFEDTARU" rel="noreferrer" target="_blank">FRED · DFEDTARU<ExternalLink aria-hidden="true" size={11} /></a>
      </p> : null}
      {!reading.sep && !reading.lastDecision?.vote && !reading.probability ? <p className="mi-policy-drawer__row">{text.empty}</p> : null}
    </section>
  </aside>
}
