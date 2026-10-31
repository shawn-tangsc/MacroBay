import { Tooltip } from 'antd'
import { Info, RefreshCw } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DashboardDivergenceViewState, DivergenceWithheldView } from '../../../pages/intelligence/dashboardDivergenceModel'
import type { DivergencePanelText } from './divergenceText'

import './DivergencePanel.css'

/**
 * A conclusion about the card above it.
 *
 * Only readings are on the card: the "why this was judged, and by whom" prose lives behind the `?`
 * before the title, because a reader who came for the readings should not have to step over four
 * lines of explanation to reach them.
 */
export function DivergencePanel({ state, text, onRetry }: Readonly<{
  state: DashboardDivergenceViewState
  text: DivergencePanelText
  /** Only offered on a quiet day: asking the model for a second opinion costs a request. */
  onRetry?: () => void
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const withheld = state.state === 'available' || state.state === 'empty' ? state.withheld : []
  const judgedBy = state.state === 'available' && state.rows.every(row => row.judgedBy === 'ai') ? 'ai' : 'rules'
  // Three pairs withheld is not "no divergence": nothing was compared. Saying so is the whole
  // point of the withheld list, and it must not read as a quiet day.
  const nothingCompared = state.state === 'empty' && withheld.length >= Object.keys(text.pairNames).length
  const when = (value: string) => formatTime(`${value.replace('T', ' ').slice(0, 19)}Z`)

  return (
    <section className="mi-divergence" aria-labelledby="mi-divergence-heading" data-state={state.state}>
      <header className="mi-divergence__head">
        <Tooltip title={<span className="mi-divergence__help-body">{text.helpLines.map(line => <b key={line}>{line}</b>)}</span>}
          trigger={['hover', 'focus', 'click']}>
          <button type="button" className="mi-divergence__help" aria-label={text.helpLabel}>
            <Info size={11} aria-hidden="true" />
          </button>
        </Tooltip>
        <h2 id="mi-divergence-heading">{text.title}</h2>
        {state.state === 'available' && onRetry ? (
          // The badge is the trigger, not a label: pressing it asks the model again.
          <button type="button" className="mi-divergence__judge" data-judged-by={judgedBy} onClick={onRetry}
            title={text.judgeAgain}>
            {text.judgedBy[judgedBy]}<RefreshCw size={9} aria-hidden="true" />
          </button>
        ) : null}
        {state.state === 'available' && !onRetry ? <span className="mi-divergence__judge" data-judged-by={judgedBy}>{text.judgedBy[judgedBy]}</span> : null}
        {state.state === 'empty' && onRetry ? (
          <button type="button" className="mi-divergence__act" onClick={onRetry}>{text.judgeAgain}</button>
        ) : null}
      </header>

      {state.state === 'loading' ? <LoadingState label={text.loading} minHeight={40} /> : null}
      {state.state === 'unavailable' ? (
        <div className="mi-divergence__status" data-tone="error">
          <b>{text.unavailable}</b>
          {state.missing.length > 0 ? (
            <span className="mi-divergence__status-sub">
              {text.missingLegs.replace('{legs}', state.missing.map(leg => text.legs[leg]).join('、'))}
            </span>
          ) : (
            <span className="mi-divergence__status-sub">{text.unavailableWhy[state.reason]}</span>
          )}
          {onRetry ? <button type="button" className="mi-divergence__act" onClick={onRetry}>{text.retry}</button> : null}
        </div>
      ) : null}
      {state.state === 'empty' && !nothingCompared ? <p className="mi-divergence__note">{text.empty}</p> : null}
      {nothingCompared ? (
        <div className="mi-divergence__status" data-tone="error">
          <b>{text.nothingCompared}</b>
          <span className="mi-divergence__status-sub">{groupWithheld(withheld).map(group => text.withheldReasons[group.reason].replace('{leg}', text.legs[group.leg]).replace('{at}', group.observedAt ? when(group.observedAt) : '—')).join('、')}</span>
        </div>
      ) : null}

      {state.state === 'available' ? (
        <div className="mi-divergence__conclusion" data-tone="conclusion">
        <ul className="mi-divergence__rows">
          {state.rows.map(row => (
            <li key={row.pairId} className="mi-divergence__row" data-pair={row.pairId} data-direction={row.direction}
              title={row.invalidation ? `${text.invalidationLabel}：${row.invalidation}` : undefined}>
              <div className="mi-divergence__line">
                <b className="mi-divergence__direction" data-direction={row.direction}>{text.directions[row.direction]}</b>
                {row.legs.map(leg => <span key={leg.id} className="mi-divergence__leg"><i>{text.legs[leg.id]}</i>{leg.text}</span>)}
              </div>
              {row.mechanism ? <p className="mi-divergence__mechanism">{row.mechanism}</p> : null}
            </li>
          ))}
        </ul>
        </div>
      ) : null}

      {state.state === 'available' && withheld.length > 0 ? (
        <p className="mi-divergence__withheld">
          <span className="mi-divergence__withheld-title">{text.withheldTitle}：</span>
          {groupWithheld(withheld).map(group => (
            <span key={group.key} className="mi-divergence__withheld-item" data-reason={group.reason}>
              {text.withheldReasons[group.reason].replace('{leg}', text.legs[group.leg]).replace('{at}', group.observedAt ? when(group.observedAt) : '—')}
              {group.count > 1 ? text.withheldGroup.replace('{count}', String(group.count)) : ''}
            </span>
          ))}
        </p>
      ) : null}
    </section>
  )
}

/**
 * One entry per reason, not per pair: two pairs held back for the same missing leg is one fact
 * about the data, and printing it twice reads like a rendering fault.
 */
export function groupWithheld(entries: readonly DivergenceWithheldView[]): readonly Readonly<{
  key: string
  reason: DivergenceWithheldView['reason']
  leg: DivergenceWithheldView['leg']
  observedAt?: string
  count: number
}>[] {
  const groups = new Map<string, { key: string; reason: DivergenceWithheldView['reason']; leg: DivergenceWithheldView['leg']; observedAt?: string; count: number }>()
  for (const entry of entries) {
    const key = `${entry.reason}:${entry.leg}:${entry.observedAt ?? ''}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else {
      groups.set(key, {
        key, reason: entry.reason, leg: entry.leg,
        ...(entry.observedAt ? { observedAt: entry.observedAt } : {}),
        count: 1
      })
    }
  }
  return [...groups.values()]
}
