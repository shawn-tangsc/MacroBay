import type { ReactElement, ReactNode } from 'react'

import type { StateSize } from '../empty-state'
import { LoadingState } from '../loading'

import './stateView.css'

/**
 * 六态统一状态视图（契约：`docs-private/05-desktop/ui-state-components-contract.md` §13）。
 *
 * 取代 `EmptyState` / `ErrorState` / `DisabledHint`。组件内**零文案、零 i18n**：标题与原因句
 * 只收键，句子由调用方经 `resolveText` 解析；图标由本文件一张表按 `state` 决定，**不收 `icon`**
 * （收图标等于允许同一状态两种图标，`disabled` 与 `permission` 的轮廓判据当场作废）。
 *
 * `state` 是判别联合不是平铺对象，`reasonCode` 是按状态分家的闭集：`<StateView state="empty" />`
 * 与「empty 配 error 的码」都编译不过，否则就会落回一句兜底文案——而那正是「暂无数据」的撒谎方式。
 *
 * 动作位按「读者能不能自己解决」定，不是按状态定：
 * - `empty · not-yet`、`disabled · capability-not-wired`：读者没有可做的动作，**不许传入动作**；
 * - `empty` 其余码、`disabled · target-disabled`：必须给一个点了就能解决的动作；
 * - `permission`：本批一律不给动作——本地单用户版没有「管理员」这个人，点了就是死路；
 * - `error`：动作可选（能重试就给，不能就别给假按钮）。
 *
 * 播报：**只有 `error` 进 live region**，且只包标题与原因。`role="alert"` 是 assertive，会打断
 * 正在朗读的内容并把按钮一起念出来，所以用 `status` + `polite`。`empty` / `disabled` /
 * `permission` 不播报；`loading` 由 `LoadingState` 自己播报，这里不再包一层，否则读屏念两遍。
 */

export const STATE_VIEW_STATES = ['normal', 'loading', 'empty', 'error', 'disabled', 'permission'] as const

export type StateViewState = (typeof STATE_VIEW_STATES)[number]

/**
 * `ui.state.*` 的键是闭集：句子在全仓唯一一份文案表（`platformText.ts` 的 `uiState`），
 * 组件与产品都不造句。新增一个键＝契约变更：先经架构师批准，再同笔补两语言。
 */
export const STATE_VIEW_TEXT_KEYS = [
  'ui.state.loading',
  'ui.state.empty',
  'ui.state.empty.reason.never-created',
  'ui.state.empty.reason.filtered-out',
  'ui.state.empty.reason.no-target-bound',
  'ui.state.empty.reason.nothing-enabled',
  'ui.state.empty.reason.not-yet',
  'ui.state.error',
  'ui.state.error.reason.unreadable',
  'ui.state.error.reason.unavailable',
  'ui.state.error.details',
  'ui.state.disabled',
  'ui.state.disabled.reason.capability-not-wired',
  'ui.state.disabled.reason.target-disabled',
  'ui.state.permission',
  'ui.state.permission.reason.not-granted',
  'ui.state.action.create',
  'ui.state.action.clear-filter',
  'ui.state.action.bind-target',
  'ui.state.action.enable',
  'ui.state.action.retry',
  'ui.state.action.check-source',
  'ui.state.action.grant',
  'ui.state.action.open-settings',
  'ui.state.action.contact-admin'
] as const

export type StateViewTextKey = (typeof STATE_VIEW_TEXT_KEYS)[number]

/** 尺寸词只有一个来源：`StateSize`（§3）。这里只给并行的旧名字一个落点，语义不变。 */
export type StateViewSize = StateSize

export type StateViewAction = {
  /** 动作文案的 i18n 键；不收字面量。 */
  labelKey: string
  onSelect: () => void
}

type StateViewBase = {
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传 `(key) => key`）。 */
  resolveText: (key: string) => string
  /** 尺寸词只有一个来源（§3）：`lg` 整页 220、`md` 卡内 80、`sm` 本批不开放。 */
  size?: StateSize
  className?: string
}

export type EmptyReasonCode =
  | 'never-created'
  | 'filtered-out'
  | 'no-target-bound'
  | 'nothing-enabled'
  | 'not-yet'

export type ErrorReasonCode = 'unreadable' | 'unavailable'
export type DisabledReasonCode = 'capability-not-wired' | 'target-disabled'
export type PermissionReasonCode = 'not-granted'

