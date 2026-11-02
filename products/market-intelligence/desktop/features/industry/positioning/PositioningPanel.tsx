import { useRef, useState } from 'react'

import { Segmented } from '@platform/ui/components/segmented'

import { LoadingState } from '@platform/ui/components/loading'
import { Tooltip } from '@platform/ui/components/tooltip'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { OpenInterestWindow } from '../../../../contracts/openInterestHistory'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { PositioningState } from '../../../../contracts/openInterestPositioning'
import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import {
  dashboardPositioningPresentationPolicy,
  formatDashboardChange,
  formatDashboardNotional,
  positioningStateFor,
  type DashboardPositioningPoint,
  type DashboardPositioningViewState
} from '../../../pages/intelligence/dashboardOpenInterestModel'

import { PositioningChart, formatRate } from './PositioningChart'
import type { PositioningPanelText } from './positioningText'

import './PositioningPanel.css'

/**
 * The four one-look bullets that lead the readings region, one literal key per line.
 *
 * Literal on purpose: the guards check that a key exists and is spelled as a dotted path, which a
 * template string hides from them. A table also makes it obvious that the bullets and the text
 * table have the same number of lines.
 *
 * Four because they are a glance: a fifth bullet, or a paragraph where a bullet belongs, means the
 * sentence is a reading note and belongs in `positioningHelpDetailKeys` instead.
 */
export const positioningHelpBulletKeys = Object.freeze([
  'pages.intelligence.portal.dashboard.positioning.helpBullets.0',
  'pages.intelligence.portal.dashboard.positioning.helpBullets.1',
  'pages.intelligence.portal.dashboard.positioning.helpBullets.2',
  'pages.intelligence.portal.dashboard.positioning.helpBullets.3'
] as const)

/**
 * The readings behind the numbers: thresholds, window folding, what a mark does not cover.
 *
 * These live in a region under the card that the reader opens on purpose. A bubble that covered
 * half the chart was the same prose in the wrong home.
 */
export const positioningHelpDetailKeys = Object.freeze([
  'pages.intelligence.portal.dashboard.positioning.helpDetails.0',
  'pages.intelligence.portal.dashboard.positioning.helpDetails.1',
  'pages.intelligence.portal.dashboard.positioning.helpDetails.2',
  'pages.intelligence.portal.dashboard.positioning.helpDetails.3'
] as const)

/**
 * The six state labels, one literal key each.
 *
 * Literal for the same reason as the help bullets: a template string hides the key from the guard,
 * and the guard is the only thing that can tell a live key from a typo.
 */
export const positioningStateLabelKeys: Readonly<Record<PositioningState, string>> = Object.freeze({
  deleveraging: 'pages.intelligence.portal.dashboard.positioning.states.deleveraging',
  'short-crowded': 'pages.intelligence.portal.dashboard.positioning.states.short-crowded',
  'long-crowded': 'pages.intelligence.portal.dashboard.positioning.states.long-crowded',
  refilling: 'pages.intelligence.portal.dashboard.positioning.states.refilling',
  neutral: 'pages.intelligence.portal.dashboard.positioning.states.neutral',
  mixed: 'pages.intelligence.portal.dashboard.positioning.states.mixed'
})

type Rate = Readonly<{ observedAt: string; ratePercent: number; paymentDirection: 'long-pays-short' | 'short-pays-long' | 'neutral' }>



export type PositioningPanelProps = Readonly<{
  funding: DashboardFundingRateHistoryState
  positioning: DashboardPositioningViewState
  window: OpenInterestWindow
  onWindowChange: (window: OpenInterestWindow) => void
  text: PositioningPanelText
}>

