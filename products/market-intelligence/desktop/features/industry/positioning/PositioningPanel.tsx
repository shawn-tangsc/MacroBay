import { ChevronRight, Info } from 'lucide-react'
import { useState } from 'react'

import { Segmented } from '@platform/ui/components/segmented'

import { LoadingState } from '@platform/ui/components/loading'
import { IconButton } from '@platform/ui/components/icon-button'
import { Modal } from '@platform/ui/components/modal'
import { Popover } from '@platform/ui/components/popover'
import { Tooltip } from '@platform/ui/components/tooltip'
import { STATE_VIEW_ACTION_KEYS, StateView, useStateViewText } from '@platform/ui/components/state'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import type { OpenInterestWindow } from '../../../../contracts/openInterestHistory'
import { useShellLanguage } from '@platform/ui/shell/ShellLanguageContext'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { PositioningState } from '../../../../contracts/openInterestPositioning'
import type { DashboardFundingRateHistoryState } from '../../../pages/intelligence/dashboardFundingRateHistoryModel'
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
import { PositioningChart, formatRate } from './PositioningChart'
import type { PositioningPanelText } from './positioningText'
import { positioningNoteKeys, resolvePositioningNote } from './positioningNotes'

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

export function PositioningPanel({ funding, positioning, window, onWindowChange, text }: PositioningPanelProps): React.ReactElement {
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
   * 整卡本身不可用时（空 / 读失败 / 加载中）这行不出现：那是平台 `StateView` 的地盘。
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
  const header = (extra?: React.ReactNode) => (
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
            : status}
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
