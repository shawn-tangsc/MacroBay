import { ChevronRight, Info } from 'lucide-react'
import { useState } from 'react'

import { Segmented } from '@platform/ui/components/segmented'

import { LoadingState } from '@platform/ui/components/loading'
import { IconButton } from '@platform/ui/components/icon-button'
import { Modal } from '@platform/ui/components/modal'
import { Popover } from '@platform/ui/components/popover'
import { Tooltip } from '@platform/ui/components/tooltip'
import { STATE_VIEW_ACTION_KEYS, useStateViewText } from '@platform/ui/components/state'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { OpenInterestWindow } from '../../../../contracts/openInterestHistory'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { openIntelligenceSourcesSettings } from '../../../shared/navigation/productShellNavigation'
import type { PositioningState } from '../../../../contracts/openInterestPositioning'
import type { DashboardFundingRateHistoryPoint, DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
import {
  dashboardPositioningPresentationPolicy,
  formatDashboardChange,
  formatDashboardNotional,
  positioningStateFor,
  type DashboardPositioningPoint,
  type DashboardPositioningViewState,
  type DashboardSignalChip
} from '../../../pages/intelligence/dashboardOpenInterestModel'

import { SignalDetail } from '../shared'
import { useSignalAnalysisSentence } from '../shared/useSignalAnalysisSentence'
import { PositioningChart, PositioningChartSkeleton, formatRate } from './PositioningChart'
import type { PositioningPanelText } from './positioningText'
import {
  projectPositioningCardState,
  type PositioningCellReason,
  type PositioningCells,
  type PositioningCellState
} from '../../../pages/intelligence/dashboardPositioningSourceState'
import { positioningNoteKeys, resolvePositioningNote } from './positioningNotes'
// 三态怎么画在独立模块里：句式落在结构行上，卡片骨架不动（用户 2026-11-11 定的形态）。
import { SourceStateLine, cellStateAction, type SourceStateLineView } from './positioningSourceState'

import './PositioningPanel.css'

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
  /**
   * 两格各自的源可用性（判定在 `projectPositioningCells`，来自源注册表与格级启用表，不在本文件现算）。
   * 不传 = 两格都可用（老调用点与既有用例的行为不变）。
   */
  cells?: PositioningCells
  /** 未配置 / 未启用时的那个动作：去「设置 → 情报源」对应分组。 */
  onOpenSources?: () => void
  /** 费率那格读不到时的重读入口；不传就退到整卡的 `onReload`。 */
  onReloadFunding?: () => void
}>

// A strip above the plot belongs to the liquidation marks: a label drawn over the curves hid the
// very movement it was pointing at.
// The viewBox is drawn at roughly the width the card is, so the svg scales ~1:1: text keeps its
// nominal size and the drawing is 186 units tall instead of being blown up with the container.
/** 牌子那一行：方向进词，符号进数——两条规则各写各的，正号配“空头”而不是配“强平”。 */
function chipLabel(text: PositioningPanelText, chip: Extract<DashboardSignalChip, { state: 'alert' }>): string {
  const move = chip.pricePct !== undefined ? formatDashboardChange(chip.pricePct) : formatDashboardChange(chip.dropPct)
  const template = chip.direction === 'short' ? text.liquidationChipShort : text.liquidationChipLong
  return template
    .replace('{asset}', text.assets[chip.asset])
    .replace('{pct}', move)
    .replace('{multiple}', chip.volumeMultiple.toFixed(1))
}

