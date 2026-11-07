import { ChevronRight, Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Modal } from '@platform/ui/components/modal'
import { Popover } from '@platform/ui/components/popover'
import { StatusPill } from '@platform/ui/components/status-pill'
import { fillLabelParams } from '@platform/ui/components/textKeyParams'
import { Tooltip } from '@platform/ui/components/tooltip'
import { useShellTimeFormat } from '@platform/ui/time/useShellTimeFormat'

import { useProductTextKey } from '../../../shared/i18n/productTextKey'
import { SignalDetail, SignalReadIssue, type SignalDetailGroup } from '../shared'
import type { DashboardEtfSignalChip } from './capitalConditionsModel'

import './capitalSignalDialog.css'

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
  /** 牌子作为入口时的读屏名模板：可见文字在前，再说明点开会做什么。 */
  signalChipOpen: string
  /** 说明图标的读屏名：它解释的那个东西 + 「说明」。 */
  signalDetailHelpLabel: string
  signalInsufficientHelpLabel: string
  signalDetailRule: string
  signalDetailWindow: string
  signalDetailCumulative: string
  signalDetailCoverage: string
  signalCoverage: string
  signalDetailTradingDay: string
  signalDetailObservedAt: string
  signalDetailNote: string
  /** 弹层标题：点开之后这叫什么。 */
  signalDetailDialogTitle: string
  signalDetailGroupAnalysis: string
  signalDetailGroupReadings: string
  signalDetailGroupTime: string
}

/** 展开块的 id：牌子的 `aria-controls` 指向它，一张卡上只有这一块。 */
export const ETF_SIGNAL_DETAIL_ID = 'mi-capital-conditions-signal-detail'

type VisibleChip = Extract<DashboardEtfSignalChip, { state: 'alert' | 'insufficient' | 'unreadable' }>

/**
 * 资金面卡片标题旁的牌子，同时也是「口径与来源」的入口。
 *
 * 有命中时它是**按钮**，不是一块会点的文字：回车与空格能开（原生 `button` 给的），
 * `aria-haspopup="dialog"` 说清点开是什么，`aria-expanded` 跟着弹层真实开合。
 * 它同时挂着悬停/聚焦说明（规则、窗口、这是事实）——同一元素既要弹说明又要响应点击，
 * 所以这里只用原生 `button`：不接 `IconButton` 那种「内部先 onClick 再 onSelect」的两段语义，
 * 也就不存在两条路各切一次。
 *
 * **数据不齐是陈述，不是控件**：背后没有可解释的读数，也就不开弹层（不是画一颗点了没用的按钮）。
 */
