import { useEffect, useRef, useState } from 'react'

import { Button } from 'antd'
import { Info, RefreshCw } from 'lucide-react'

import { etfFlowPolicy } from '../../../../contracts/etfFlows'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import { LoadingState } from '@platform/ui/components/loading'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { CapitalFlowChart } from './CapitalFlowChart'
import { CapitalFlowDailyTable } from './CapitalFlowDailyTable'
import { CapitalFlowDialog } from './CapitalFlowDialog'
import { CapitalFlowLegend } from './CapitalFlowLegend'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { useSignalDetail } from '../shared'
import { useSignalAnalysisSentence } from '../shared/useSignalAnalysisSentence'
import type { DashboardCapitalConditionsState, DashboardEtfFlowAsset } from './capitalConditionsModel'
import { ETF_SIGNAL_DETAIL_ID, EtfOutflowChip, EtfOutflowSignalDetail, type EtfSignalText } from './EtfOutflowSignal'

type Text = {
  title: string
  loading: string
  /** The card's own empty sentence, rendered through the platform reason slot (contract §17). */
  empty: string
  stablecoin: string
  stablecoinScope: string
  asset: string
  totalSupply: string
  change1d: string
  change7d: string
  change30d: string
  latest: string
  windowDays: string
  coverage: string
  streakColumn: string
  streak: string
  streakSingle: string
  observedAt: string
  etfFlow: string
  chartWindow: string
  infoAria: string
  chartScopeNoteMain: string
  chartScopeNoteEtf: string
  columnScopeNote: string
  dailyUnits: string
  dailyFundsShort: string
  fundsColumn: string
  fundsScope: string
  btc: string
  eth: string
  etfScope: string
  /** One template: both notes quote `stablecoin` through `{row}`, so they cannot drift apart. */
  notComparable: string
  expandDaily: string
  dailyCaption: string
  dateColumn: string
  flowNotEnoughDays: string
  flowNoDays: string
  a11yNoFlow: string
  a11yLabel: string
  a11yCell: string
  flowDirections: Record<'inflow' | 'outflow' | 'zero', string>
  shortFlowDirections: Record<'inflow' | 'outflow' | 'zero', string>
  refresh: string
  refreshFailed: string
  /** The last readings that did read, kept after a failed re-read. */
  staleRead: string
} & ({ a11yAmountYi: string; a11yAmountWan: string } | { a11yAmountMillion: string }) & EtfSignalText

type AvailableState = Extract<DashboardCapitalConditionsState, { state: 'available' }>

export function CapitalConditionsPanel({ state, text, onRefresh, refreshing = false, refreshFailed = false }: Readonly<{
  state: DashboardCapitalConditionsState
  text: Text
  /** Re-collect when the host can, otherwise re-read the stored snapshot. Always a real action. */
  onRefresh: () => void
  refreshing?: boolean
  refreshFailed?: boolean
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  // 牌子的开合、`aria-expanded` / `aria-controls` 与区域语义都来自共用的 `useSignalDetail`：
  // 四块牌子同一条规矩，抄四份必然有一份漏。读数的落点在标题行下，卡片与日流表不被盖住。
  const signalDetail = useSignalDetail(ETF_SIGNAL_DETAIL_ID)
  // 状态与信号并列：牌子上是「有没有这条信号」，这一句回答「这次分析到哪一步」。
  const analysisSentence = useSignalAnalysisSentence(state.state === 'available' ? state.etfSignalAnalysis : undefined)
  // 牌子从「有事」变回「不齐/没有」时收起它：读者没点过展开，就不能在下一次命中时自己弹开。
  // 共用件只给 `toggle`，所以这里只在自己持有「上一版是不是有事」时补一次收起。
  const alertChip = state.state === 'available' && state.etfSignal?.state === 'alert' ? state.etfSignal : undefined
  const wasAlert = useRef(false)
  useEffect(() => {
    if (wasAlert.current && !alertChip && signalDetail.open) signalDetail.toggle()
    wasAlert.current = Boolean(alertChip)
  }, [alertChip, signalDetail])
  if (state.state !== 'available') return <section className="mi-capital-conditions" data-state={state.state} aria-label={text.title}>
    <div className="mi-capital-conditions__summary">
      <h2>{text.title}</h2>
      {state.state === 'loading'
        ? <LoadingState label={text.loading} minHeight={140} />
        : state.state === 'empty'
          ? <StateView state="empty" reasonCode="not-yet"
              productReason={{ key: 'pages.intelligence.portal.dashboard.capitalConditions.empty', resolve: () => text.empty }} />
          : <StateView state="error" reasonCode="unavailable" action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRefresh }} />}
      {/* The state above is what the last read returned. Re-reading it changes nothing, so the
          only useful action here is to ask the sources to be collected again. */}
      {onRefresh ? <Button className="mi-capital-conditions__refresh" disabled={refreshing || state.state === 'loading'}
        icon={<RefreshCw aria-hidden="true" size={13} />} loading={refreshing} onClick={onRefresh} size="small" type="link">{text.refresh}</Button> : null}
      {refreshFailed ? <p className="mi-capital-conditions__refresh-error" role="alert">{text.refreshFailed}</p> : null}
    </div>
  </section>

  return <section className="mi-capital-conditions" data-state={state.state} aria-label={text.title}>
    <div className="mi-capital-conditions__content-row">
      <div className="mi-capital-conditions__summary">
        <div className="mi-capital-conditions__header-band">
          <h2>{text.title}</h2>
          {/* The module rule's chip sits beside the title, at most one per card. It is drawn only
              when the rule had something to say; a quiet card renders no element at all. */}
          {state.etfSignal && state.etfSignal.state !== 'hidden'
            ? <EtfOutflowChip chip={state.etfSignal} text={text} onRetry={onRefresh}
                triggerProps={signalDetail.triggerProps} onToggle={signalDetail.toggle} />
            : null}
          <small className="mi-capital-conditions__observed-at">{`${text.observedAt} ${formatTime(state.observedAt)}`}</small>
        </div>
        {signalDetail.open && state.etfSignal
          ? <EtfOutflowSignalDetail chip={state.etfSignal} text={text} analysis={analysisSentence}
              verifiedAt={state.etf === 'unavailable' ? undefined : state.etf.verifiedAt} />
          : null}
        {/* These are the last numbers that read successfully. Saying so is the difference between
            "old" and "gone", and only one of those is true after a failed re-read. */}
        {state.stale ? <p className="mi-capital-conditions__stale" role="status">{text.staleRead}</p> : null}
        <StablecoinTable state={state} text={text} />
        <EtfTable etf={state.etf} text={text} onRetry={onRefresh} />
      </div>
      <EtfFlow etf={state.etf} flowHistory={state.flowHistory} text={text} onRetry={onRefresh} />
    </div>
  </section>
}

