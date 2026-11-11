import { useEffect, useRef, useState } from 'react'

import { Button } from 'antd'
import { CircleSlash, Info, RefreshCw, TriangleAlert } from 'lucide-react'

import { etfFlowPolicy } from '../../../../contracts/etfFlows'
import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import { LoadingState } from '@platform/ui/components/loading'
import { InlineNotice } from '@platform/ui/components/inline-notice'
import { STATE_VIEW_ACTION_KEYS, StateView, useStateViewText } from '@platform/ui/components/state'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'
import { CapitalFlowChart } from './CapitalFlowChart'
import { CapitalFlowDailyTable } from './CapitalFlowDailyTable'
import { CapitalFlowDialog } from './CapitalFlowDialog'
import { CapitalFlowLegend } from './CapitalFlowLegend'
import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import '../../../shared/styles/sourceAvailability.css'
import { useSignalAnalysisSentence } from '../shared/useSignalAnalysisSentence'
import type { SourceCellOff } from '../shared/sourceCellOff'
import {
  isCapitalConditionsRetryable,
  type DashboardCapitalConditionsState,
  type DashboardCapitalConditionsUnavailableReason,
  type DashboardEtfFlowAsset,
  type DashboardEtfMissingReason,
  type DashboardEtfReading
} from './capitalConditionsModel'
import { EtfOutflowChip, EtfSignalDetailDialog, type EtfSignalText } from './EtfOutflowSignal'
import { SkeletonEtfRow, unavailableNotice, type UnavailableNotice } from './capitalUnavailable'
import './capitalConditions.css'

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

/**
 * 一格（稳定币 / ETF）**没启用**。就这一种，不给它编第二种。
 *
 * 为什么不收「没配置」：这两格的源写死在 `DASHBOARD_SOURCE_MODULES`（`稳定币 → defillama-stablecoins`、
 * `ETF → 0xrouter-aggregate-provider`），读者没有任何动作能让一格「没有源」——
 * `cellSourceChoices(...).length === 0` 在真机上恒不成立，`decideCellRead` 的四种结局里也没有这一支。
 * 画一个永远到不了的状态，读者迟早会看到一句解释不了自己的话（「没配置」那张卡上的同一个错法）。
 *
 * 「读不到」也不在这里：它由读数自己说（`EtfTable` / `EtfFlow` 的行内重试）。
 *
 * 动作跟状态放在一起，不另设一个可选的 `onOpenSources`：说得出这一态，就必须说得出读者该去哪。
 * 这张卡是**多行多值卡**：两格能分别判断，所以逐格标（共享行内状态 `mi-source-state`），
 * **不叠整卡状态面**——同一张卡只许一种形态（界面设计 2026-11-11 §二）。
 */
export type DashboardCapitalCellOff = SourceCellOff

/** 两格各一份；缺键 = 这一格没问题，照旧画读数。 */
export type DashboardCapitalCellAvailability = Readonly<{
  stablecoin?: DashboardCapitalCellOff
  etf?: DashboardCapitalCellOff
}>

