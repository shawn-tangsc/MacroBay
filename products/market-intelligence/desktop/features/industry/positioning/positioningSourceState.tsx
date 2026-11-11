import { Button } from 'antd'
import { CircleDashed, CircleSlash, Info, TriangleAlert } from 'lucide-react'
import type { ReactElement } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'

import type { PositioningCellReason, PositioningCellState } from '../../../pages/intelligence/dashboardPositioningSourceState'
import type { PositioningPanelText } from './positioningText'

// 三态的唯一实现：形态与颜色都在共享样式表里，这两个模块只引用类名，不写颜色、不覆写内部规则。
import '../../../shared/styles/sourceAvailability.css'

/**
 * 持仓卡两格的源可用性怎么画（三态：未配置 / 未启用 / 读不到，外加「没有数据」）。
 *
 * 形态（用户 2026-11-11）：**卡片骨架不消失**——有数据时的行位、车道与基准线，没数据时照样在，
 * 状态句与动作落在这条结构行上，不把整块换成一整片空白加一句话。判定不在这里——它来自
 * `dashboardPositioningSourceState.ts` 的投影，这个文件只负责画。
 */

/** 三种状态各一个键：字面量表，拼串会绕开守卫。 */
export const positioningSourceReasonKeys: Readonly<Record<PositioningCellReason, string>> = Object.freeze({
  'contract-mismatch': 'pages.intelligence.portal.dashboard.positioning.contractMismatch',
  'invalid-clock': 'pages.intelligence.portal.dashboard.positioning.sourceReasonClock',
  'query-failed': 'pages.intelligence.portal.dashboard.positioning.sourceReasonQuery'
})

export type SourceAction = Readonly<{ label: string; onSelect: () => void }>

/**
 * 一格一颗主动作。未配置 / 未启用都去「设置 → 情报源」；读不到才是再试一次。
 * 没有对应入口时宁可不给按钮，也不给一颗点了没反应的按钮。
 */
export function sourceActionFor(
  state: PositioningCellState,
  text: PositioningPanelText,
  handlers: Readonly<{ openSources?: () => void; retry?: () => void }>
): SourceAction | undefined {
  if (state === 'missing') return handlers.openSources ? { label: text.actionConfigure, onSelect: handlers.openSources } : undefined
  if (state === 'disabled') return handlers.openSources ? { label: text.actionEnable, onSelect: handlers.openSources } : undefined
  return handlers.retry ? { label: text.actionRetry, onSelect: handlers.retry } : undefined
}

/** 那一句状态词：三态各说各的，谁也不冒充谁。 */
function sourceSentence(state: PositioningCellState, text: PositioningPanelText): string {
  return state === 'missing'
    ? text.sourceMissing
    : state === 'disabled'
      ? text.sourceDisabled.replace('{source}', text.sourceName)
      : text.sourceUnreadable
}

/** 图标：未配置 / 未启用都用 muted；只有读不到那枚是 danger（颜色在共享样式表里）。 */
function SourceStateIcon({ state }: Readonly<{ state: PositioningCellState }>): ReactElement | null {
  if (state === 'missing') return <CircleDashed aria-hidden className="mi-source-state__icon" size={14} />
  if (state === 'disabled') return <CircleSlash aria-hidden className="mi-source-state__icon" size={14} />
  return <TriangleAlert aria-hidden className="mi-source-state__icon" size={14} />
}

/** 读不到时那颗 ⓘ：原因不在正文里铺开，点开看一句。 */
function SourceReason({ reason, resolveText }: Readonly<{ reason: PositioningCellReason; resolveText: (key: string) => string }>): ReactElement {
  return (
    <Popover lines={[{ labelKey: positioningSourceReasonKeys[reason] }]} resolveText={resolveText}
      trigger={triggerProps => (
        <IconButton {...triggerProps}
          ariaLabelKey="pages.intelligence.portal.dashboard.positioning.sourceReasonLabel"
          icon={Info} resolveText={resolveText} size="sm" variant="plain" />
      )} />
  )
}

/**
 * 一格状态的那一行（未配置 / 未启用 / 读不到 / 没有数据）：落在结构里，不整块替换卡片。
 *
 * 用户 2026-11-11：不可用时不要「一大片空白只飘一句话」——有数据时那块长什么样（行位、车道、
 * 基准线），没数据时骨架还得在；状态句与动作就落在这条结构行上。三态与「没有数据」共用这一条。
 */
export type SourceStateLineView = Readonly<{
  state: PositioningCellState | 'empty'
  reason?: PositioningCellReason
  /** 这一行说的是哪一格（持仓名义额 / 资金费率）；整卡都不用时省略：同源，一句就够。 */
  label?: string
  /** 覆盖默认状态句：形状不符时说那句「完全退出重开」，不是「暂时读不到」。 */
  sentence?: string
  action?: SourceAction
}>

/** 一格一颗主动作；没有出口时宁可不给按钮，也不给一颗点了没反应的按钮。 */
export function cellStateAction(input: Readonly<{
  state: PositioningCellState | 'empty'
  reason?: PositioningCellReason
  text: PositioningPanelText
  openSources?: () => void
  retry?: () => void
  /** 形状/版本不符的唯一出口：完全退出后重开（重试必然再失败）。 */
  restart?: SourceAction
}>): SourceAction | undefined {
  if (input.state === 'empty') return undefined
  if (input.state === 'unreadable' && input.reason === 'contract-mismatch') return input.restart
  return sourceActionFor(input.state, input.text, {
    ...(input.openSources ? { openSources: input.openSources } : {}),
    ...(input.retry ? { retry: input.retry } : {})
  })
}

export function SourceStateLine({ view, text, resolveText }: Readonly<{
  view: SourceStateLineView
  text: PositioningPanelText
  resolveText: (key: string) => string
}>): ReactElement {
  // 没有数据不是三态之一：句子走产品自己那句「确实没有」，图标与「没配置」同一条 muted 线。
  const sentence = view.sentence ?? (view.state === 'empty' ? text.empty : sourceSentence(view.state, text))
  const tone: PositioningCellState = view.state === 'empty' ? 'missing' : view.state
  return (
    <div className="mi-positioning-panel__source-note" data-positioning-source-cell={view.state}>
      {view.label ? <span className="mi-positioning-panel__label">{view.label}</span> : null}
      <span className="mi-source-state" data-state={tone}>
        <SourceStateIcon state={tone} />
        {sentence}
        {view.state === 'unreadable' && view.reason && view.sentence === undefined
          ? <SourceReason reason={view.reason} resolveText={resolveText} />
          : null}
      </span>
      {view.action ? <Button type="link" size="small" onClick={view.action.onSelect}>{view.action.label}</Button> : null}
    </div>
  )
}
