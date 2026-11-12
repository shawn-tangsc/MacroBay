import { Button } from 'antd'
import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import type { BriefingPushText } from './dailyBriefingPushText'
import type { BriefingPushResultView } from './useBriefingPushToPhone'

/**
 * 「发布频道」的结果那一行（工具栏下方、卡顶固定区，跟工具栏一起不跟着纸滚动）。
 *
 * 三条结构：
 * - **正文只有数字与动作**：几句里没有任何通道名；
 * - **说明只进 ⓘ**：为什么不截断 / 为什么整条不发，以及逐通道「名字 · 发了什么 · 到没到」；
 * - **动作按顺序排在句后**：重试 / 只发文字 / 缩短导读，用平台 `Button` 与工具栏同一个类名
 *   （不另造按钮样式）。
 *
 * 降级（`kind: 'text'`）在逐行说明里是「只发了文字」——绝不写成「发了海报」。
 */
export function BriefingPushResultRow(props: Readonly<{
  result: BriefingPushResultView
  text: BriefingPushText
  onRetry: () => void
  onSendTextOnly: () => void
  onShortenLede?: (() => void) | undefined
}>): React.ReactElement {
  const { result, text } = props
  const channels = result.channels
  const detail = channels === undefined && result.why === undefined ? null : <Popover
    content={<div className="mi-daily-briefing__push-detail">
      {result.why === undefined ? null : <p className="mi-daily-briefing__push-why">{result.why}</p>}
      {channels === undefined ? null : <ul className="mi-daily-briefing__push-channels" data-push-channels="true">
        {channels.map((row, index) => <li className="mi-daily-briefing__push-channel" key={`${row.name}#${index}`}>
          <span className="mi-daily-briefing__push-channel-name">{row.name}</span>
          <span className="mi-daily-briefing__push-channel-detail">{row.detail}</span>
        </li>)}
      </ul>}
    </div>}
    trigger={(triggerProps) => <IconButton
      {...triggerProps}
      ariaLabelKey="ui.help.trigger"
      icon={Info}
      resolveText={(key: string) => key === 'ui.help.trigger' ? (channels === undefined ? text.explainLabel : text.channelsLabel) : ''}
      size="sm"
      variant="plain" />}
  />
  const run = (key: 'retry' | 'send-text-only' | 'shorten-lede'): void => {
    if (key === 'retry') props.onRetry()
    else if (key === 'send-text-only') props.onSendTextOnly()
    else props.onShortenLede?.()
  }
  // `role="status"` 只挂在**那一句话**上：整行里还有按钮，读屏不该把动作当成播报内容的一部分。
  return <div className="mi-daily-briefing__push-result" data-push-result="true">
    <span className="mi-daily-briefing__push-message" role="status">{result.message}</span>
    {detail}
    {result.actions.map((action) => <Button
      className="mi-briefing-tool__btn"
      data-push-action={action.key}
      key={action.key}
      onClick={() => run(action.key)}>
      {action.label}
    </Button>)}
  </div>
}