export function CapitalConditionsPanel({ state, text, onRefresh, refreshing = false, refreshFailed = false, cellAvailability }: Readonly<{
  state: DashboardCapitalConditionsState
  text: Text
  /** Re-collect when the host can, otherwise re-read the stored snapshot. Always a real action. */
  onRefresh: () => void
  refreshing?: boolean
  refreshFailed?: boolean
  /**
   * 逐格的「没启用」由宿主给（来源配置属于宿主，卡片不自己推断）。缺键 = 按读数画。
   */
  cellAvailability?: DashboardCapitalCellAvailability
}>): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const dataText = useProductTextKey() as (key: string) => string
  // 「重启应用」这颗按钮的文字取平台闭集里那一句（与 `StateView` 的 needs-restart 同一个词），不另造。
  const restartLabel = useStateViewText()(STATE_VIEW_ACTION_KEYS.restart_app)
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
  // 两格各自判断：没启用逐格标在行内（见 `CellSourceState`），「读不到」由读数自己说
  // （`EtfTable` / `EtfFlow` 的行内重试）——两种说法互不冒充，也不叠整卡状态面。
  //
  // 两格都没启用时**这一次根本不去读**（宿主把读口关了），所以卡片不许停在「正在加载」：
  // 它照旧渲染，两行各自说自己那一态。这也是「关掉来源不等于这张卡消失」的判据。
  if (cellAvailability?.stablecoin && cellAvailability.etf) return <section className="mi-capital-conditions" aria-label={text.title}>
    <div className="mi-capital-conditions__summary">
      <h2>{text.title}</h2>
      <CellSourceState availability={cellAvailability.stablecoin} dataText={dataText} />
      <CellSourceState availability={cellAvailability.etf} dataText={dataText} />
    </div>
  </section>

  if (state.state === 'loading') return <section className="mi-capital-conditions" data-state="loading" aria-label={text.title}>
    <div className="mi-capital-conditions__summary">
      <h2>{text.title}</h2>
      <LoadingState label={text.loading} minHeight={140} />
      <Button className="mi-capital-conditions__refresh" disabled
        icon={<RefreshCw aria-hidden="true" size={13} />} loading onClick={onRefresh} size="small" type="link">{text.refresh}</Button>
    </div>
  </section>

  if (state.state === 'empty') return <section className="mi-capital-conditions" data-state="empty" aria-label={text.title}>
    <div className="mi-capital-conditions__summary">
      <h2>{text.title}</h2>
      <StateView state="empty" reasonCode="not-yet"
        productReason={{ key: 'pages.intelligence.portal.dashboard.capitalConditions.empty', resolve: () => text.empty }} />
      <Button className="mi-capital-conditions__refresh" disabled={refreshing}
        icon={<RefreshCw aria-hidden="true" size={13} />} loading={refreshing} onClick={onRefresh} size="small" type="link">{text.refresh}</Button>
    </div>
  </section>

  // 整卡读不到：**结构全留**（用户 2026-11-11：「右边的图表可以继续显示，就是显示没数据的空表而已」）。
  // 卡框、表头、列名、行名照常渲染，数据格留空（不写 `—`、不逐格写「暂时读不到」），
  // 一句状态 + 一颗动作放在表头下面的第一行、跨全部数据列。换成一块 `StateView` 会把整张表拿掉，
  // 读者看到的是「这一块没做完」，不是「这次没读到」。
  if (state.state === 'unavailable') return <section className="mi-capital-conditions" data-state="unavailable" aria-label={text.title}>
    <div className="mi-capital-conditions__content-row">
      <div className="mi-capital-conditions__summary">
        <div className="mi-capital-conditions__header-band"><h2>{text.title}</h2></div>
        <StablecoinTable text={text} notice={unavailableNotice(state.reason, text, dataText, restartLabel, onRefresh)} />
        <EtfTable text={text} skeleton />
      </div>
      <EtfFlow text={text} skeleton />
    </div>
    {/* 面板级「重新采集失败」：提示条只报事、不带动作——上面那一行里的那颗就是同一个 `onRefresh`。 */}
    {refreshFailed ? <InlineNotice tone="danger">{text.refreshFailed}</InlineNotice> : null}
  </section>
  return <section className="mi-capital-conditions" data-state={state.state} aria-label={text.title}>
    <div className="mi-capital-conditions__content-row">
      <div className="mi-capital-conditions__summary">
        <div className="mi-capital-conditions__header-band">
          <h2>{text.title}</h2>
          {/* The module rule's chip sits beside the title, at most one per card. It is drawn only
              when the rule had something to say; a quiet card renders no element at all.
              ETF 那一格没启用时牌子也不画：它是那一格的读数产物，格子关着还报规则就是在说旧话。 */}
          {state.etfSignal && state.etfSignal.state !== 'hidden' && !cellAvailability?.etf
            ? <EtfOutflowChip chip={state.etfSignal} text={text} onRetry={onRefresh}
                onToggle={() => setDetailOpen(true)} triggerRef={chipTrigger} />
            : null}
          <small className="mi-capital-conditions__observed-at">{`${text.observedAt} ${formatTime(state.observedAt)}`}</small>
        </div>
        {/* state-ternary: reviewed — 这一处只决定「要不要把采集时刻传给详情弹窗」，不决定任何内容画不画；
            unreadable 时本来就没有可信的采集时刻，传 undefined 只是不给那个时间戳。 */}
        <EtfSignalDetailDialog
          verifiedAt={state.etfReading.state === 'unreadable' ? undefined : state.etfReading.verifiedAt}
          analysis={analysisSentence}
          chip={state.etfSignal ?? { state: 'hidden' }}
          onClose={closeDetail}
          open={detailOpen}
          text={text} />
        {/* These are the last numbers that read successfully. Saying so is the difference between
            "old" and "gone", and only one of those is true after a failed re-read. */}
        {state.stale ? <p className="mi-capital-conditions__stale" role="status">{text.staleRead}</p> : null}
        {/* 两格各自说话：这一格没启用就**在这一行**说，并只给这一颗动作；
            另一格没问题的照旧画读数——关掉一格不许把整张卡降级。 */}
        {cellAvailability?.stablecoin
          ? <CellSourceState availability={cellAvailability.stablecoin} dataText={dataText} />
          : <StablecoinTable state={state} text={text} />}
        {cellAvailability?.etf
          ? <CellSourceState availability={cellAvailability.etf} dataText={dataText} />
          : <EtfTable reading={state.etfReading} text={text} onRetry={onRefresh} />}
      </div>
      {cellAvailability?.etf
        ? null
        : <EtfFlow reading={state.etfReading} flowHistory={state.flowHistory} text={text} onRetry={onRefresh} />}
    </div>
  </section>
}

