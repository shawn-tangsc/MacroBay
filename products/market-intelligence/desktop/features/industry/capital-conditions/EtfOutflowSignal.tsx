import { StatusPill } from '@platform/ui/components/status-pill'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { Tooltip } from '@platform/ui/components/tooltip'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { SignalDetail, SignalReadIssue, type SignalDetailRow } from '../shared'
import type { DashboardEtfSignalChip } from './capitalConditionsModel'

/**
 * 这条读数的文案：牌子、悬停解释、卡内展开的读数。
 *
 * 只用模块自己的白话词。规则名写成「ETF 净流出」，不出现 `etf-outflow-3d` 这类内部标识——
 * 牌子的内容与详情都是给读者看的，不是给我们对账的。
 */
export type EtfSignalText = {
  signalChip: string
  signalInsufficientReason: string
  signalTooltip: string
  signalRuleName: string
  signalRuleWindow: string
  signalKindObserved: string
  signalAriaAlert: string
  signalDetailRule: string
  signalDetailWindow: string
  signalDetailCumulative: string
  signalDetailCoverage: string
  signalCoverage: string
  signalDetailTradingDay: string
  signalDetailObservedAt: string
  signalDetailNote: string
}

/** 展开块的 id：牌子的 `aria-controls` 指向它，一张卡上只有这一块。 */
export const ETF_SIGNAL_DETAIL_ID = 'mi-capital-conditions-signal-detail'

type VisibleChip = Extract<DashboardEtfSignalChip, { state: 'alert' | 'insufficient' | 'unreadable' }>

/**
 * 资金面卡片标题旁的牌子。
 *
 * 牌子只回答两件事：有没有事（画不画）、是什么事（一句话）。有事是按钮，开合状态与
 * `aria-expanded` / `aria-controls` 由共用的 `useSignalDetail` 给（和持仓、背离同一套规矩）；
 * **数据不齐是陈述，不是控件**——它背后没有可展开的读数，做成按钮只会让读者点了个空。
 * 两种状态都带悬停/聚焦解释：有事说有规则、窗口、这是事实；不齐说清缺哪一路。
 */
export function EtfOutflowChip({ chip, text, triggerProps, onToggle, onRetry }: Readonly<{
  chip: VisibleChip
  text: EtfSignalText
  triggerProps: Readonly<{ 'aria-expanded': boolean; 'aria-controls': string }>
  onToggle: () => void
  /** Re-reads the card; only a retryable failure offers it. */
  onRetry: () => void
}>): React.ReactElement | null {
  const resolveText = useProductTextKey()

  // 读不到只留一个标记：一句话在悬停/聚焦里，正面上没有那行字。
  if (chip.state === 'unreadable') {
    return <SignalReadIssue failureCode={chip.failureCode} resolveText={resolveText} />
  }

  if (chip.state !== 'alert') {
    return <Tooltip
      resolveText={resolveText}
      labelKey="pages.intelligence.portal.dashboard.capitalConditions.signalInsufficientReason">
      {/* 标签是陈述，但要能被键盘聚焦：原因在悬停与聚焦时都要读得到，`title` 只能被鼠标拿到。 */}
      <span className="mi-capital-conditions__signal-statement" tabIndex={0}>
        <StatusPill
          labelKey="pages.intelligence.portal.dashboard.capitalConditions.signalInsufficient"
          resolveText={resolveText}
          tone="warn" />
      </span>
    </Tooltip>
  }

  const label = fillLabelParams(text.signalChip, { amount: chip.amountUsd })
  // 读屏念完整一句：牌子词 + 资产，与可见文字同一事实，不缩写。
  const ariaLabel = fillLabelParams(text.signalAriaAlert, { chip: label, asset: chip.asset.toUpperCase() })

  return <Tooltip
    resolveText={resolveText}
    labelKey="pages.intelligence.portal.dashboard.capitalConditions.signalTooltip"
    labelParams={{ rule: text.signalRuleName, window: text.signalRuleWindow, kind: text.signalKindObserved }}>
    <button
      {...triggerProps}
      aria-label={ariaLabel}
      className="mi-capital-conditions__signal"
      data-state="alert"
      onClick={onToggle}
      type="button">
      {label}
    </button>
  </Tooltip>
}

/**
 * 点在牌子上展开的读数：标题行下、卡片内容上，由共用的 `SignalDetail` 渲染落点、开合与区域语义。
 *
 * 这个组件只做共用组件不做的那件事——把数字格式成读者看的样子；行、标题、说明都交给共用块。
 * 数据不齐的牌子没有可展开的东西，本组件对它返回 `null`。
 */
export function EtfOutflowSignalDetail({ chip, verifiedAt, text, analysis }: Readonly<{
  chip: DashboardEtfSignalChip
  /** 来源快照的校验时刻。快照不可用时没有它，就不写这一行，不编一个时间。 */
  verifiedAt?: string
  text: EtfSignalText
  /** 「分析到哪一步」那一句，已由调用方按状态与原因投影成白话。 */
  analysis?: string
}>): React.ReactElement | null {
  const formatTime = useShellTimeFormat()
  if (chip.state !== 'alert') return null
  const rows: SignalDetailRow[] = [
    // 第一行是「这条分析会不会来、到哪一步」，读者点开牌子最先想知道的就是它。
    ...(analysis ? [{ labelKey: 'pages.intelligence.portal.dashboard.signalAnalysis.label', value: analysis }] : []),
    { labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailRule', value: text.signalRuleName },
    { labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailWindow', value: text.signalRuleWindow },
    { labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailCumulative', value: chip.cumulativeUsd },
    {
      labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailCoverage',
      value: fillLabelParams(text.signalCoverage, { covered: String(chip.coveredDays), required: String(chip.requiredDays) })
    },
    // 数据所属交易日是数据自身的日期，不是这次读取的时刻；UTC 口径写明在标签里。
    { labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailTradingDay', value: chip.observedAt.slice(0, 10) },
    ...(verifiedAt
      ? [{ labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailObservedAt', value: formatTime(verifiedAt) }]
      : [])
  ]
  return <SignalDetail
    id={ETF_SIGNAL_DETAIL_ID}
    titleKey="pages.intelligence.portal.dashboard.capitalConditions.signalDetailTitle"
    rows={rows}
    noteKey="pages.intelligence.portal.dashboard.capitalConditions.signalDetailNote" />
}