/** Stock and flow share one compact table language: supply plus its 1D / 7D / 30D changes. */
function StablecoinTable({ state, text }: { state: AvailableState; text: Text }): React.ReactElement {
  return <table className="mi-capital-conditions__etf-table mi-capital-conditions__stable-table">
    <colgroup>
      <col className="mi-capital-conditions__etf-col-asset" />
      <col span={3} />
      <col className="mi-capital-conditions__etf-col-supply" />
    </colgroup>
    <thead><tr>
      <th scope="col">{text.asset}</th>
      <th scope="col">{text.change1d}<span className="mi-capital-conditions__pct" data-flow-direction={flowDirection(state.change1dUsd)}>({state.change1dPercent})</span></th>
      <th scope="col">{text.change7d}<span className="mi-capital-conditions__pct" data-flow-direction={flowDirection(state.change7dUsd)}>({state.change7dPercent})</span></th>
      <th scope="col">{text.change30d}<span className="mi-capital-conditions__pct" data-flow-direction={flowDirection(state.change30dUsd)}>({state.change30dPercent})</span></th>
      <th scope="col">{text.totalSupply}</th>
    </tr></thead>
    <tbody><tr>
      <th scope="row">
        <span className="mi-capital-conditions__asset-name">{text.stablecoin}</span>
        <span className="mi-capital-conditions__asset-scope">{text.stablecoinScope}</span>
      </th>
      <td data-flow-direction={flowDirection(state.change1dUsd)}>{state.change1dUsd}</td>
      <td data-flow-direction={flowDirection(state.change7dUsd)}>{state.change7dUsd}</td>
      <td data-flow-direction={flowDirection(state.change30dUsd)}>{state.change30dUsd}</td>
      <td className="mi-capital-conditions__stable-supply">{state.currentUsd}</td>
    </tr></tbody>
  </table>
}


/** One row per asset, one column per horizon: no label repeats inside the body. */
function EtfTable({ etf, text, onRetry }: { etf: AvailableState['etf']; text: Text; onRetry: () => void }): React.ReactElement {
  const coverage = etf === 'unavailable' ? undefined : etf.coverage
  return <table className="mi-capital-conditions__etf-table">
    <colgroup>
      <col className="mi-capital-conditions__etf-col-asset" />
      <col span={3} />
      <col className="mi-capital-conditions__etf-col-streak" />
    </colgroup>
    <thead><tr>
      <th scope="col">{text.asset}</th>
      <th scope="col">{text.latest}</th>
      {etfFlowPolicy.cumulativeWindows.map((days) => {
        const windowCoverage = coverage?.find((candidate) => candidate.windowDays === days)
        return <th scope="col" key={days}>
          {format(text.windowDays, { days })}
          {windowCoverage && !windowCoverage.complete
            ? <> <span className="mi-capital-conditions__coverage">{format(text.coverage, { days: windowCoverage.coveredDays })}</span></>
            : null}
        </th>
      })}
      <th scope="col">{text.streakColumn}</th>
    </tr></thead>
    <tbody>
      {etf === 'unavailable'
        ? <tr><td className="mi-capital-conditions__etf-unavailable" colSpan={5}><StateView state="error" reasonCode="unavailable" action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetry }} /></td></tr>
        : <><EtfRow asset={etf.btc} label={text.btc} text={text} /><EtfRow asset={etf.eth} label={text.eth} text={text} /></>}
    </tbody>
  </table>
}

