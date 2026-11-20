import { Button } from 'antd'
import { Info, X } from 'lucide-react'
import { useState } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { StatusPill, type StatusPillTone } from '@platform/ui/components/status-pill'

import type { BriefingPushText } from './dailyBriefingPushText'
import type { BriefingPushActionKey, BriefingPushResultRow, BriefingPushResultView } from './useBriefingPushToPhone'

/**
 * 日报「发布频道」的结果条（界面设计 2026-11-12 定稿，原型 `2026-11-12-briefing-publish-result-strip`）。
 *
 * 位置：工具栏**下方**、内容区顶部，与工具栏同级——不塞进工具栏（结果长度会变，塞进去会让工具栏
 * 高度随结果跳、右侧按钮跟着位移）。常驻到下一次发布；下一次发布替换同一条，不叠加。可手动关闭，
 * 不自动消失，离开这一屏不保留（它是这次发布的事实，不写回历史）。
 *
 * 形态：1px 边框 + 左侧 3px 色条（与 `InlineNotice` 同一套外观与三档 token）+ 三件：
 * 摘要一行 / 最多一颗行内文字动作 / 可展开的逐通道明细。
 *
 * 明细的折叠沿用多通道那条规矩：**失败与等回执永远可见，只折叠「收到」的**。
 * 原因码折叠在每一行里；摘要里没有通道名，也没有原因码。
 */
export function BriefingPushResultStrip(props: Readonly<{
  result: BriefingPushResultView
  text: BriefingPushText
  /** 产品文案表的解析器（`useProductTextKey()`）：读屏名传完整路径，句子由它给。 */
  resolveText: (key: string) => string
  onAction: (key: BriefingPushActionKey) => void
  onClose: () => void
}>): React.ReactElement {
  const { result, text } = props
  // 默认展开（原型行为）；读者收起来之后只留「没到 / 等回执」。
  const [detailOpen, setDetailOpen] = useState(true)
  const sending = result.sending === true
  const received = result.rows.filter((row) => row.outcome === 'received')
  const essential = result.rows.filter((row) => row.outcome !== 'received')
  const visible = [...essential, ...(detailOpen ? received : [])]
  return <div className={`mi-daily-briefing__push-result mi-daily-briefing__push-result--${result.tone}`}
    data-push-result="true" data-tone={result.tone}>
    <div className="mi-daily-briefing__push-result-head">
      <span className="mi-daily-briefing__push-summary" role="status">{result.summary}</span>
      <span className="mi-daily-briefing__push-result-spacer" />
      {/* 句内动作只有一种写法：antd 文本档 + `.text-action`（颜色取 `--accent`）。
          链接档走 antd 的 `colorLink`，那是 token 之外的第二个人工交互色，全仓已不许再用。 */}
      {result.action === undefined ? null : <Button
        className="text-action"
        data-push-action={result.action.key}
        onClick={() => props.onAction(result.action!.key)}
        size="small"
        type="text">
        {result.action.label}
      </Button>}
      {result.action?.tip === undefined ? null : <Popover
        content={<span>{result.action.tip}</span>}
        trigger={(triggerProps) => <IconButton
          {...triggerProps}
          ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.push.actionInfoLabel"
          icon={Info}
          resolveText={props.resolveText}
          size="sm"
          variant="plain" />}
      />}
      {sending || result.rows.length === 0 ? null : <Button
        className="text-action"
        data-push-toggle="true"
        onClick={() => setDetailOpen((open) => !open)}
        size="small"
        type="text">
        {detailOpen ? text.toggleClose : text.toggleOpen}
      </Button>}
      {sending ? null : <Popover
        content={<span>{text.stripInfoTip}</span>}
        trigger={(triggerProps) => <IconButton
          {...triggerProps}
          ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.push.stripInfoLabel"
          icon={Info}
          resolveText={props.resolveText}
          size="sm"
          variant="plain" />}
      />}
      {sending ? null : <IconButton
        ariaLabelKey="pages.intelligence.portal.dashboard.dailyBriefing.push.closeStrip"
        icon={X}
        onSelect={props.onClose}
        resolveText={props.resolveText}
        size="sm"
        variant="plain" />}
    </div>
    {visible.length === 0 ? null : <div className="mi-daily-briefing__push-result-lines" data-push-lines="true">
      {visible.map((row, index) => <PushResultLine
        key={`${row.name}#${index}`}
        resolveText={props.resolveText}
        row={row}
        text={text} />)}
    </div>}
  </div>
}

/** 一行通道：名字 / 结果 / 形态 / 人话原因 + 折叠的原因码。 */
function PushResultLine(props: Readonly<{
  row: BriefingPushResultRow
  text: BriefingPushText
  resolveText: (key: string) => string
}>): React.ReactElement {
  const { row, text } = props
  const form = row.form === 'poster' ? text.channelImage : row.form === 'text' ? text.channelText : text.rowNoForm
  return <div className="mi-daily-briefing__push-line" data-push-line={row.outcome}>
    <span className="mi-daily-briefing__push-line-name">{row.name}</span>
    {/* 三档结果是**状态词**，按平台规矩交给 `StatusPill`：档位色只落在圆点与描边上，字始终是正文色。
        `--danger` 当正文前景在深色下只有 3.25–3.94（正文门槛 4.5），门禁不许为一种 outcome 新造一个
        红色文字选择器；复用这个组件既保住「没到＝危险档」，也不用新增颜色基线。 */}
    <span className="mi-daily-briefing__push-line-outcome" data-outcome={row.outcome}>
      <StatusPill
        labelKey={outcomeLabelKey(row.outcome)}
        resolveText={props.resolveText}
        tone={outcomeTone(row.outcome)} />
    </span>
    <span className="mi-daily-briefing__push-line-form">{form}</span>
    <span className="mi-daily-briefing__push-line-reason">
      {row.reason ?? ''}
      {row.reasonCode === undefined ? null : <details className="mi-daily-briefing__push-code">
        <summary>{text.rowCodeLabel}</summary>
        <code>{row.reasonCode}</code>
      </details>}
    </span>
  </div>
}

/** 状态词与档位：收到 ok、没到 bad（危险档）、等回执 info（进行中）。 */
function outcomeTone(outcome: BriefingPushResultRow['outcome']): StatusPillTone {
  return outcome === 'received' ? 'ok' : outcome === 'pending' ? 'info' : 'bad'
}

/** 三个状态词在产品文案表里的完整路径（可见文案与读屏名同一张表）。 */
function outcomeLabelKey(outcome: BriefingPushResultRow['outcome']): string {
  return outcome === 'received'
    ? 'pages.intelligence.portal.dashboard.dailyBriefing.push.rowReceived'
    : outcome === 'pending'
      ? 'pages.intelligence.portal.dashboard.dailyBriefing.push.rowPending'
      : 'pages.intelligence.portal.dashboard.dailyBriefing.push.rowNotReceived'
}