// A strip above the plot belongs to the liquidation marks: a label drawn over the curves hid the
// very movement it was pointing at.
// The viewBox is drawn at roughly the width the card is, so the svg scales ~1:1: text keeps its
// nominal size and the drawing is 186 units tall instead of being blown up with the container.
export function PositioningPanel({ funding, positioning, window, onWindowChange, text }: PositioningPanelProps): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const resolveProductKey = useProductTextKey()
  // Opening the numbers spends nothing: no analysis call, no budget, no request. The paid action
  // is one level deeper and is not this button.
  const [detailsOpen, setDetailsOpen] = useState(false)
  // The long readings sit behind their own entry: closed by default, so the card stays a card.
  const [helpOpen, setHelpOpen] = useState(false)
  // The chip the module's rule produced, if any. A hidden chip renders nothing at all — no empty
  // container, no grey "normal": an always-present badge becomes background noise within a fortnight.
  const signal = positioning.state === 'available' ? positioning.signal : undefined
  const chip = signal && signal.state !== 'hidden' ? signal : undefined
  const header = (extra?: React.ReactNode) => (
    <header className="mi-positioning-panel__head">
      <h2>{text.pairTitle}</h2>
      {chip ? (chip.state === 'alert' ? (
        <button type="button" className="mi-positioning-panel__signal" data-state="alert"
          aria-expanded={detailsOpen} aria-controls="mi-positioning-signal-detail"
          aria-label={`${text.liquidationChip
            .replace('{asset}', text.assets[chip.asset])
            .replace('{pct}', formatDashboardChange(chip.dropPct))
            .replace('{multiple}', chip.volumeMultiple.toFixed(1))} · ${text.signalDetailsOpen}`}
          onClick={() => setDetailsOpen(open => !open)}>
          {text.liquidationChip
            .replace('{asset}', text.assets[chip.asset])
            .replace('{pct}', formatDashboardChange(chip.dropPct))
            .replace('{multiple}', chip.volumeMultiple.toFixed(1))}
        </button>
      ) : (
        // "Insufficient data" is a statement, not a control: there is nothing behind it to open.
        <StatusPill tone="warn" labelKey="pages.intelligence.portal.dashboard.positioning.signalInsufficient" resolveText={resolveProductKey} />
      )) : null}
      {/*
        One entry, not two: the bullets lead the same readings the long notes sit in, so the reader
        opens one place. The second trigger this card used to carry (an icon button over the four
        bullets) made the reader choose between two explanations of one card.
      */}
      <button type="button" className="mi-positioning-panel__help-toggle"
        aria-expanded={helpOpen} aria-controls="mi-positioning-help-details"
        onClick={() => setHelpOpen(open => !open)}>
        {text.helpDetailsLabel}
      </button>
      {extra}
      <WindowTabs window={window} onWindowChange={onWindowChange} text={text} />
    </header>
  )

  const btcRate = funding.state === 'available' ? funding.btc : []
  const ethRate = funding.state === 'available' ? funding.eth : []
  const available = positioning.state === 'available'
  const latest = available ? positioning.btc.at(-1)?.observedAt ?? positioning.eth.at(-1)?.observedAt : undefined
  // Two different facts, two different states: nothing collected yet is empty, a failed read is an
  // error. The platform owns both sentences and the shape; the card only says which happened.
  const status = (positioning.state === 'loading' || funding.state === 'loading')
    ? <LoadingState label={text.loading} minHeight={140} />
    : positioning.state === 'empty'
      ? <StateView state="empty" reasonCode="not-yet" size="md" />
      : <StateView state="error" reasonCode="unavailable" size="md"
          action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: positioning.onReload }} />

  return (
    <section className="mi-positioning-panel" data-state={positioning.state} data-funding-state={funding.state} data-window={window}
      data-stale={available && positioning.staleSince ? 'true' : undefined}>
      {header(
        <>
          {latest
            ? <small className="mi-positioning-panel__asof">{text.observedAt} {formatTime(latest)}{available && positioning.staleSince ? text.staleSuffix.replace('{stale}', text.stale) : ''}</small>
            : null}
        </>
      )}
      {helpOpen ? (
        <div id="mi-positioning-help-details" className="mi-positioning-panel__help-details"
          role="region" aria-label={text.helpDetailsLabel}>
          {positioningHelpBulletKeys.map(labelKey => (
            <p key={labelKey}>{resolveProductKey(labelKey)}</p>
          ))}
          {positioningHelpDetailKeys.map(labelKey => (
            <p key={labelKey}>{resolveProductKey(labelKey)}</p>
          ))}
        </div>
      ) : null}
      {chip?.state === 'alert' && detailsOpen ? (
        <dl id="mi-positioning-signal-detail" className="mi-positioning-panel__signal-detail" role="region" aria-label={text.signalDetailsTitle}>
          <div><dt>{text.signalDetailsRule}</dt><dd>{chip.ruleId}</dd></div>
          <div><dt>{text.signalDetailsWindow}</dt><dd>{text.window15m}</dd></div>
          <div><dt>{text.signalDetailsDrop}</dt><dd>{formatDashboardChange(chip.dropPct)}</dd></div>
          <div><dt>{text.signalDetailsVolume}</dt><dd>{chip.volumeMultiple.toFixed(1)}×</dd></div>
          <div><dt>{text.signalDetailsObservedAt}</dt><dd>{formatTime(chip.observedAt)}</dd></div>
          <p>{text.signalDetailsNote}</p>
        </dl>
      ) : null}
      <div className="mi-positioning-panel__body">
        <div className="mi-positioning-panel__summary">
          <Asset asset="btc" text={text} rate={btcRate.at(-1)} rateAgo={btcRate.at(-4)} change={available ? positioning.changeBtc : undefined}
            notional={available ? positioning.btc.at(-1) : undefined} state={available ? positioningStateFor(positioning, btcRate, positioning.changeBtc) : undefined} />
          <Asset asset="eth" text={text} rate={ethRate.at(-1)} rateAgo={ethRate.at(-4)} change={available ? positioning.changeEth : undefined}
            notional={available ? positioning.eth.at(-1) : undefined} state={available ? positioningStateFor(positioning, ethRate, positioning.changeEth) : undefined} />
        </div>
        <div className="mi-positioning-panel__chart-wrap">
          {available
            ? <>
                <PositioningChart positioning={positioning} funding={funding} text={text} />
              </>
            : status}
        </div>
      </div>
    </section>
  )
}

