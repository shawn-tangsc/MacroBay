import { Info } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import type { SendStatusCopy } from './analysisConclusionSendCopy'

import './analysisConclusionSend.css'

/**
 * 标题行下方那条说明行（定稿：muted、`role="status"`、**只在有结果时出现**、不弹 toast）。
 *
 * 三条规矩：
 * - **发送中不出现**：按钮自己已经转着圈说「正在发送」，同一件事不设两个等待指示。
 * - **正文只有数字、没有通道名**：几条收到、几条没到由 `describeSendStatus` 拼好，这里不二次加工。
 * - **逐条原因只进 ⓘ 浮层**：按通道一行「名字 · 人话原因」，**原因码不上屏**；没有回执通道行
 *   （老记录、被压下、只在应用内）就不画这颗图标，也不留空气泡。多行说明用平台 `Popover`，
 *   不自己拼浮层——开合、Esc、焦点归还都是它的。
 */
export function AnalysisConclusionSendStatus(props: Readonly<{
  status: SendStatusCopy
  /**
   * ⓘ 的读屏名**键**（`ANALYSIS_SEND_CHANNELS_LABEL_KEY`），短名由 `resolveText` 解析。
   * 不收已经解析好的句子：那样 `ariaLabelKey` 只能借一个哨兵键，键与名字就对不上了。
   */
  ariaLabelKey: string
  resolveText: (key: string) => string
}>): React.ReactElement {
  const channels = props.status.channels
  return <div className="mi-analysis-send__status-row">
    <p className="mi-analysis-send__status" role="status">{props.status.message}</p>
    {channels === undefined || channels.length === 0 ? null : <Popover
      content={<ul className="mi-analysis-send__channel-list" data-send-channels="true">
        {channels.map((row, index) => <li className="mi-analysis-send__channel" key={`${row.name}#${index}`}>
          <span className="mi-analysis-send__channel-name">{row.name}</span>
          <span className="mi-analysis-send__channel-detail">{row.detail}</span>
        </li>)}
      </ul>}
      trigger={(triggerProps) => <IconButton
        {...triggerProps}
        ariaLabelKey={props.ariaLabelKey}
        icon={Info}
        resolveText={props.resolveText}
        size="sm"
        variant="plain" />}
    />}
  </div>
}
