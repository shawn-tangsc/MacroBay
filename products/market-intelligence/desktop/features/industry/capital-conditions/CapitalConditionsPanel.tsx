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
import { capitalCellBlockActionLabel, capitalCellBlockText, type DashboardCapitalCellAvailability, type DashboardCapitalCellBlock } from './capitalCellBlock'
import {
  isCapitalConditionsRetryable,
  type DashboardCapitalConditionsState,
  type DashboardCapitalConditionsUnavailableReason,
  type DashboardEtfFlowAsset,
  type DashboardEtfMissingReason,
  type DashboardEtfReading
} from './capitalConditionsModel'
import { EtfOutflowChip, EtfSignalDetailDialog, type EtfSignalText } from './EtfOutflowSignal'
import { SkeletonEtfRow, unavailableNotice } from './capitalUnavailable'
import { CellSourceWord, EtfTable, StablecoinTable, format, type CapitalTableText } from './capitalTables'
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
 * 一格为什么没读数：格关 / 源停 / 源没配凭据 / 源状态读不到，四种各一句、各一颗动作。
 *
 * 这张卡是**多行多值卡**：两格能分别判断，所以逐格标（共享行内状态 `mi-source-state`），
 * **不叠整卡状态面**——同一张卡只许一种形态（界面设计 2026-11-11 §二）。
 * 句子与动作只在 `capitalCellBlock.ts` 写一次，三处（表、图、标题行）读同一份。
 */