/**
 * The six states are a reading, not a verdict on severity: a market that is deleveraging or
 * crowded needs a look, refilling is ordinary, and "neutral" or "mixed" is simply information.
 * Tones are the closed set; the word stays on the row either way.
 */
function statePillTone(state: PositioningState): StatusPillTone {
  if (state === 'refilling') return 'ok'
  if (state === 'neutral' || state === 'mixed') return 'info'
  return 'warn'
}

function WindowTabs({ window, onWindowChange, text }: Readonly<{ window: OpenInterestWindow; onWindowChange: (window: OpenInterestWindow) => void; text: PositioningPanelText }>): React.ReactElement {
  // One Tab reaches the group; the arrow keys move focus and Enter/Space picks. Both options and
  // the group's own name are keys, so the sentences never live in this file.
  const resolveText = useProductTextKey()
  return (
    <div className="mi-positioning-panel__tabs">
      <Segmented
        value={window}
        items={[
          { value: '7d', labelKey: 'pages.intelligence.portal.dashboard.positioning.window7d' },
          { value: '24h', labelKey: 'pages.intelligence.portal.dashboard.positioning.window24h' }
        ]}
        ariaLabelKey="pages.intelligence.portal.dashboard.positioning.windowGroup"
        resolveText={resolveText}
        onChange={value => onWindowChange(value as OpenInterestWindow)} />
    </div>
  )
}

/**
 * One asset as a small reading card: who it is and what state it is in, what the rate costs,
 * how big the position is, and how it moved over the two windows the analysis uses.
 *
 * The colour at the left edge is the asset's line colour in the chart, which is what ties a
 * column of numbers to a curve three hundred pixels to its right. The state sits beside the
 * name rather than under the numbers: it answers "what am I looking at" before the reader has
 * read a single figure.
 */
function Asset({ asset, text, rate, rateAgo, change, notional, state }: Readonly<{
  asset: 'btc' | 'eth'
  text: PositioningPanelText
  rate?: Rate
  rateAgo?: Rate
  change?: Readonly<{ h1Pct?: number; h24Pct?: number }>
  notional?: DashboardPositioningPoint
  state: PositioningState | undefined
}>): React.ReactElement {
  const resolveProductKey = useProductTextKey()
  return (
    <div className="mi-positioning-panel__asset" data-asset={asset} data-funding-latest={asset}>
      <div className="mi-positioning-panel__asset-head">
        <span className="mi-positioning-panel__name">{text.assets[asset]}</span>
        {state ? (
          // One line: the numbers the conclusion was drawn from, so it can be checked rather than
          // trusted. A single sentence stays on the tooltip; the paragraph lives in the help above.
          <Tooltip
            labelKey="pages.intelligence.portal.dashboard.positioning.stateWhy"
            labelParams={{
              change: formatDashboardChange(change?.h24Pct),
              now: rate ? formatRate(rate.ratePercent) : text.missingValue,
              ago: rateAgo ? formatRate(rateAgo.ratePercent) : text.missingValue
            }}
            resolveText={resolveProductKey}>
            <span className="mi-positioning-panel__state" data-state={state} tabIndex={0}>
              <StatusPill tone={statePillTone(state)} labelKey={positioningStateLabelKeys[state]} resolveText={resolveProductKey} />
            </span>
          </Tooltip>
        ) : null}
      </div>
      <div className="mi-positioning-panel__quote">
        {rate
          ? <>
              <span className="mi-positioning-panel__rate" data-direction={rate.paymentDirection}>{formatRate(rate.ratePercent)}</span>
              <span className="mi-positioning-panel__pay">{text.paymentDirections[rate.paymentDirection]}</span>
            </>
          : <span className="mi-positioning-panel__rate">{text.missingValue}</span>}
      </div>
      <div className="mi-positioning-panel__row" data-layout="level">
        <span className="mi-positioning-panel__label">{text.notional}</span>
        <b className="mi-positioning-panel__value">{notional ? formatDashboardNotional(notional.notionalUsd) : text.missingValue}</b>
      </div>
      <div className="mi-positioning-panel__row" data-layout="pair">
        <span className="mi-positioning-panel__pair">
          <i className="mi-positioning-panel__label">{text.change1h}</i>
          <b className="mi-positioning-panel__value">{formatDashboardChange(change?.h1Pct)}</b>
        </span>
        <span className="mi-positioning-panel__pair">
          <i className="mi-positioning-panel__label">{text.change24h}</i>
          <b className="mi-positioning-panel__value">{formatDashboardChange(change?.h24Pct)}</b>
        </span>
      </div>
    </div>
  )
}