export function EtfOutflowChip({ chip, text, onToggle, triggerRef, onRetry }: Readonly<{
  chip: VisibleChip
  text: EtfSignalText
  onToggle: () => void
  /** 关掉弹层后焦点要回到这里，读者不能掉回页面顶部。 */
  triggerRef?: React.RefObject<HTMLButtonElement | null>
  /** Re-reads the card; only a retryable failure offers it. */
  onRetry: () => void
}>): React.ReactElement | null {
  const resolveText = useProductTextKey()

  // 读不到只留一个标记：一句话在悬停/聚焦里，正面上没有那行字。
  if (chip.state === 'unreadable') {
    return <SignalReadIssue failureCode={chip.failureCode} resolveText={resolveText} />
  }

  if (chip.state !== 'alert') {
    // 「数据不齐」本身是陈述，不做控件；解释它的那句话收进一颗 ⓘ（平台 IconButton + Popover，
    // 与卡上其它说明同一实现）：Tooltip 没有钉住态，点了没反应就是「死按钮」。
    return <>
      <StatusPill
        labelKey="pages.intelligence.portal.dashboard.capitalConditions.signalInsufficient"
        resolveText={resolveText}
        tone="warn" />
      <Popover
        lines={[{ labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalInsufficientReason' }]}
        resolveText={resolveText}
        trigger={triggerProps => (
          <IconButton
            {...triggerProps}
            ariaLabelKey="pages.intelligence.portal.dashboard.capitalConditions.signalInsufficientHelpLabel"
            icon={Info}
            resolveText={resolveText}
            size="sm"
            variant="plain" />
        )} />
    </>
  }

  const label = fillLabelParams(text.signalChip, { amount: chip.amountUsd })
  // 可见文字在前：label-in-name 成立，读屏念的和眼睛看到的是同一句读数，后面才说点开会怎样。
  const openLabel = fillLabelParams(text.signalChipOpen, { chip: label })

  return <Tooltip
    resolveText={resolveText}
    labelKey="pages.intelligence.portal.dashboard.capitalConditions.signalTooltip"
    labelParams={{ rule: text.signalRuleName, window: text.signalRuleWindow, kind: text.signalKindObserved }}>
    <button
      aria-haspopup="dialog"
      aria-label={openLabel}
      className="mi-capital-conditions__signal"
      data-state="alert"
      onClick={onToggle}
      ref={triggerRef}
      type="button">
      {label}
      {/* 只有「点开有东西」这一个意思：不是第二颗按钮，也不抢金额的注意力。 */}
      <ChevronRight aria-hidden="true" className="mi-capital-conditions__signal-chevron" size={6} strokeWidth={2} />
    </button>
  </Tooltip>
}

/**
 * 牌子旁边那句「口径与来源」打开的弹层。
 *
 * 这段内容是解释，不是读数：8 行分三组，常驻会把卡片撑高、还逼读者每天先扫过它。所以它整段
 * 搬进一个可关闭的 `dialog`，卡面上只留一句有文字的入口——**入口没有信号就不渲染**，因为数据
 * 不齐时没有可解释的读数，给入口等于给空盒子。
 *
 * 三组照规范：这次分析（只在这句存在时出现）／读数／时间与来源，最底一句落款与读数之间有一条
 * 分隔线，免得读者把落款当成第五条读数。缺值整行不出现，不写「—」，也不编时间。
 */
export function EtfSignalDetailDialog({ open, onClose, chip, verifiedAt, text, analysis }: Readonly<{
  open: boolean
  onClose: () => void
  chip: DashboardEtfSignalChip
  /** 来源快照的校验时刻。快照不可用时没有它，就不写这一行，不编一个时间。 */
  verifiedAt?: string
  text: EtfSignalText
  /** 「分析到哪一步」那一句，已由调用方按状态与原因投影成白话。 */
  analysis?: string
}>): React.ReactElement | null {
  const formatTime = useShellTimeFormat()
  const resolveText = useProductTextKey()
  // 没有信号就没有可解释的读数；渲染了也只是个空盒子。
  if (chip.state !== 'alert') return null

  const groups: SignalDetailGroup[] = [
    ...(analysis
      ? [{
          labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailGroupAnalysis',
          rows: [{ labelKey: 'pages.intelligence.portal.dashboard.signalAnalysis.label', value: analysis }]
        }]
      : []),
    {
      labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailGroupReadings',
      rows: [
        { labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailRule', value: text.signalRuleName },
        { labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailWindow', value: text.signalRuleWindow },
        { labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailCumulative', value: chip.cumulativeUsd },
        {
          labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailCoverage',
          value: fillLabelParams(text.signalCoverage, { covered: String(chip.coveredDays), required: String(chip.requiredDays) })
        }
      ]
    },
    {
      labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailGroupTime',
      rows: [
        // 数据所属交易日是数据自身的日期，不是这次读取的时刻；UTC 口径写明在标签里。
        { labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailTradingDay', value: chip.observedAt.slice(0, 10) },
        ...(verifiedAt
          ? [{ labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailObservedAt', value: formatTime(verifiedAt) }]
          : [])
      ]
    }
  ]

  return <Modal
    className="mi-capital-signal-dialog"
    onClose={onClose}
    open={open}
    resolveText={resolveText}
    titleKey="pages.intelligence.portal.dashboard.capitalConditions.signalDetailDialogTitle"
    width="standard">
    {/* 正文自己滚：标题与关闭键不动，8 行以上也不会把窗口顶出屏幕。 */}
    <div className="mi-capital-signal-dialog__body">
      {/* 元说明只有一处：标题行尾的一颗 ⓘ，悬停/聚焦打开；正文只留读数、流水与时间。
          这是用户的通用规则——说明性文字不许作为正文铺开（界面 2026-11-08，与背离卡同一形态）。 */}
      <div className="mi-capital-signal-dialog__head">
        <Popover
          lines={[{ labelKey: 'pages.intelligence.portal.dashboard.capitalConditions.signalDetailNote' }]}
          resolveText={resolveText}
          trigger={triggerProps => (
            <IconButton
              {...triggerProps}
              ariaLabelKey="pages.intelligence.portal.dashboard.capitalConditions.signalDetailHelpLabel"
              icon={Info}
              resolveText={resolveText}
              size="sm"
              variant="plain" />
          )} />
      </div>
      <SignalDetail
        groups={groups}
        id={ETF_SIGNAL_DETAIL_ID}
        titleKey="pages.intelligence.portal.dashboard.capitalConditions.signalDetailDialogTitle" />
    </div>
  </Modal>
}
