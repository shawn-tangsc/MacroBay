import { Button } from 'antd'
import { CircleDashed, CircleSlash, Info, TriangleAlert } from 'lucide-react'
import type { ReactElement } from 'react'

import { IconButton } from '@platform/ui/components/icon-button'
import { Popover } from '@platform/ui/components/popover'
import { STATE_VIEW_ACTION_KEYS, StateView } from '@platform/ui/components/state'

import type { PositioningCellReason, PositioningCellState } from '../../../pages/intelligence/dashboardPositioningSourceState'
import type { PositioningPanelText } from './positioningText'

// 三态的唯一实现：形态与颜色都在共享样式表里，这两个模块只引用类名，不写颜色、不覆写内部规则。
import '../../../shared/styles/sourceAvailability.css'

/**
 * 持仓卡两格的源可用性怎么画（三态：未配置 / 未启用 / 读不到）。
 *
 * 归属**按形态**定（用户 2026-11-11）：格级、行级 → 共享可用性卡（`.mi-source-*`）；
 * 整卡级（两格一个可用都没有）→ 平台 `StateView`。判定不在这里——它来自
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
 * 整卡三态（两格一个可用都没有）：落平台六态。
 *
 * - 没配置 → `empty · none-installed`，产品句「还没有配置来源」，动作「打开设置」；
 * - 没启用 → `disabled · target-disabled`，产品句点名是哪个源，动作「去启用」；
 * - 读不到 → `error · unreadable`，产品句「暂时读不到」，一颗「重试」，原因进 `details`（默认折叠）。
 *
 * 动作标签是平台键表的闭集（`ui.state.action.*`），所以这里是「打开设置 / 去启用 / 重试」——
 * 格级那句「去配置」不进整卡：两套词会把同一个入口说成两件事。
 */
export function WholeCardStateView({ state, text, reason, onOpenSources, retry, resolveText }: Readonly<{
  state: 'missing' | 'disabled' | 'unreadable'
  text: PositioningPanelText
  reason?: PositioningCellReason
  onOpenSources: () => void
  retry: () => void
  resolveText: (key: string) => string
}>): ReactElement {
  if (state === 'missing') {
    return <StateView state="empty" reasonCode="none-installed" size="md"
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.open_settings, onSelect: onOpenSources }}
      productReason={{ key: 'mi.positioning.card-no-source', resolve: () => text.sourceMissing }} />
  }
  if (state === 'disabled') {
    return <StateView state="disabled" reasonCode="target-disabled" size="md"
      action={{ labelKey: STATE_VIEW_ACTION_KEYS.enable, onSelect: onOpenSources }}
      productReason={{
        key: 'mi.positioning.card-not-enabled',
        resolve: () => text.sourceDisabled.replace('{source}', text.sourceName)
      }} />
  }
  return <StateView state="error" reasonCode="unreadable" size="md"
    action={{ labelKey: STATE_VIEW_ACTION_KEYS.retry, onSelect: retry }}
    productReason={{ key: 'mi.positioning.card-unreadable', resolve: () => text.sourceUnreadable }}
    {...(reason ? { details: { bodyText: resolveText(positioningSourceReasonKeys[reason]) } } : {})} />
}

/** 单格：另半照常显示，这一格用一行说清，配一颗主动作（不是灰按钮）。 */
export function SourceCellLine({ label, state, reason, text, action, resolveText }: Readonly<{
  label: string
  state: PositioningCellState
  reason?: PositioningCellReason
  text: PositioningPanelText
  action?: SourceAction
  resolveText: (key: string) => string
}>): ReactElement {
  return (
    <div className="mi-source-row" data-state={state} data-positioning-source-cell={state} aria-disabled="true">
      <span className="mi-positioning-panel__source-label">{label}</span>
      <span className="mi-source-state" data-state={state}>
        <SourceStateIcon state={state} />
        {sourceSentence(state, text)}
        {state === 'unreadable' && reason ? <SourceReason reason={reason} resolveText={resolveText} /> : null}
      </span>
      {action ? <Button type="link" size="small" onClick={action.onSelect}>{action.label}</Button> : null}
    </div>
  )
}
