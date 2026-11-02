import { Tooltip } from '@platform/ui/components/tooltip'
import { IconButton } from '@platform/ui/components/icon-button'

import { Popover } from '@platform/ui/components/popover'
import { Info } from 'lucide-react'

import { LoadingState } from '@platform/ui/components/loading'
import { StateView } from '@platform/ui/components/state'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { DashboardDivergenceViewState, DivergenceWithheldView } from '../../../pages/intelligence/dashboardDivergenceModel'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
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
  /** Always required: a failed read has one honest next step, and it must not appear and vanish. */
  onRetry: () => void
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const withheld = state.state === 'available' || state.state === 'empty' ? state.withheld : []
  // Three pairs withheld is not "no divergence": nothing was compared. Saying so is the whole
  // point of the withheld list, and it must not read as a quiet day.
  const nothingCompared = state.state === 'empty' && withheld.length >= Object.keys(text.pairNames).length
  const when = (value: string) => formatTime(`${value.replace('T', ' ').slice(0, 19)}Z`)
  const resolveProductKey = useProductTextKey()
  /**
   * The product's own sentence for the reason line, and only that line.
   *
   * `StateView` owns the title, the icon and the announcement; the one thing it cannot know is
   * which reading failed and what the reader can do about it. That sentence stays ours, resolved
   * from the text table by key, never passed as a literal.
   */
  const productReason = (spec: Readonly<{ key: string; params?: Record<string, string> }>) => ({
    ...spec,
    resolve: (key: string, params?: Record<string, string>) => {
      const sentence = resolveProductKey(key)
      if (!sentence || !params) return sentence
      return Object.entries(params).reduce((line, [name, value]) => line.split(`{${name}}`).join(value), sentence)
    }
  })

  return (
    <section className="mi-divergence" aria-label={text.title} data-state={state.state}>
      <div className="mi-divergence__lead">
        {/* Five lines are five keys, one per line: arrays are the semantic shape here, and a
            joined sentence with newlines would be lost the first time the copy is translated. */}
        <Popover
          lines={[
            { labelKey: 'pages.intelligence.portal.dashboard.divergence.helpLines.0' },
            { labelKey: 'pages.intelligence.portal.dashboard.divergence.helpLines.1' },
            { labelKey: 'pages.intelligence.portal.dashboard.divergence.helpLines.2' },
            { labelKey: 'pages.intelligence.portal.dashboard.divergence.helpLines.3' },
            { labelKey: 'pages.intelligence.portal.dashboard.divergence.helpLines.4' }
          ]}
          resolveText={resolveProductKey}
          trigger={(triggerProps) => (
            <IconButton
              {...triggerProps}
              ariaLabelKey="pages.intelligence.portal.dashboard.divergence.helpLabel"
              icon={Info} size="sm" resolveText={resolveProductKey} variant="plain" />
          )} />
      </div>
      <div className="mi-divergence__content">
        {state.state === 'loading' ? <LoadingState label={text.loading} minHeight={40} /> : null}
        {state.state === 'unavailable' ? (
          <StateView state="error" size="md"
            // A failed read is retryable; "six sources said nothing" is the same read failing one
            // layer earlier, so both keep the same next step instead of sending the reader to
            // settings that may be perfectly configured.
            reasonCode={unavailableReasonCode(state.reason)}
            // The action is not conditional: the same state must give the reader the same next
            // step wherever it appears. A button that sometimes disappears teaches nothing.
            action={{ labelKey: 'ui.state.action.retry', onSelect: onRetry }}
            productReason={productReason(state.missing.length > 0
              ? { key: 'pages.intelligence.portal.dashboard.divergence.missingLegs',
                  params: { legs: state.missing.map(leg => text.legs[leg]).join(text.withheldListSep) } }
              : { key: `pages.intelligence.portal.dashboard.divergence.unavailableWhy.${state.reason}` })} />
        ) : null}
        {state.state === 'empty' && !nothingCompared ? (
          // One line, no block: a card with nothing to report must not take half a screen to say so,
          // and the platform's empty-state heading ("nothing here yet") adds nothing on a quiet day.
          <p className="mi-divergence__quiet">{text.empty}</p>
        ) : null}
        {nothingCompared ? (
          <>
            <StateView state="error" reasonCode="unavailable" size="md"
              action={{ labelKey: 'ui.state.action.retry', onSelect: onRetry }}
              productReason={productReason({ key: 'pages.intelligence.portal.dashboard.divergence.nothingCompared' })} />
            {/* Which pairs were withheld is data, not a state: it stays one line under the state. */}
            <p className="mi-divergence__status-sub">{groupWithheld(withheld).map(group => withheldLine(text, group, when)).join(text.withheldListSep)}</p>
          </>
        ) : null}
        {state.state === 'available' ? (
          <div className="mi-divergence__conclusion" data-tone="conclusion">
            <ul className="mi-divergence__rows">
              {state.rows.map(row => (
                // Focusable, not titled: a `title` is invisible to the keyboard and the reader, so the
                // invalidation sentence opens on focus as well as on hover (single line, so Tooltip).
                <Tooltip key={row.pairId} resolveText={resolveProductKey}
                  dataText={invalidationLine(row.pairId, text)}>
                <li className="mi-divergence__row" data-pair={row.pairId} data-direction={row.direction} tabIndex={0}>
                  <div className="mi-divergence__line">
                    <b className="mi-divergence__direction" data-direction={row.direction}>{text.directions[row.direction]}</b>
                    {row.legs.map(leg => <span key={leg.id} className="mi-divergence__leg"><i>{text.legs[leg.id]}</i>{leg.text}</span>)}
                  </div>
                  <p className="mi-divergence__mechanism">{text.pairs[row.pairId as keyof DivergencePanelText['pairs']].mechanism}</p>
                </li>
                </Tooltip>
              ))}
            </ul>
          </div>
        ) : null}
        {state.state === 'available' && withheld.length > 0 ? (
          <p className="mi-divergence__withheld">
            <span className="mi-divergence__withheld-title">{text.withheldTitle}{text.labelSep}</span>
            {groupWithheld(withheld).map(group => (
              <span key={group.key} className="mi-divergence__withheld-item" data-reason={group.reason}>
                {withheldLine(text, group, when)}
                {group.count > 1 ? text.withheldGroup.replace('{count}', String(group.count)) : ''}
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </section>
  )
}

/**
 * The sentence for one refused pair.
 *
 * A sentiment leg that answered "nothing took a side" is a fact about the day, so it keeps its own
 * line instead of the generic "we did not get it" — the reader must be able to tell a quiet day
 * from a failed read.
 */
function withheldLine(text: DivergencePanelText, group: ReturnType<typeof groupWithheld>[number], when: (value: string) => string): string {
  if (group.reason === 'leg-missing' && group.leg === 'sentiment') return text.sentimentNoScoredItems.replace('{leg}', text.legs[group.leg])
  return text.withheldReasons[group.reason].replace('{leg}', text.legs[group.leg]).replace('{at}', group.observedAt ? when(group.observedAt) : text.missingValue)
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

/**
 * Which platform error code this failure belongs to.
 *
 * "Nothing arrived from any source" and "the answer was too large" are the read failing from the
 * outside; a rejected payload or an unreadable clock is the read failing inside. Both are retried
 * the same way, so the split is about the sentence the reader gets, not about the next step.
 */
/** The one line a reader gets on the row: what invalidates this reading. */
const invalidationLine = (pairId: string, text: DivergencePanelText): string =>
  `${text.invalidationLabel}${text.labelSep}${text.pairs[pairId as keyof DivergencePanelText['pairs']].invalidation}`

function unavailableReasonCode(reason: 'all-legs-missing' | 'query-failed' | 'invalid-clock' | 'too-large' | 'bad-payload' | 'bad-answer'): 'unreadable' | 'unavailable' {
  return reason === 'all-legs-missing' || reason === 'too-large' ? 'unavailable' : 'unreadable'
}