function EtfRow({ asset, label, text }: { asset: DashboardEtfFlowAsset; label: string; text: Text }): React.ReactElement {
  const latest = asset.rows.at(-1)
  const days = latest ? consecutiveDirectionDays(asset.rows, latest.direction) : 0
  const streak = latest && days > 0
    ? format(days === 1 ? text.streakSingle : text.streak, { flow: text.shortFlowDirections[latest.direction], count: days })
    : ''
  return <tr>
    <th scope="row"><i className="mi-capital-conditions__asset-dot" data-series={asset.asset.toLowerCase()} aria-hidden="true" />{label}</th>
    <td data-flow-direction={flowDirection(asset.latestNetFlowUsd)}>{asset.latestNetFlowUsd}</td>
    {asset.cumulative.map((window) => <td key={window.windowDays} data-flow-direction={flowDirection(window.netFlowUsd)}>{window.netFlowUsd}</td>)}
    <td className="mi-capital-conditions__streak" data-flow-direction={latest?.direction}>{streak}</td>
  </tr>
}

function consecutiveDirectionDays(rows: readonly { direction: 'inflow' | 'outflow' | 'zero' }[], direction: 'inflow' | 'outflow' | 'zero'): number {
  let days = 0
  for (let index = rows.length - 1; index >= 0 && rows[index]?.direction === direction; index -= 1) days += 1
  return days
}

/**
 * The chart, the info bubble and the daily table. All of them read the same
 * `flowHistory.rows` handed down by the projection — the seven-day window is cut once, in the
 * model — and the table's trigger sits in the title row while its panel hangs off this section's
 * bottom edge, so opening it moves nothing in the card.
 */
function EtfFlow({ etf, flowHistory, text, onRetry }: {
  etf: AvailableState['etf']
  flowHistory?: AvailableState['flowHistory']
  text: Text
  onRetry: () => void
}): React.ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false)
  const resolveText = useProductTextKey()
  // "The sources did not answer" stays an error with a retry; "they answered with too few days"
  // is a not-yet with the count, so the two never share a sentence.
  if (etf === 'unavailable' || !flowHistory) {
    return <section className="mi-capital-conditions__etf-flow" data-etf-flow="unavailable"><h3>{text.etfFlow}</h3>
      <StateView state="error" reasonCode="unavailable" action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetry }} />
    </section>
  }
  if (flowHistory.state === 'not-yet') {
    return <section className="mi-capital-conditions__etf-flow" data-etf-flow="not-yet"><h3>{text.etfFlow}</h3>
      <p className="mi-capital-conditions__daily-not-yet">
        {flowHistory.availableDays === 0 ? text.flowNoDays : format(text.flowNotEnoughDays, { days: flowHistory.availableDays })}
      </p>
    </section>
  }
  const rows = flowHistory.rows
  const key = (name: string): string => `pages.intelligence.portal.dashboard.capitalConditions.${name}`
  return <section className="mi-capital-conditions__etf-flow" data-etf-flow="available">
    <header>
      <h3>{text.etfFlow}</h3>
      {/* Everything the numbers cannot carry themselves lives here: what the series are, which row
          they must not be reconciled with, and what each column covers. */}
      <Popover
        lines={[
          { labelKey: key('chartScopeNoteMain') },
          { labelKey: key('chartScopeNoteEtf') },
          { labelKey: key('notComparable'), params: { row: `${text.stablecoin}${text.stablecoinScope}` } },
          { labelKey: key('columnScopeNote') }
        ]}
        resolveText={resolveText}
        trigger={(triggerProps) => <IconButton {...triggerProps} ariaLabelKey={key('infoAria')}
          icon={Info} size="sm" resolveText={resolveText} variant="plain" />} />
      <span className="mi-capital-conditions__chart-window">{text.chartWindow}</span>
      <button type="button" className="mi-capital-conditions__daily-button"
        aria-haspopup="dialog" onClick={() => setDialogOpen(true)}>{text.expandDaily}</button>
    </header>
    <CapitalFlowLegend text={text} />
    <CapitalFlowChart rows={rows} text={text} />
    <CapitalFlowDialog open={dialogOpen} onClose={() => setDialogOpen(false)} rows={rows} text={text} resolveText={resolveText} />
  </section>
}

function flowDirection(value: string): 'inflow' | 'outflow' | 'zero' {
  return value.startsWith('+') ? 'inflow' : value.startsWith('-') ? 'outflow' : 'zero'
}

function format(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => String(values[key] ?? ''))
}
