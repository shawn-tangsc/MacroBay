import { useRef, useState } from 'react'

import { LoadingState } from '@platform/ui/components/loading'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { OpenInterestWindow } from '../../../../contracts/openInterestHistory'
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
  const header = (extra?: React.ReactNode) => (
    <header className="mi-positioning-panel__head">
      <h2>{text.pairTitle}</h2>
      <span className="mi-positioning-panel__help" tabIndex={0} role="note" aria-label={text.helpLabel} data-help>
        <i aria-hidden="true">?</i>
        <span className="mi-positioning-panel__help-pop" role="tooltip">
          {text.helpLines.map(line => <b key={line}>{line}</b>)}
        </span>
      </span>
      {extra}
      <WindowTabs window={window} onWindowChange={onWindowChange} text={text} />
    </header>
  )

  const btcRate = funding.state === 'available' ? funding.btc : []
  const ethRate = funding.state === 'available' ? funding.eth : []
  const available = positioning.state === 'available'
  const latest = available ? positioning.btc.at(-1)?.observedAt ?? positioning.eth.at(-1)?.observedAt : undefined
  const status = (positioning.state === 'loading' || funding.state === 'loading')
    ? <LoadingState label={text.loading} minHeight={140} />
    : <p className="mi-positioning-panel__status">{positioning.state === 'empty' ? text.empty : text.unavailable}</p>

  return (
    <section className="mi-positioning-panel" data-state={positioning.state} data-funding-state={funding.state} data-window={window}
      data-stale={available && positioning.staleSince ? 'true' : undefined}>
      {header(
        <>
          {latest
            ? <small className="mi-positioning-panel__asof">{text.observedAt} {formatTime(latest)}{available && positioning.staleSince ? ` · ${text.stale}` : ''}</small>
            : null}
        </>
      )}
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
                {positioning.hintsState === 'available' && !positioning.hintsTruncated ? null : (
                  <p className="mi-positioning-panel__foot" data-hints-state={positioning.hintsState}>
                    {positioning.hintsState === 'unavailable' ? text.liquidationUnavailable : text.liquidationMore}
                  </p>
                )}
              </>
            : status}
        </div>
      </div>
    </section>
  )
}

function WindowTabs({ window, onWindowChange, text }: Readonly<{ window: OpenInterestWindow; onWindowChange: (window: OpenInterestWindow) => void; text: PositioningPanelText }>): React.ReactElement {
  return (
    <span className="mi-positioning-panel__tabs">
      {(['7d', '24h'] as const).map(option => (
        <button key={option} type="button" aria-pressed={window === option} data-window={option}
          onClick={() => onWindowChange(option)}>{option === '7d' ? text.window7d : text.window24h}</button>
      ))}
    </span>
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
  return (
    <div className="mi-positioning-panel__asset" data-asset={asset} data-funding-latest={asset}>
      <div className="mi-positioning-panel__asset-head">
        <span className="mi-positioning-panel__name">{text.assets[asset]}</span>
        {state ? (
          // The label alone is a conclusion. Hovering it shows the two numbers the conclusion was
          // drawn from, which is what makes it checkable rather than another opaque badge.
          <span className="mi-positioning-panel__state" data-state={state} tabIndex={0}>
            {text.states[state]}
            <span className="mi-positioning-panel__state-tip" role="tooltip">
              {text.stateWhy
                .replace('{change}', formatDashboardChange(change?.h24Pct))
                .replace('{now}', rate ? formatRate(rate.ratePercent) : '—')
                .replace('{ago}', rateAgo ? formatRate(rateAgo.ratePercent) : '—')}
            </span>
          </span>
        ) : null}
      </div>
      <div className="mi-positioning-panel__quote">
        {rate
          ? <>
              <span className="mi-positioning-panel__rate" data-direction={rate.paymentDirection}>{formatRate(rate.ratePercent)}</span>
              <span className="mi-positioning-panel__pay">{text.paymentDirections[rate.paymentDirection]}</span>
            </>
          : <span className="mi-positioning-panel__rate">—</span>}
      </div>
      <div className="mi-positioning-panel__row" data-layout="level">
        <span className="mi-positioning-panel__label">{text.notional}</span>
        <b className="mi-positioning-panel__value">{notional ? formatDashboardNotional(notional.notionalUsd) : '—'}</b>
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
