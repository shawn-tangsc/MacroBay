import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DashboardDivergenceViewState } from '../../../pages/intelligence/dashboardDivergenceModel'
import type { DivergencePanelText } from './divergenceText'

/**
 * The one card that reads two others.
 *
 * It shows divergences and nothing else: agreement is the default state of these legs, and a row
 * saying "they agree" would restate three cards the reader has already seen. A pair that could not
 * be compared is named at the bottom — "nothing diverged" and "we could not compare" must not look
 * the same.
 */
export function DivergencePanel({ state, text }: Readonly<{
  state: DashboardDivergenceViewState
  text: DivergencePanelText
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const withheld = state.state === 'available' || state.state === 'empty' ? state.withheld : []
  const when = (value: string) => formatTime(value.replace('T', ' ').slice(0, 19) + 'Z')

  return (
    <section className="mi-divergence" aria-labelledby="mi-divergence-heading" data-state={state.state}>
      <h2 id="mi-divergence-heading">{text.title}</h2>
      {state.state === 'loading' ? <LoadingState label={text.loading} minHeight={48} /> : null}
      {state.state === 'unavailable' ? <p className="mi-divergence__note" data-tone="muted">{text.unavailable}</p> : null}
      {state.state === 'empty' ? <p className="mi-divergence__note" data-tone="muted">{text.empty}</p> : null}
      {state.state === 'available' ? (
        <ul className="mi-divergence__rows">
          {state.rows.map(row => (
            <li key={row.pairId} className="mi-divergence__row" data-pair={row.pairId} data-direction={row.direction}>
              <div className="mi-divergence__head">
                <b className="mi-divergence__direction" data-direction={row.direction}>{text.directions[row.direction]}</b>
                <span className="mi-divergence__legs">
                  {row.legs.map(leg => <span key={leg.id} className="mi-divergence__leg"><i>{text.legs[leg.id]}</i>{leg.text}</span>)}
                </span>
              </div>
              <p className="mi-divergence__mechanism">{text.pairs[row.pairId as keyof DivergencePanelText['pairs']].mechanism}</p>
              <p className="mi-divergence__invalidation">
                {text.invalidationLabel}：{text.pairs[row.pairId as keyof DivergencePanelText['pairs']].invalidation}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
      {withheld.length > 0 ? (
        <div className="mi-divergence__withheld" data-withheld={withheld.length}>
          <span className="mi-divergence__withheld-title">{text.withheldTitle}：</span>
          {withheld.map(entry => (
            <span key={`${entry.pairId}-${entry.leg}`} className="mi-divergence__withheld-item" data-reason={entry.reason}>
              {text.withheldReasons[entry.reason]
                .replace('{leg}', text.legs[entry.leg])
                .replace('{at}', entry.observedAt ? when(entry.observedAt) : '—')}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  )
}
