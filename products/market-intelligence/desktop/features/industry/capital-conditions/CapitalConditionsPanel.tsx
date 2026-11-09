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
import { useSignalAnalysisSentence } from '../shared/useSignalAnalysisSentence'
import {
  isCapitalConditionsRetryable,
  type DashboardCapitalConditionsState,
  type DashboardEtfFlowAsset,
  type DashboardEtfMissingReason,
  type DashboardEtfReading
} from './capitalConditionsModel'
import { EtfOutflowChip, EtfSignalDetailDialog, type EtfSignalText } from './EtfOutflowSignal'

type Text = {
  title: string
  loading: string
  /** The card's own empty sentence, rendered through the platform reason slot (contract §17). */
  empty: string
  /** 形状/版本不符时读者唯一能做的动作（完全退出后重开）；这一种不给重试按钮。 */
  contractMismatch: string
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
  /** 某支读不到时：中文「未知」+ 三条原因各一句人话（原因闭集在模型里）。 */
  etfUnknown: string
  etfMissingSourceUnreadable: string
  etfMissingAssetMissing: string
  etfMissingValueMissing: string
  /** 对比列单独说：两支窗口不等长不可比；只有 `laggingDays` 存在时才念落后几天。 */
  etfComparisonUnaligned: string
  etfComparisonLagging: string
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
  // 状态与信号并列：牌子上是「有没有这条信号」，这一句回答「这次分析到哪一步」。
  const analysisSentence = useSignalAnalysisSentence(state.state === 'available' ? state.etfSignalAnalysis : undefined)
  const alertChip = state.state === 'available' && state.etfSignal?.state === 'alert' ? state.etfSignal : undefined
  // 解释走「点开可关」的弹层；入口就是牌子本身，关掉焦点要回到它，读者不能掉回页面顶部。
  const [detailOpen, setDetailOpen] = useState(false)
  const chipTrigger = useRef<HTMLButtonElement>(null)
  const closeDetail = (): void => {
    setDetailOpen(false)
    chipTrigger.current?.focus()
  }
  // 命中消失时把弹层一起关掉：故事已经不成立，留着一段讲它的文字就是旧真相。
  useEffect(() => { if (!alertChip) setDetailOpen(false) }, [alertChip])
  if (state.state !== 'available') return <section className="mi-capital-conditions" data-state={state.state} aria-label={text.title}>
    <div className="mi-capital-conditions__summary">
      <h2>{text.title}</h2>
      {state.state === 'loading'
        ? <LoadingState label={text.loading} minHeight={140} />
        : state.state === 'empty'
          ? <StateView state="empty" reasonCode="not-yet"
              productReason={{ key: 'pages.intelligence.portal.dashboard.capitalConditions.empty', resolve: () => text.empty }} />
          : state.reason === 'contract-mismatch'
            // 版本/形状不符：重试读的是同一份契约，多少次都一样；唯一出口是重启应用。
            // `needs-restart` 这个名字就是为它准备的，动作走平台那条窗口通道（`app.relaunch()`）。
            ? <StateView state="error" reasonCode="needs-restart"
                productReason={{ key: 'pages.intelligence.portal.dashboard.capitalConditions.contractMismatch', resolve: () => text.contractMismatch }}
                action={{ labelKey: STATE_VIEW_ACTION_KEYS.restart_app, onSelect: () => { void window.platform.app.relaunch() } }} />
            : isCapitalConditionsRetryable(state.reason)
              // 「读了但没读成」才给重试。
              ? <StateView state="error" reasonCode="unavailable" action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRefresh }} />
              // 其余（时钟不合法、客户端没接上、数字无法显示）都是接线或数据问题：读者能做的是再读一次，
              // 所以给的是 refresh 而不是一个必然失败的 retry。
              : <StateView state="error" reasonCode="unavailable" action={{ labelKey: STATE_VIEW_ACTION_KEYS.refresh, onSelect: onRefresh }} />}
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
                onToggle={() => setDetailOpen(true)} triggerRef={chipTrigger} />
            : null}
          <small className="mi-capital-conditions__observed-at">{`${text.observedAt} ${formatTime(state.observedAt)}`}</small>
        </div>
        <EtfSignalDetailDialog
          analysis={analysisSentence}
          chip={state.etfSignal ?? { state: 'hidden' }}
          onClose={closeDetail}
          open={detailOpen}
          text={text}
          verifiedAt={state.etfReading?.state === 'unreadable' ? undefined : state.etfReading?.verifiedAt} />
        {/* These are the last numbers that read successfully. Saying so is the difference between
            "old" and "gone", and only one of those is true after a failed re-read. */}
        {state.stale ? <p className="mi-capital-conditions__stale" role="status">{text.staleRead}</p> : null}
        <StablecoinTable state={state} text={text} />
        <EtfTable reading={state.etfReading} text={text} onRetry={onRefresh} />
      </div>
      <EtfFlow reading={state.etfReading} flowHistory={state.flowHistory} text={text} onRetry={onRefresh} />
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
/**
 * ETF 两行：**每一支各说各的**。一支有值就照常显示数字（0 就是 0，不许拿另一支补），
 * 另一支显示「未知」+ 具体原因；两支都读不到才整块换成错误态。
 * 窗口不等长只让**对比列**不可比，不把两份数字一起撤掉（「ETH 晚一天整份作废」就是这么来的）。
 */
