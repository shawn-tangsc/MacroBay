import { useState } from 'react'

import { Drawer } from '@platform/ui/components/drawer'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { Tooltip } from '@platform/ui/components/tooltip'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import type { DashboardEtfSignalChip } from './capitalConditionsModel'

/**
 * 这条读数的文案：牌子、悬停解释、详情。
 *
 * 只用模块自己的白话词。规则名写成「ETF 净流出」，不出现 `etf-outflow-3d` 这类内部标识——
 * 牌子的详情是给读者看的，不是给我们对账的。
 */
export type EtfSignalText = {
  signalChip: string
  signalInsufficient: string
  signalInsufficientReason: string
  signalTooltip: string
  signalRuleName: string
  signalRuleWindow: string
  signalKindObserved: string
  signalAriaAlert: string
  signalDetailTitle: string
  signalDetailRule: string
  signalDetailWindow: string
  signalDetailCumulative: string
  signalDetailCoverage: string
  signalCoverage: string
  signalDetailTradingDay: string
  signalDetailObservedAt: string
  signalDetailNote: string
  signalDetailInsufficient: string
  signalInsufficientNote: string
}

type VisibleChip = Extract<DashboardEtfSignalChip, { state: 'alert' | 'insufficient' }>

/**
 * 资金面卡片标题旁的牌子，以及点开后的读数详情。
 *
 * 牌子只回答两件事：有没有事（画不画）、是什么事（一句话）。数字只在牌子与详情里各出现
 * 一次，且**全部取自规则算出的信号**——这里不做任何求和，所以卡片与通知不会各说一个数。
 * 数据不齐时一个数字都不出现：「拿不到」不许被画成「很小」。
 */
export function EtfOutflowSignal({ chip, verifiedAt, text }: Readonly<{
  chip: VisibleChip
  /** 来源快照的校验时刻。快照不可用时没有它，详情就不写这一行，不编一个时间。 */
  verifiedAt?: string
  text: EtfSignalText
}>): React.ReactElement {
  const [open, setOpen] = useState(false)
  const resolveText = useProductTextKey()
  const formatTime = useShellTimeFormat()
  const alert = chip.state === 'alert'
  const label = alert ? fillLabelParams(text.signalChip, { amount: chip.amountUsd }) : text.signalInsufficient
  // 读屏念完整一句：牌子词 + 资产，与可见文字同一事实，不缩写。
  const ariaLabel = alert
    ? fillLabelParams(text.signalAriaAlert, { chip: label, asset: chip.asset.toUpperCase() })
    : text.signalInsufficientReason

  return <>
    <Tooltip
      resolveText={resolveText}
      labelKey={alert
        ? 'pages.intelligence.portal.dashboard.capitalConditions.signalTooltip'
        : 'pages.intelligence.portal.dashboard.capitalConditions.signalInsufficientReason'}
      labelParams={alert
        ? { rule: text.signalRuleName, window: text.signalRuleWindow, kind: text.signalKindObserved }
        : undefined}>
      <button
        aria-label={ariaLabel}
        className="mi-capital-conditions__signal"
        data-state={chip.state}
        onClick={() => setOpen(true)}
        type="button">
        {alert ? null : <i aria-hidden="true" className="mi-capital-conditions__signal-dot" />}
        {label}
      </button>
    </Tooltip>
    <Drawer
      destroyOnHidden
      header="titled"
      mode="modal"
      onClose={() => setOpen(false)}
      open={open}
      resolveText={resolveText}
      size="narrow"
      titleKey="pages.intelligence.portal.dashboard.capitalConditions.signalDetailTitle">
      {alert
        ? <dl className="mi-capital-conditions__signal-detail">
            <div><dt>{text.signalDetailRule}</dt><dd>{text.signalRuleName}</dd></div>
            <div><dt>{text.signalDetailWindow}</dt><dd>{text.signalRuleWindow}</dd></div>
            <div><dt>{text.signalDetailCumulative}</dt><dd data-flow-direction="outflow">{chip.cumulativeUsd}</dd></div>
            <div><dt>{text.signalDetailCoverage}</dt><dd>{fillLabelParams(text.signalCoverage, { covered: String(chip.coveredDays), required: String(chip.requiredDays) })}</dd></div>
            <div><dt>{text.signalDetailTradingDay}</dt><dd>{chip.observedAt.slice(0, 10)}</dd></div>
            {verifiedAt ? <div><dt>{text.signalDetailObservedAt}</dt><dd>{formatTime(verifiedAt)}</dd></div> : null}
            <p>{text.signalDetailNote}</p>
          </dl>
        : <div className="mi-capital-conditions__signal-detail">
            <p>{text.signalDetailInsufficient}</p>
            <p>{text.signalInsufficientNote}</p>
          </div>}
    </Drawer>
  </>
}
