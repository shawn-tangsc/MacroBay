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
  sepMissing: string; decisionMissing: string
  odds: string; change24h: string; range30d: string; quote: string
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
    <section className="mi-policy-drawer__section">
      <h3>{text.sepPath}</h3>
      {reading.sep ? <>
      <h3>{text.sepPath}<a href={reading.sep.sourceUrl} rel="noreferrer" target="_blank">{text.openSource}<ExternalLink aria-hidden="true" size={11} /></a></h3>
      <table>
        <thead><tr>{years.map((year) => <th key={year}>{year === 'longerRun' ? 'LR' : year.slice(1)}</th>)}</tr></thead>
        <tbody><tr>{years.map((year) => <td key={year}>{reading.sep?.medianPath?.[year]?.toFixed(1) ?? '—'}</td>)}</tr></tbody>
      </table>
      <p className="mi-policy-drawer__meta">{text.asOf} {reading.sep.asOf}
        {reading.sep.rangeCurrentYear ? <span> · {text.sepRange} {reading.sep.rangeCurrentYear.low}–{reading.sep.rangeCurrentYear.high}%</span> : null}
        {reading.sep.previousMedian === undefined ? null : <span> · {text.previous} {reading.sep.previousMedian}%</span>}</p>
      </> : <p className="mi-policy-drawer__row">{text.sepMissing}</p>}
    </section>
    <section className="mi-policy-drawer__section">
      <h3>{text.decision}{reading.lastDecision?.statementUrl
        ? <a href={reading.lastDecision.statementUrl} rel="noreferrer" target="_blank">{text.openSource}<ExternalLink aria-hidden="true" size={11} /></a>
        : null}</h3>
      {reading.lastDecision?.vote ? <>
        <p className="mi-policy-drawer__row">{text.vote} {reading.lastDecision.vote.for}–{reading.lastDecision.vote.against}</p>
        <p className="mi-policy-drawer__row">{text.dissents} {(reading.lastDecision.dissents ?? []).map((row) => row.name).join('、') || '—'}</p>
      </> : <p className="mi-policy-drawer__row">{text.decisionMissing}</p>}
    </section>
    <section className="mi-policy-drawer__section">
      <h3>{text.basis}</h3>
      {reading.probability ? <>
        <p className="mi-policy-drawer__row">{text.odds} {(reading.probability.value * 100).toFixed(0)}%
          {reading.probability.changeInPp24h === undefined ? null : <span> · {text.change24h} {reading.probability.changeInPp24h > 0 ? '+' : ''}{reading.probability.changeInPp24h.toFixed(1)}pp</span>}
        </p>
        {reading.probability.range30d ? <p className="mi-policy-drawer__row">{text.range30d} {(reading.probability.range30d.min * 100).toFixed(0)}–{(reading.probability.range30d.max * 100).toFixed(0)}%</p> : null}
        {reading.probability.quote ? <p className="mi-policy-drawer__row">{text.quote} {(reading.probability.quote.bid * 100).toFixed(0)} / {(reading.probability.quote.ask * 100).toFixed(0)}</p> : null}
      </> : null}
      <p className="mi-policy-drawer__row">{text.venue} {reading.probability?.venue ?? '—'}</p>
      {reading.probability?.asOf ? <p className="mi-policy-drawer__row">{text.asOf} {reading.probability.asOf}</p> : null}
      {reading.targetRange ? <p className="mi-policy-drawer__row">
        <a href="https://fred.stlouisfed.org/series/DFEDTARU" rel="noreferrer" target="_blank">FRED · DFEDTARU<ExternalLink aria-hidden="true" size={11} /></a>
      </p> : null}
      {!reading.sep && !reading.lastDecision?.vote && !reading.probability ? <p className="mi-policy-drawer__row">{text.empty}</p> : null}
    </section>
  </aside>
}