/**
 * 稳定币那张表。`state` 缺省 = 整卡读不到：**表头、列名、行名照常**，数据格留空，
 * 状态句与动作占据表头下面的第一行、跨全部数据列（带底色，读者一眼看到「这一块在等」）。
 *
 * 数据格**不写 `—`、也不逐格写状态词**：`—` 的意思是「确实没有」，这里只是「这次没读到」；
 * 每格铺一个词就变成一堵状态词墙，比空着更难读。
 *
 * Stock and flow share one compact table language: supply plus its 1D / 7D / 30D changes.
 */
function StablecoinTable({ state, text, notice }: Readonly<{
  state?: AvailableState
  text: Text
  notice?: UnavailableNotice
}>): React.ReactElement {
  const column = (flow: 'change1dUsd' | 'change7dUsd' | 'change30dUsd', percent: 'change1dPercent' | 'change7dPercent' | 'change30dPercent'): React.ReactElement =>
    state === undefined
      ? <td />
      : <td data-flow-direction={flowDirection(state[flow])}>{state[flow]}</td>
  // state-ternary: reviewed — 只决定要不要给百分号小格子挂方向属性；五列表头两种状态下都在。
  const head = (label: string, flow: 'change1dUsd' | 'change7dUsd' | 'change30dUsd', percent: 'change1dPercent' | 'change7dPercent' | 'change30dPercent'): React.ReactElement =>
    <th scope="col">{label}<span className="mi-capital-conditions__pct" {...(state === undefined ? {} : { 'data-flow-direction': flowDirection(state[flow]) })}>{state === undefined ? '' : `(${state[percent]})`}</span></th>
  return <table className="mi-capital-conditions__etf-table mi-capital-conditions__stable-table">
    <colgroup>
      <col className="mi-capital-conditions__etf-col-asset" />
      <col span={3} />
      <col className="mi-capital-conditions__etf-col-supply" />
    </colgroup>
    <thead><tr>
      <th scope="col">{text.asset}</th>
      {head(text.change1d, 'change1dUsd', 'change1dPercent')}
      {head(text.change7d, 'change7dUsd', 'change7dPercent')}
      {head(text.change30d, 'change30dUsd', 'change30dPercent')}
      <th scope="col">{text.totalSupply}</th>
    </tr></thead>
    <tbody>
      {/* 状态行：表头下面的第一行、跨全部数据列。行名与表头一个字不改。 */}
      {notice
        ? <tr className="mi-capital-conditions__status-row" data-status-row="unavailable">
          <td colSpan={5}>
            <div className="mi-capital-conditions__status-inline">
              <span className="mi-source-state" data-state="unreadable">
                <TriangleAlert aria-hidden="true" className="mi-source-state__icon" size={14} />
                <span>{notice.sentence}</span>
              </span>
              <Button onClick={notice.onAction} size="small">{notice.action}</Button>
            </div>
          </td>
        </tr>
        : null}
      <tr>
        <th scope="row">
          <span className="mi-capital-conditions__asset-name">{text.stablecoin}</span>
          <span className="mi-capital-conditions__asset-scope">{text.stablecoinScope}</span>
        </th>
        {column('change1dUsd', 'change1dPercent')}
        {column('change7dUsd', 'change7dPercent')}
        {column('change30dUsd', 'change30dPercent')}
        <td className="mi-capital-conditions__stable-supply">{state === undefined ? null : state.currentUsd}</td>
      </tr>
    </tbody>
  </table>
}