function EtfTable({ reading, text, onRetry }: { reading?: DashboardEtfReading; text: Text; onRetry: () => void }): React.ReactElement {
  const unreadable = reading === undefined || reading.state === 'unreadable'
  const coverage = unreadable ? undefined : reading.coverage
  const span = 2 + etfFlowPolicy.cumulativeWindows.length
  return <>
  <table className="mi-capital-conditions__etf-table">
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
      {unreadable
        ? <tr><td className="mi-capital-conditions__etf-unavailable" colSpan={span}><StateView state="error" reasonCode="unavailable" action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: onRetry }} /></td></tr>
        : <>
            <EtfRow asset={reading.btc} label={text.btc} missing={reading.missing?.btc} text={text} />
            <EtfRow asset={reading.eth} label={text.eth} missing={reading.missing?.eth} text={text} />
          </>}
    </tbody>
  </table>
  {/* 对比列单独说：不可比，且只在有 `laggingDays` 时念出落后几个交易日。 */}
  {!unreadable && reading.comparison.state === 'unaligned'
    ? <p className="mi-capital-conditions__etf-comparison" data-etf-comparison="unaligned">
        {text.etfComparisonUnaligned}
        {/* 只有「最新交易日不同」那一支带得出落后几个交易日；另一支没有这个数就不念。 */}
        {'laggingDays' in reading.comparison
          ? ` · ${format(text.etfComparisonLagging, { days: reading.comparison.laggingDays })}`
          : null}
      </p>
    : null}
  </>
}

function EtfRow({ asset, label, missing, text }: {
  asset?: DashboardEtfFlowAsset
  label: string
  /** 这一支读不到时由模型给的原因；有 `asset` 就不用它。 */
  missing?: DashboardEtfMissingReason
  text: Text
}): React.ReactElement {
  // 这一支没值：说「未知」并给原因，**不补 0、不拿另一支顶**。
  if (asset === undefined) {
    return <tr data-etf-missing={missing ?? 'asset-missing'}>
      <th scope="row"><i className="mi-capital-conditions__asset-dot" data-series={label === text.eth ? 'eth' : 'btc'} aria-hidden="true" />{label}</th>
      <td className="mi-capital-conditions__etf-unknown" colSpan={1 + etfFlowPolicy.cumulativeWindows.length + 1}>
        {text.etfUnknown} · {missingReasonText(missing, text)}
      </td>
    </tr>
  }
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

function missingReasonText(reason: DashboardEtfMissingReason | undefined, text: Text): string {
  switch (reason) {
    case 'source-unreadable': return text.etfMissingSourceUnreadable
    case 'value-missing': return text.etfMissingValueMissing
    default: return text.etfMissingAssetMissing
  }
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
function EtfFlow({ reading, flowHistory, text, onRetry }: {
  reading?: DashboardEtfReading
  flowHistory?: AvailableState['flowHistory']
  text: Text
  onRetry: () => void
}): React.ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false)
  const resolveText = useProductTextKey()
  // "The sources did not answer" stays an error with a retry; "they answered with too few days"
  // is a not-yet with the count, so the two never share a sentence.
  if (reading === undefined || reading.state === 'unreadable' || !flowHistory) {
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
      {/* 标题 + ⓘ 是一个整体：窄卡时**先坏动作**（整颗折到下一行仍贴右），
          解释图标永远不离开它解释的那句话。所以这两件事分组，动作留作兄弟。 */}
      <div className="mi-capital-conditions__etf-flow-title">
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
      </div>
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
