import { Button } from 'antd'
import { CircleDashed, CircleSlash, Info, TriangleAlert } from 'lucide-react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import '../../../shared/styles/sourceAvailability.css'
import type { NewsSentimentText } from './NewsSentimentCard'

/**
 * 舆情卡「来源不可用」：**卡框与标题照常，只在数据区上盖一层遮罩**。
 *
 * 规范：`docs-private/05-desktop/ui-audit/2026-11-11-source-availability-styles.md` §二 第 1 条。
 * 类名与颜色全走共享样式 `shared/styles/sourceAvailability.css`，调用点不写颜色、不造遮罩。
 *
 * 三态逐字取文案表（还没有配置来源 / 来源没有启用 / 暂时读不到）。其中 `missing` 今天投影产生不了：
 * 四个新闻源是注册表里的固定条目，读者没有「配置一个来源」的动作——文案留着是为了三态齐整，
 * 不为了假装它会发生。
 */
export type NewsSentimentAvailability = 'missing' | 'disabled' | 'unreadable'

const ICONS = { missing: CircleDashed, disabled: CircleSlash, unreadable: TriangleAlert } as const

export function NewsSentimentAvailabilityVeil(props: Readonly<{
  state: NewsSentimentAvailability
  text: NewsSentimentText
  /** 原因（一句话）进 ⓘ；遮罩正文只留状态词。 */
  reason: string
  /** 主动作（遮罩里**恰一颗**）：没给去处就不画，留一颗点了没反应的是假控件。 */
  actionLabel: string
  onAction?: () => void
}>): React.ReactElement {
  const Icon = ICONS[props.state]
  return <div className="mi-source-veil" data-state={props.state}>
    <p className="mi-source-state" data-state={props.state}>
      <Icon aria-hidden="true" className="mi-source-state__icon" size={14} />
      <span>{props.text.availability[props.state]}</span>
      <Popover
        content={<span>{props.reason}</span>}
        trigger={(triggerProps) => (
          <IconButton
            {...triggerProps}
            ariaLabelKey="news.sentiment.availability.reason"
            icon={Info}
            onSelect={() => undefined}
            variant="plain"
            resolveText={(key: string) => (key === 'news.sentiment.availability.reason' ? props.text.availability.reasonAria : '')}
            size="sm" />
        )} />
    </p>
    {props.onAction === undefined ? null : <Button onClick={props.onAction} size="small">{props.actionLabel}</Button>}
  </div>
}