/** One row per asset, one column per horizon: no label repeats inside the body. */
/**
 * ETF 两行：**每一支各说各的**。一支有值就照常显示数字（0 就是 0，不许拿另一支补），
 * 另一支显示「未知」+ 具体原因；两支都读不到才整块换成错误态。
 * 窗口不等长只让**对比列**不可比，不把两份数字一起撤掉（「ETH 晚一天整份作废」就是这么来的）。
 */
/**
 * 一格的「没启用」：**行内一句 + 一颗动作**，用共享类 `mi-source-state`
 * （规范 `2026-11-11-source-availability-styles.md`；行级/格级就长这样）。
 *
 * 不用错误色——它不是故障，是读者要动手的事；读不到不在这一支（由读数自己说）。
 */
function CellSourceState({ availability, dataText }: Readonly<{
  availability: DashboardCapitalCellOff
  dataText: (key: string) => string
}>): React.ReactElement {
  return <p className="mi-source-state" data-state="disabled">
    <CircleSlash aria-hidden="true" className="mi-source-state__icon" size={14} />
    <span>{`${dataText('pages.intelligence.portal.data.sourcesNotEnabled')}（${availability.sourceLabel}）`}</span>
    <Button onClick={availability.onOpenSources} size="small" type="link">
      {dataText('pages.intelligence.portal.data.enableSources')}
    </Button>
  </p>
}

function EtfTable({ reading, text, onRetry, skeleton = false }: {
  reading?: DashboardEtfReading
  text: Text
  onRetry?: () => void
  /** 整卡读不到：表头、列名、行名照常，数据格留空（不写「未知」、不铺状态词）。 */
  skeleton?: boolean
}): React.ReactElement {
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
      {skeleton
        ? <>
            <SkeletonEtfRow label={text.btc} series="btc" span={span} />
            <SkeletonEtfRow label={text.eth} series="eth" span={span} />
          </>
        : unreadable
          ? <tr><td className="mi-capital-conditions__etf-unavailable" colSpan={span}><StateView state="error" reasonCode="unavailable" action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => onRetry?.() }} /></td></tr>
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
function EtfFlow({ reading, flowHistory, text, onRetry, skeleton = false }: {
  reading?: DashboardEtfReading
  flowHistory?: AvailableState['flowHistory']
  text: Text
  onRetry?: () => void
  /** 整卡读不到：**标题、图例留外面，图里没有数据**（不画假曲线、不画 0 值柱）。 */
  skeleton?: boolean
}): React.ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false)
  const resolveText = useProductTextKey()
  if (skeleton) {
    return <section className="mi-capital-conditions__etf-flow" data-etf-flow="skeleton">
      <header><div className="mi-capital-conditions__etf-flow-title"><h3>{text.etfFlow}</h3></div></header>
      <CapitalFlowLegend text={text} />
      <CapitalFlowChart rows={[]} text={text} />
    </section>
  }
  // "The sources did not answer" stays an error with a retry; "they answered with too few days"
  // is a not-yet with the count, so the two never share a sentence.
  if (reading === undefined || reading.state === 'unreadable' || !flowHistory) {
    return <section className="mi-capital-conditions__etf-flow" data-etf-flow="unavailable"><h3>{text.etfFlow}</h3>
      <StateView state="error" reasonCode="unavailable" action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: () => onRetry?.() }} />
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