export function PositioningPanel({ funding, positioning, window, onWindowChange, text, cells, onOpenSources, onReloadFunding }: PositioningPanelProps): React.ReactElement {
  const formatTime = useShellTimeFormat()
  const resolveProductKey = useProductTextKey()
  // 口径说明收在一颗 ⓘ 里（界面 2026-11-08）：正文只留读数与证据，元说明不占版面。
  const resolveNote = resolvePositioningNote(useShellLanguage())
  // 重试那一枚的文案归平台（`ui.state.action.retry`）：这行不造句，也不新造第二个「重试」。
  const stateText = useStateViewText()
  const analysisSentence = useSignalAnalysisSentence(positioning.state === 'available' ? positioning.signalAnalysis : undefined)
  // 牌子本身就是入口（界面设计 v2，2026-11-08）：没有再单独一颗「口径说明」。牌子只在规则命中时
  // 存在——没有读数就没有可解释的口径，给入口等于给空盒子。
  // 牌子在弹层打开时**不重建**：焦点回位是 antd 在 afterClose 里把焦点送回「打开前的那个节点」，
  // 牌子一旦换成另一个节点，回位就落到 `<body>`。所以说明气泡靠一条 CSS 让位（见 PositioningPanel.css），
  // 而不是靠把 `Tooltip` 从树上摘掉。
  const [dialogOpen, setDialogOpen] = useState(false)
  // The chip the module's rule produced, if any. A hidden chip renders nothing at all — no empty
  // container, no grey "normal": an always-present badge becomes background noise within a fortnight.
  const signal = positioning.state === 'available' ? positioning.signal : undefined
  const chip = signal && signal.state !== 'hidden' ? signal : undefined
  const alertChip = chip?.state === 'alert' ? chip : undefined
  /**
   * 强平判定的三种说法，卡面脚注区一行、互斥（产品 2026-11-08）。
   *
   * 判据全部来自同一份投影，不另算：牌子 `hidden` = 读到了、判完了、零命中；`unreadable` =
   * 规则那次没读到；`insufficient` = 读到了但成交量腿不齐。第三种以前只给一枚「数据不齐」的
   * 状态牌、第二种只给一个 16px 感叹号——两者都说不清「是没命中，还是没读到」。
   *
   * 整卡本身不可用时（空 / 读失败 / 加载中）这行不出现：骨架与状态行已经在说同一件事。
   */
  // 判据直接读投影里的牌子状态（不从上面那个只为「显示哪些牌子」过滤过的 `chip` 取：
  // `hidden` 恰恰是被过滤掉的那一种，而「没命中」正是它）。
  const liquidationNote: 'noHit' | 'unreadable' | 'insufficient' | undefined =
    positioning.state !== 'available'
      ? undefined
      : positioning.signal.state === 'alert'
        ? undefined
        : positioning.signal.state === 'unreadable'
          ? 'unreadable'
          : positioning.signal.state === 'insufficient'
            ? 'insufficient'
            : 'noHit'
  // 这行只在整卡可用时存在，但 JSX 里读不到那个收窄：把重读入口先取出来。
  const reloadPositioning = positioning.state === 'available' ? positioning.onReload : undefined
  const liquidationNoteText = liquidationNote === 'noHit'
    ? text.liquidationNoteNoHit
    : liquidationNote === 'unreadable'
      ? text.liquidationNoteUnreadable
      : liquidationNote === 'insufficient'
        ? text.liquidationNoteInsufficient
        : undefined
  const header = (extra?: React.ReactNode, showTabs = true) => (
    <header className="mi-positioning-panel__head">
      <h2>{text.pairTitle}</h2>
      {alertChip ? (
        // 说明与点击并存：说明是规则/窗口/「这是推断值」那一句，悬停与聚焦都能读到；气泡在下、
        // 点在牌子上。牌子本身不重建（弹层打开时只让气泡让位），焦点回位才落得回它身上。
        <Tooltip resolveText={resolveProductKey}
          labelKey="pages.intelligence.portal.dashboard.positioning.signalHover"
          labelParams={{ rule: text.signalDetailsRuleName, window: text.window15m, kind: text.signalKindInferred }}>
          {/* 牌子即入口：可见文字就是读数，后面一句话说清点开会怎样（label-in-name 成立）。
              没有 `aria-expanded`——弹层不是就地展开；回车与空格由原生 `button` 给。 */}
          <button type="button" className="mi-positioning-panel__signal" data-state="alert"
            aria-haspopup="dialog"
            aria-label={`${chipLabel(text, alertChip)} · ${text.helpDetailsLabel}`}
            onClick={() => setDialogOpen(true)}>
            {chipLabel(text, alertChip)}
            {/* 只表示「点开有东西」：不是第二颗按钮，也不抢读数本身的注意力。 */}
            <ChevronRight aria-hidden="true" className="mi-positioning-panel__signal-chevron" size={6} strokeWidth={2} />
          </button>
        </Tooltip>
      ) : null}
      {extra}
      {showTabs ? <WindowTabs window={window} onWindowChange={onWindowChange} text={text} /> : null}
    </header>
  )

  // A leg that read fine keeps its rate even when the other leg did not: one unreadable leg must
  // not erase a reading that is right there (its own line below says why the other is unknown).
  const fundingLeg = (leg: 'btc' | 'eth'): readonly DashboardFundingRateHistoryPoint[] =>
    funding.state === 'available' || funding.state === 'partial' ? funding[leg] ?? [] : []
  const btcRate = fundingLeg('btc')
  const ethRate = fundingLeg('eth')
  const fundingMissingNote = funding.state === 'partial'
    ? (['btc', 'eth'] as const).flatMap((asset) => {
        const reason = funding.missing[asset]
        return reason === undefined ? [] : [text.fundingMissingLeg
          .replace('{asset}', text.assets[asset])
          .replace('{reason}', text.fundingMissingReasons[reason])]
      }).join(' · ')
    : ''
  const available = positioning.state === 'available'
  // 空态与读不到都带重读入口；读到了就没有可重读的东西。
  const positioningRetry = positioning.state === 'unavailable' || positioning.state === 'empty' ? positioning.onReload : undefined
  // 两格的源可用性：判定在投影里（注册表 / 格级启用 / 这次读到没有），本文件只按它决定画哪半。
  const cardSourceState = cells ? projectPositioningCardState(cells) : undefined
  const oiState: PositioningCellState = cells?.oi ?? 'available'
  const fundingCellState: PositioningCellState = cells?.funding ?? 'available'
  const oiReady = oiState === 'available'
  const fundingReady = fundingCellState === 'available'
  // 每格一颗主动作：未配置 → 去配置；未启用 → 去启用（同一处，落在该源那一行）；读不到 → 再试一次。
  const cardSourceReason: PositioningCellReason | undefined = cells?.reasons.oi ?? cells?.reasons.funding
  // 整卡「再试一次」把两格一起重读：两格都不可用时读者要的是「再读一次这张卡」。
  const cardRetry = (): void => { positioningRetry?.(); onReloadFunding?.() }
  // 未配置 / 未启用的动作永远有一颗真按钮：宿主没接线时落到共享导航（同一个目的地：设置 → 情报源）。
  const cardOpenSources = onOpenSources ?? openIntelligenceSourcesSettings
  // 两个时刻都来自投影（同源）：曲线末点与折叠前的最新读数。这里不再 `at(-1)` 现取——
  // 各算一处，窗口切换时就会出现「写着 01:00 · 01:45，但曲线末点其实不是 01:00」。
  const pointAt = available ? positioning.pointAt : undefined
  const newestReadingAt = available ? positioning.newestReadingAt ?? positioning.pointAt : undefined
  // 形状/版本不符的唯一出口：完全退出后重开（重试必然再失败）。
  const restartAction = { label: stateText(STATE_VIEW_ACTION_KEYS.restart_app), onSelect: () => { void globalThis.window.platform.app.relaunch() } }
  /**
   * 每一格的一句状态，落在图表上方那一行里——卡片骨架不动，只换这一行（用户 2026-11-11）。
   *
   * 两格都不用时同源、说一句；只有一格不可用时点名是哪一格。顺序与判定顺序一致：
   * 未配置 → 未启用 → 读不到；「没有数据」不是这三态之一，用产品自己那句。
   */
  const sourceNotes: SourceStateLineView[] = cardSourceState
    ? [{
        state: cardSourceState,
        ...(cardSourceReason ? { reason: cardSourceReason } : {}),
        action: cellStateAction({
          state: cardSourceState, text, openSources: cardOpenSources, retry: cardRetry, restart: restartAction,
          ...(cardSourceReason ? { reason: cardSourceReason } : {})
        })
      }]
    : [
        ...(oiReady ? [] : [{
          label: text.notional, state: oiState,
          ...(cells?.reasons.oi ? { reason: cells.reasons.oi } : {}),
          action: cellStateAction({
            state: oiState, text, openSources: cardOpenSources, restart: restartAction,
            ...(cells?.reasons.oi ? { reason: cells.reasons.oi } : {}),
            ...(positioningRetry ? { retry: positioningRetry } : {})
          })
        } as SourceStateLineView]),
        ...(fundingReady ? [] : [{
          label: text.rateLabel, state: fundingCellState,
          ...(cells?.reasons.funding ? { reason: cells.reasons.funding } : {}),
          action: cellStateAction({
            state: fundingCellState, text, openSources: cardOpenSources, restart: restartAction,
            ...(cells?.reasons.funding ? { reason: cells.reasons.funding } : {}),
            ...(onReloadFunding ?? positioningRetry ? { retry: onReloadFunding ?? positioningRetry! } : {})
          })
        } as SourceStateLineView]),
        ...(positioning.state === 'empty' && oiReady ? [{ state: 'empty' as const }] : []),
        ...(positioning.state === 'unavailable' && oiReady
          ? [{
              state: 'unreadable' as const,
              ...(positioning.cause === 'contract-mismatch' ? { sentence: text.contractMismatch } : {}),
              action: cellStateAction({
                state: 'unreadable' as const, text, openSources: cardOpenSources,
                retry: positioning.onReload, restart: restartAction,
                ...(positioning.cause ? { reason: positioning.cause } : {})
              })
            }]
          : [])
      ]

  return (
    <section className="mi-positioning-panel" data-state={positioning.state} data-funding-state={funding.state} data-window={window}
      data-stale={available && positioning.staleSince ? 'true' : undefined}>
      {header(
        <>
          {pointAt
            ? <small className="mi-positioning-panel__asof">{text.observedAt} {formatTime(pointAt)}
                {/* 界面设计 2026-11-10：两个时刻不同才写第二段（7 天窗口的折叠点最多比最新读数早 45 分钟）。
                    不用括号——括号读作「补充/次要」，而「最新读数更晚」在这个窗口是同等级的关键事实；
                    也不加第三套词，只用「观测时间」「最新读数」这两段。 */}
                {pointAt && newestReadingAt && newestReadingAt !== pointAt
                  ? <> · {text.newestReading} {formatTime(newestReadingAt)}</>
                  : null}
                {available && positioning.staleSince ? text.staleSuffix.replace('{stale}', text.stale) : ''}</small>
            : null}
        </>
      )}
      {/*
        弹层里三组，讲的是同一件事的三个层次：这次读数是什么、这张卡在读什么、口径上哪里容易读错。
        读数原先挂在牌子下面就地展开；牌子现在只开这一个弹层，那些数字跟着进来，否则它们没有第二个家。

        `mi-sample-surface` 挂在弹层根上：弹窗 portal 到 `<body>`，页面根上的门户色板到不了这里，
        不带它，`--mi-dashboard-*` 会全部解析成空（资金流那张卡的柱子就这样透明过一次）。
      */}
      {alertChip ? (
        <Modal open={dialogOpen} width="standard"
          ariaLabelKey="pages.intelligence.portal.dashboard.positioning.signalDetailsTitle"
          onClose={() => setDialogOpen(false)}
          className="mi-sample-surface mi-positioning-panel__help-modal"
          destroyOnHidden
          resolveText={resolveProductKey}>
          <div className="mi-positioning-panel__help-dialog">
            {/* 标题行：标题文字在前、ⓘ 紧跟其后，同一行、间距 4px（用户 2026-11-08 的截图：
                「这个 icon hover 给我放到标题边上不行吗」）。**不许**推到行尾——`space-between`
                与 `margin-left: auto` 会让图标和它解释的文字脱钩。弹层因此改成无头、标题画在正文第一行。 */}
            <div className="mi-positioning-panel__dialog-head">
              <h3 className="mi-positioning-panel__dialog-title">{text.signalDetailsTitle}</h3>
              <Popover lines={positioningNoteKeys.map(labelKey => ({ labelKey }))} resolveText={resolveNote}
                trigger={triggerProps => (
                  <IconButton {...triggerProps}
                    ariaLabelKey="pages.intelligence.portal.dashboard.positioning.helpDetailsLabel"
                    icon={Info} resolveText={resolveProductKey} size="sm" variant="plain" />
                )} />
            </div>
            <SignalDetail
              id="mi-positioning-signal-detail"
              titleKey="pages.intelligence.portal.dashboard.positioning.signalDetailsTitle"
              rows={[
                // 第一行回答「这次分析到哪一步」：读者点开牌子最先想知道的是分析会不会来。
                ...(analysisSentence ? [{ labelKey: 'pages.intelligence.portal.dashboard.signalAnalysis.label', value: analysisSentence }] : []),
                // The rule's own words, never its internal id: the reader came to check the reading,
                // not to learn a code name.
                { labelKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsRule', value: text.signalDetailsRuleName },
                { labelKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsWindow', value: text.window15m },
                { labelKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsDrop', value: formatDashboardChange(alertChip.dropPct) },
                { labelKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsVolume', value: `${alertChip.volumeMultiple.toFixed(1)}×` },
                { labelKey: 'pages.intelligence.portal.dashboard.positioning.signalDetailsObservedAt', value: formatTime(alertChip.observedAt) }
              ]}
              noteKey="pages.intelligence.portal.dashboard.positioning.signalDetailsNote" />
          </div>
        </Modal>
      ) : null}
      <div className="mi-positioning-panel__body" data-card-state={cardSourceState ?? 'available'}>
        {/* 左列：两行资产位始终在。不可用的格给占位（`—`），不是整行消失。 */}
        <div className="mi-positioning-panel__summary">
          <Asset asset="btc" text={text} rate={fundingReady ? btcRate.at(-1) : undefined} rateAgo={fundingReady ? btcRate.at(-4) : undefined}
            change={available && oiReady ? positioning.changeBtc : undefined}
            notional={available && oiReady ? positioning.btc.at(-1) : undefined}
            state={available && oiReady ? positioningStateFor(positioning, btcRate, positioning.changeBtc) : undefined} />
          <Asset asset="eth" text={text} rate={fundingReady ? ethRate.at(-1) : undefined} rateAgo={fundingReady ? ethRate.at(-4) : undefined}
            change={available && oiReady ? positioning.changeEth : undefined}
            notional={available && oiReady ? positioning.eth.at(-1) : undefined}
            state={available && oiReady ? positioningStateFor(positioning, ethRate, positioning.changeEth) : undefined} />
        </div>
        {/* 右列：显式第 2 列。状态行与骨架都不许把图挪走（Chief 2026-11-11 的布局根因）。 */}
        <div className="mi-positioning-panel__chart-wrap">
          {sourceNotes.map((note, index) => (
            <SourceStateLine key={`${note.state}-${note.label ?? 'card'}-${index}`} view={note} text={text} resolveText={resolveProductKey} />
          ))}
          {/* 只有「这一格已启用、正在读」才算等待：被关掉/没配置的格不会自己变出数据，等它就是在骗人。 */}
          {oiReady && positioning.state === 'loading' || fundingReady && funding.state === 'loading'
            ? <LoadingState label={text.loading} minHeight={140} />
            : available && oiReady
              ? <>
                  {/* 费率那一格不可用时只画持仓线，不画半张柱子图；缺的那格由上面那行说明。 */}
                  <PositioningChart positioning={positioning} funding={fundingReady ? funding : { state: 'unavailable' }} text={text} />
                  {/* 一条腿读不到时的说明：整句、muted、不带重试——另半张图照常画，读者要知道少了哪条腿。 */}
                  {fundingReady && fundingMissingNote ? (
                    <p className="mi-positioning-panel__funding-missing" data-funding-missing="true" role="status">{fundingMissingNote}</p>
                  ) : null}
                  {/*
                    截断行：只说图，不说判定结论。它和卡底的「判定三态」是两处、可以同时出现——
                    一个说图上有几个点没画，一个说这次判成什么；**截断行不许提结论，判定行不许提数量**。
                    只在真的画不下时出现：命中 0 时这一行不存在，卡面不多一个字。
                  */}
                  {positioning.hiddenHits > 0 ? (
                    <p className="mi-positioning-panel__hidden-hits" data-hidden-hits="">
                      {text.liquidationHiddenHits.replace('{count}', String(positioning.hiddenHits))}
                    </p>
                  ) : null}
                </>
              : <PositioningChartSkeleton text={text} />}
        </div>
      </div>
      {liquidationNoteText ? (
        // 一行，muted，不是警报色：它说的是判定的结论，不是「我们出错了」。
        <p className="mi-positioning-panel__liquidation-note" data-liquidation-note={liquidationNote} role="status">
          {liquidationNoteText}
          {liquidationNote === 'unreadable'
            // 「读不到」后面跟那枚既有重试：读者在这行要的是一个动作和一个结论，不是诊断。
            ? <button type="button" className="mi-positioning-panel__liquidation-retry"
                onClick={reloadPositioning}>{stateText(STATE_VIEW_ACTION_KEYS.retry)}</button>
            : null}
        </p>
      ) : null}
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
  /** 这一格不可用时**不画**：不做一串破折号，那个位置由卡片上那行状态说明接手。 */
  hideRate?: boolean
  hideNotional?: boolean
}>): React.ReactElement {
  const resolveProductKey = useProductTextKey()
  // 口径说明收在一颗 ⓘ 里（界面 2026-11-08）：正文只留读数与证据，元说明不占版面。
  const resolveNote = resolvePositioningNote(useShellLanguage())
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
