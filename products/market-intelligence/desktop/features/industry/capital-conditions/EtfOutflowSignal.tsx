import { StatusPill } from '@platform/ui/components/status-pill'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { Tooltip } from '@platform/ui/components/tooltip'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'
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

type VisibleChip = Extract<DashboardEtfSignalChip, { state: 'alert' | 'insufficient' }>

/**
 * 资金面卡片标题旁的牌子。
 *
 * 牌子只回答两件事：有没有事（画不画）、是什么事（一句话）。有事是按钮，点开在卡片内展开
 * 读数（`aria-expanded` / `aria-controls`，再点收起，焦点留在牌子上）；**数据不齐是陈述，
 * 不是控件**——它背后没有可展开的读数，做成按钮只会让读者点了个空。两种状态都带悬停/聚焦
 * 解释：有事说有规则、窗口、这是事实；不齐说清缺哪一路。
 */
export function EtfOutflowChip({ chip, open, text, onToggle }: Readonly<{
  chip: VisibleChip
  open: boolean
  text: EtfSignalText
  onToggle: () => void
}>): React.ReactElement {
  const resolveText = useProductTextKey()

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
      aria-controls={ETF_SIGNAL_DETAIL_ID}
      aria-expanded={open}
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
 * 点在牌子上展开的读数：落在标题行下、卡片内容上，与持仓牌子的落点一致。
 *
 * 数字全部取自规则算出的信号，这里不做任何求和；数据所走的字段、取数与 `19cb59d` 一致。
 * 数据不齐的牌子没有可展开的东西，本组件对它返回 `null`。
 */
export function EtfOutflowDetail({ chip, verifiedAt, text }: Readonly<{
  chip: DashboardEtfSignalChip
  /** 来源快照的校验时刻。快照不可用时没有它，就不写这一行，不编一个时间。 */
  verifiedAt?: string
  text: EtfSignalText
}>): React.ReactElement | null {
  const formatTime = useShellTimeFormat()
  if (chip.state !== 'alert') return null
  return <dl className="mi-capital-conditions__signal-detail" id={ETF_SIGNAL_DETAIL_ID}>
    <div><dt>{text.signalDetailRule}</dt><dd>{text.signalRuleName}</dd></div>
    <div><dt>{text.signalDetailWindow}</dt><dd>{text.signalRuleWindow}</dd></div>
    <div><dt>{text.signalDetailCumulative}</dt><dd data-flow-direction="outflow">{chip.cumulativeUsd}</dd></div>
    <div><dt>{text.signalDetailCoverage}</dt><dd>{fillLabelParams(text.signalCoverage, { covered: String(chip.coveredDays), required: String(chip.requiredDays) })}</dd></div>
    <div><dt>{text.signalDetailTradingDay}</dt><dd>{chip.observedAt.slice(0, 10)}</dd></div>
    {verifiedAt ? <div><dt>{text.signalDetailObservedAt}</dt><dd>{formatTime(verifiedAt)}</dd></div> : null}
    <p>{text.signalDetailNote}</p>
  </dl>
}