export type StateViewProps =
  | (StateViewBase & { state: 'normal'; children: ReactNode })
  | (StateViewBase & { state: 'loading' })
  | (StateViewBase & { state: 'empty'; reasonCode: 'not-yet'; action?: never })
  | (StateViewBase & {
      state: 'empty'
      reasonCode: Exclude<EmptyReasonCode, 'not-yet'>
      action: StateViewAction
    })
  | (StateViewBase & {
      state: 'error'
      reasonCode: ErrorReasonCode
      action?: StateViewAction
      /** 排障详情，默认折叠，不进 live region。 */
      details?: { summaryKey: string; bodyKey: string }
    })
  | (StateViewBase & { state: 'disabled'; reasonCode: 'capability-not-wired'; action?: never })
  | (StateViewBase & { state: 'disabled'; reasonCode: 'target-disabled'; action: StateViewAction })
  | (StateViewBase & { state: 'permission'; reasonCode: PermissionReasonCode; action?: never })

/** 量出来的两个高度：整页 220、卡内 80（§13）。`sm` 是行内档，本批不给固定高度。 */
const MIN_HEIGHT: Record<StateSize, number | undefined> = { sm: undefined, md: 80, lg: 220 }

type IconState = 'empty' | 'error' | 'disabled' | 'permission'

const ICON_STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

/**
 * 图标表：**只看 `state`**。`reasonCode` 本批不参与（按 reason 分图标是 v1.2）。
 *
 * `disabled` = 圈加斜杠、`permission` = 锁：两态同走中性色，灰度下必须还能分开，
 * 区分只能落在这张表的轮廓上——不是同一形状换颜色。
 */
function StateIcon({ state }: { state: IconState }): ReactElement {
  return (
    <span className="state-view__icon" aria-hidden="true" data-state-icon={state}>
      {state === 'empty' ? (
        <svg viewBox="0 0 24 24" {...ICON_STROKE}>
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      ) : state === 'error' ? (
        <svg viewBox="0 0 24 24" {...ICON_STROKE}>
          <path d="M12 4.5v10" />
          <path d="M12 19v.01" />
        </svg>
      ) : state === 'disabled' ? (
        <svg viewBox="0 0 24 24" {...ICON_STROKE}>
          <circle cx="12" cy="12" r="9" />
          <path d="M5.6 5.6l12.8 12.8" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" {...ICON_STROKE}>
          <rect x="4" y="11" width="16" height="9" rx="2" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
        </svg>
      )}
    </span>
  )
}

/** 文案键的拼法只在这一处：产品选码，不拼键；测试与文案表都按它取键。 */
export function stateViewTextKeys(
  state: Exclude<StateViewState, 'normal' | 'loading'>,
  reasonCode: string
): { title: StateViewTextKey; reason: StateViewTextKey } {
  return {
    title: `ui.state.${state}` as StateViewTextKey,
    reason: `ui.state.${state}.reason.${reasonCode}` as StateViewTextKey
  }
}

function rootClassName(state: StateViewState, className?: string): string {
  return ['state-view', `state-view--${state}`, className].filter(Boolean).join(' ')
}

/**
 * 一个组件装六态。所有可见文字都是键解析出来的；所有图标都来自上面那张表。
 * `normal` 只渲染 `children`，不套壳、不留标题/原因/动作的位置（不是空占位）。
 */
export function StateView(props: StateViewProps): ReactElement {
  if (props.state === 'normal') {
    return <>{props.children}</>
  }

  const minHeight = MIN_HEIGHT[props.size ?? 'md']

  if (props.state === 'loading') {
    // 等待只走平台唯一的加载组件：不在这里再写旋转，也不再包一层 live region。
    return (
      <LoadingState
        label={props.resolveText('ui.state.loading')}
        {...(minHeight === undefined ? {} : { minHeight })}
      />
    )
  }

  const { state, reasonCode, resolveText } = props
  const keys = stateViewTextKeys(state, reasonCode)
  // `details` 只挂在 error 上（判别联合已挡住别的态传它），收成局部量给 JSX 收窄。
  const details = state === 'error' ? props.details : undefined

  return (
    <div
      className={rootClassName(state, props.className)}
      data-state={state}
      data-size={props.size ?? 'md'}
      {...(minHeight === undefined ? {} : { style: { minHeight } })}>
      <StateIcon state={state} />
      {/* live region 只包标题与原因：详情与动作按钮在它外面，出现时不抢焦点、也不被一起念出来。 */}
      <span
        className="state-view__live"
        {...(state === 'error' ? { role: 'status', 'aria-live': 'polite' } : {})}>
        <strong className="state-view__title">{resolveText(keys.title)}</strong>
        <span className="state-view__reason">{resolveText(keys.reason)}</span>
      </span>
      {details === undefined ? null : (
        <details className="state-view__details">
          <summary>{resolveText(details.summaryKey)}</summary>
          <p>{resolveText(details.bodyKey)}</p>
        </details>
      )}
      {props.action === undefined ? null : (
        <button type="button" className="state-view__action" onClick={props.action.onSelect}>
          {resolveText(props.action.labelKey)}
        </button>
      )}
    </div>
  )
}
