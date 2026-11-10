import { Button } from 'antd'
import { CircleSlash, Info, TriangleAlert } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import '../../../shared/styles/sourceAvailability.css'
import type { NewsSentimentText } from './NewsSentimentCard'

/**
 * 舆情卡「来源不可用」的那一格：**三态统一形状的整卡版**。
 *
 * 规范：`docs-private/05-desktop/ui-audit/2026-11-11-source-availability-styles.md`。
 * 类名与颜色全走共享样式 `shared/styles/sourceAvailability.css`，调用点不写颜色、不写图标尺寸以外的样式。
 *
 * 这张卡只接两态，**不伪造第三态**：
 * - `disabled`：四个新闻源一个都没启用 → 「来源没有启用」+ 去启用；
 * - `unreadable`：源启用着但这次读不到（采集失败 / 还没跑过）→ 「暂时读不到」+ 再试一次，
 *   两种成因的区别写在 ⓘ 里；
 * - `missing`（还没配置来源）在这张卡上**不可达**：四个新闻源是内置注册表里的固定条目，
 *   读者没有「配置一个源」这个动作，所以不画一个永远出不来的状态。
 */
export type NewsSentimentAvailability = 'disabled' | 'unreadable'

export function NewsSentimentAvailabilityCard(props: Readonly<{
  state: NewsSentimentAvailability
  text: NewsSentimentText
  /** 原因（一句话）进 ⓘ；正文只留状态词。 */
  reason: string
  /** 主动作（每格至多一颗）：没给去处就不画按钮，留一颗点了没反应的是假控件。 */
  actionLabel: string
  onAction?: () => void
}>): React.ReactElement {
  const Icon = props.state === 'unreadable' ? TriangleAlert : CircleSlash
  const sentence = props.state === 'unreadable' ? props.text.availability.unreadable : props.text.availability.disabled
  return <div className="mi-source-card" data-state={props.state}>
    <p className="mi-source-state" data-state={props.state}>
      <Icon aria-hidden="true" className="mi-source-state__icon" size={14} />
      <span>{sentence}</span>
      <Popover
        content={<span>{props.reason}</span>}
        trigger={(triggerProps) => (
          <IconButton
            {...triggerProps}
            ariaLabelKey="news.sentiment.availability.reason"
            icon={Info}
            onSelect={() => undefined}
            resolveText={(key: string) => (key === 'news.sentiment.availability.reason' ? props.text.availability.reasonAria : '')}
            size="sm" />
        )} />
    </p>
    {props.onAction === undefined ? null : (
      <div className="mi-source-card__actions">
        <Button onClick={props.onAction} size="small">{props.actionLabel}</Button>
      </div>
    )}
  </div>
}