export type { DashboardCapitalCellAvailability, DashboardCapitalCellBlock } from './capitalCellBlock'

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
  const blockText = capitalCellBlockText(dataText)
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
  // 两格各自判断：格关 / 源停 / 源没配凭据 / 源状态读不到，逐格标在行内；「读到了但没读成」由读数
  // 自己说（`EtfTable` / `EtfFlow` 的行内词）——几种说法互不冒充，也不叠整卡状态面。
  //
  // 两格都不可读时**这一次根本不去读**（宿主把读口关了），所以卡片不许停在「正在加载」：
  // 它照旧渲染，两行各自说自己那一态。这也是「关掉来源不等于这张卡消失」的判据。
  // 第一支：两格都是**读者关掉的格** → 内容区盖共享遮罩、居中一颗「启用数据」。
  // 混合原因（一格关、一格源停）不盖遮罩：那是两件事，逐格说；否则遮罩上那句话会对其中一格说谎。
  //
  // 不画表头骨架：骨架说的是「有表、只是这次没数」，而这一支连源都没开，画出来就是在暗示数据在。
  const bothCellOff = cellAvailability?.stablecoin?.kind === 'cell-off' && cellAvailability?.etf?.kind === 'cell-off'
  if (bothCellOff) return <section className="mi-capital-conditions" aria-label={text.title}>
    <div className="mi-capital-conditions__header-band"><h2>{text.title}</h2></div>
    <div className="mi-source-veil-host" data-veiled="true">
      <div className="mi-source-veil" data-state="disabled">
        <p className="mi-source-state" data-state="disabled">
          <CircleSlash aria-hidden="true" className="mi-source-state__icon" size={14} />
          <span>{blockText.cellNotEnabled}</span>
        </p>
        <Button onClick={cellAvailability.stablecoin.onAction} size="small">
          {blockText.enableData}
        </Button>
      </div>
    </div>
  </section>

  // 两格都不可读、但原因不全是「格关」：宿主把读口关了，读数停在 loading。
  // 这里不画加载圈——那是「在等数据」，而这两格已经有结论了（源停/没配/状态读不到）。
  const firstUnreadableCell = cellAvailability?.stablecoin ?? cellAvailability?.etf
  const blockedCells = cellAvailability?.stablecoin !== undefined && cellAvailability.etf !== undefined
    ? { stablecoin: cellAvailability.stablecoin, etf: cellAvailability.etf }
    : undefined
  if (blockedCells !== undefined && state.state === 'loading') {
    const first = blockedCells.stablecoin
    return <section className="mi-capital-conditions" data-state="blocked" aria-label={text.title}>
      <div className="mi-capital-conditions__content-row">
        <div className="mi-capital-conditions__summary">
          <div className="mi-capital-conditions__header-band">
            <h2>{text.title}</h2>
            <Button className="mi-capital-conditions__title-action" onClick={first.onAction} size="small" type="link">
              {capitalCellBlockActionLabel(first, blockText)}
            </Button>
          </div>
          <StablecoinTable text={text} cellOff={blockedCells.stablecoin} />
          <EtfTable text={text} cellOff={blockedCells.etf} />
        </div>
        <EtfFlow text={text} cellOff={blockedCells.etf} />
      </div>
    </section>
  }

  if (state.state === 'loading') return <section className="mi-capital-conditions" data-state="loading" aria-label={text.title}>
    <div className="mi-capital-conditions__summary">
      <h2>{text.title}</h2>
      <LoadingState label={text.loading} minHeight={140} />
      <Button className="mi-capital-conditions__refresh" disabled
        icon={<RefreshCw aria-hidden="true" size={13} />} loading onClick={onRefresh} size="small" type="link">{text.refresh}</Button>
    </div>
  </section>

  // 源答了「空的」、但有格自己另有原因（源停 / 没配凭据 / 格关）：逐格说。
  // 整卡一句「暂时没有可用的资金面数据」会把「这一格压根没开」盖掉，读者看不出该去做什么。
  if (state.state === 'empty' && firstUnreadableCell !== undefined) return <section className="mi-capital-conditions" data-state="empty" aria-label={text.title}>
    <div className="mi-capital-conditions__content-row">
      <div className="mi-capital-conditions__summary">
        <div className="mi-capital-conditions__header-band">
          <h2>{text.title}</h2>
          <Button className="mi-capital-conditions__title-action" onClick={firstUnreadableCell.onAction} size="small" type="link">
            {capitalCellBlockActionLabel(firstUnreadableCell, blockText)}
          </Button>
        </div>
        <StablecoinTable text={text} {...(cellAvailability?.stablecoin ? { cellOff: cellAvailability.stablecoin } : {})} />
        <EtfTable text={text} {...(cellAvailability?.etf ? { cellOff: cellAvailability.etf } : {})} />
      </div>
      <EtfFlow text={text} {...(cellAvailability?.etf ? { cellOff: cellAvailability.etf } : {})} />
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
        <StablecoinTable text={text} {...(cellAvailability?.stablecoin
          ? { cellOff: cellAvailability.stablecoin }
          : { notice: unavailableNotice(state.reason, text, dataText, restartLabel, onRefresh) })} />
        <EtfTable text={text} {...(cellAvailability?.etf ? { cellOff: cellAvailability.etf } : { skeleton: true })} />
      </div>
      <EtfFlow text={text} skeleton={cellAvailability?.etf === undefined} {...(cellAvailability?.etf ? { cellOff: cellAvailability.etf } : {})} />
    </div>
    {/* 面板级「重新采集失败」：提示条只报事、不带动作——上面那一行里的那颗就是同一个 `onRefresh`。 */}
    {refreshFailed ? <InlineNotice tone="danger">{text.refreshFailed}</InlineNotice> : null}
  </section>
  // 有格不可读 → 那一格的句子与动作（格关 / 源停 / 没配凭据 / 源状态读不到各不同）。
  // 源配好、只是这次没读到 → 只留「暂时读不到」，**不给按钮**：ETF 半边没有真的重采入口
  // （`capitalConditionsCollection.ts` 只 runNow 稳定币），给一颗按了也不会变的按钮更坏。
  const firstBlock = firstUnreadableCell
  const titleAction = firstBlock
    ? { label: capitalCellBlockActionLabel(firstBlock, blockText), run: firstBlock.onAction }
    : undefined

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
          {/* 这张卡唯一的动作入口（用户 2026-11-11：卡内不带按钮，收到标题行右侧）。
              四种「没读数」各给各的动作（见 `capitalCellBlock.ts`）；源配好只是没读到时**不给**按钮，
              因为 ETF 那半没有真重采入口。都读到 → 整颗不出现。 */}
          {titleAction
            ? <Button className="mi-capital-conditions__title-action" onClick={titleAction.run} size="small" type="link">{titleAction.label}</Button>
            : null}
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
        {/* 两格各自说话，而且**只说一次、摆法一致**：缺哪一格，就在那一格的表里用行内状态词说；
            同一张卡内不许「一行用行内词、另一块整块换成状态面」——那是缺陷不是风格。
            卡内不带按钮：这张卡的唯一动作在标题行右侧（见 `titleAction`）。 */}
        <StablecoinTable state={state} text={text} {...(cellAvailability?.stablecoin ? { cellOff: cellAvailability.stablecoin } : {})} />
        <EtfTable reading={state.etfReading} text={text} onRetry={onRefresh}
          {...(cellAvailability?.etf ? { cellOff: cellAvailability.etf } : {})} />
      </div>
      <EtfFlow reading={state.etfReading} flowHistory={state.flowHistory} text={text} onRetry={onRefresh}
        {...(cellAvailability?.etf ? { cellOff: cellAvailability.etf } : {})} />
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
function EtfFlow({ reading, flowHistory, text, onRetry, skeleton = false, cellOff }: {
  reading?: DashboardEtfReading
  flowHistory?: AvailableState['flowHistory']
  text: Text
  onRetry?: () => void
  /** 这一格没启用：标题留着，里面一句行内状态词。 */
  cellOff?: DashboardCapitalCellBlock
  /** 整卡读不到：**标题、图例留外面，图里没有数据**（不画假曲线、不画 0 值柱）。 */
  skeleton?: boolean
}): React.ReactElement {
  const [dialogOpen, setDialogOpen] = useState(false)
  const resolveText = useProductTextKey()
  const inlineText = (key: string): string => resolveText(key)
  if (skeleton) {
    return <section className="mi-capital-conditions__etf-flow" data-etf-flow="skeleton">
      <header><div className="mi-capital-conditions__etf-flow-title"><h3>{text.etfFlow}</h3></div></header>
      <CapitalFlowLegend text={text} />
      <CapitalFlowChart rows={[]} text={text} />
    </section>
  }
  // "The sources did not answer" stays an error with a retry; "they answered with too few days"
  // is a not-yet with the count, so the two never share a sentence.
  if (cellOff !== undefined || reading === undefined || reading.state === 'unreadable' || !flowHistory) {
    // 行内状态词：这一块读不到（或这一格没启用）时只在这里说一句，不把整块换成状态面，
    // 也不在这里挂按钮——这张卡的动作在标题行右侧。
    return <section className="mi-capital-conditions__etf-flow" data-etf-flow={cellOff === undefined ? 'unavailable' : 'cell-off'}><h3>{text.etfFlow}</h3>
      {cellOff
        ? <CellSourceWord block={cellOff} />
        : <span className="mi-source-state" data-state="unreadable">
            <TriangleAlert aria-hidden="true" className="mi-source-state__icon" size={14} />
            <span>{inlineText('pages.intelligence.portal.data.temporarilyUnavailable')}</span>
          </span>}
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

