import type { ReactElement, ReactNode } from 'react'

import type { StateSize } from '../empty-state'
import { LoadingState } from '../loading'

import { useStateViewText } from './stateViewText'
import './stateView.css'

/**
 * 六态统一状态视图（契约：`docs-private/05-desktop/ui-state-components-contract.md` §13）。
 *
 * 接替 `EmptyState`（7 处调用 / 5 文件）与各处手写空态。**`ErrorState` 零消费方，直接删**；
 * **`DisabledHint` 从来不是组件**（全仓只有 `providerDisabledHint` 这类 i18n 字段名）——别再拿
 * 「取代三个旧组件」这句话去全仓找第三个。组件内**零文案、零 i18n**：标题与原因句
 * 只收键，句子由调用方经 `resolveText` 解析；图标由本文件一张表按 `state` 决定，**不收 `icon`**
 * （收图标等于允许同一状态两种图标，`disabled` 与 `permission` 的轮廓判据当场作废）。
 *
 * `state` 是判别联合不是平铺对象，`reasonCode` 是按状态分家的闭集：`<StateView state="empty" />`
 * 与「empty 配 error 的码」都编译不过，否则就会落回一句兜底文案——而那正是「暂无数据」的撒谎方式。
 *
 * 动作位按「读者能不能自己解决」定，不是按状态定：
 * - `empty · not-yet`、`disabled · capability-not-wired`：读者没有可做的动作，**不许传入动作**；
 * - `empty` 其余码、`disabled · target-disabled`、`error`：必须给一个点了就能解决的动作；
 * - `permission · not-granted`：必须给「去系统设置」——码表把它限死在系统能回答授没授权的
 *   能力上，能开启它的是系统设置，按钮真能把人送过去。`contact-admin` 那类假动作仍然禁止。
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
  'ui.state.empty.reason.none-installed',
  'ui.state.empty.reason.no-target-selected',
  'ui.state.empty.reason.not-yet',
  'ui.state.empty.reason.older-than-window',
  'ui.state.empty.reason.nothing-in-window',
  'ui.state.error',
  'ui.state.error.reason.unreadable',
  'ui.state.error.reason.unavailable',
  'ui.state.error.reason.operation-failed',
  'ui.state.error.reason.needs-restart',
  'ui.state.error.details',
  'ui.state.disabled',
  'ui.state.disabled.reason.capability-not-wired',
  'ui.state.disabled.reason.target-disabled',
  'ui.state.disabled.reason.precondition-unsaved',
  'ui.state.permission',
  'ui.state.permission.reason.not-granted',
  'ui.state.action.create',
  'ui.state.action.clear-filter',
  'ui.state.action.bind-target',
  'ui.state.action.enable',
  'ui.state.action.retry',
  'ui.state.action.check-source',
  'ui.state.action.install',
  'ui.state.action.save',
  'ui.state.action.open-settings',
  'ui.state.action.select-target',
  'ui.state.action.restart-app',
  'ui.state.action.open-system-settings',
  'ui.state.action.widen-window'
] as const

export type StateViewTextKey = (typeof STATE_VIEW_TEXT_KEYS)[number]

export type StateViewAction = {
  /** 动作文案的 i18n 键；不收字面量，且必须是本组件码表里的键。 */
  labelKey: StateViewTextKey
  onSelect: () => void
}

type StateViewBase = {
  /**
   * 文案解析入口。**默认不用传**：组件内部走 `useStateViewText()`（语言取自壳层上下文）。
   * 只有测试需要注入 `(key) => key` 时才传——不要把它当成「产品自带一份文案表」的入口。
   */
  resolveText?: (key: StateViewTextKey) => string
  /** 尺寸词只有一个来源（§3）：`lg` 整页 220、`md` 卡内 80、`sm` 本批不开放。 */
  size?: StateSize
  className?: string
}

export type EmptyReasonCode =
  | 'never-created'
  | 'filtered-out'
  | 'no-target-bound'
  | 'nothing-enabled'
  | 'none-installed'
  | 'no-target-selected'
  | 'not-yet'
  // 「有数据，但都在窗口之外」与「这段确实没有」是两句话：都不能用 `not-yet`（那是「还没到」）顶替。
  | 'older-than-window'
  | 'nothing-in-window'

export type ErrorReasonCode = 'unreadable' | 'unavailable' | 'operation-failed' | 'needs-restart'
export type DisabledReasonCode = 'capability-not-wired' | 'target-disabled' | 'precondition-unsaved'
export type PermissionReasonCode = 'not-granted'

type StateDetails = { summaryKey: StateViewTextKey; bodyKey: StateViewTextKey }

/**
 * 每个 `reasonCode` 单独一分支（§13）：它们不只是「哪些值合法」，还决定 `action` 与 `details`
 * 的归属。写成 `state + Exclude<code>` 的联合会把「这个码能不能带动作」这一层丢掉。
 */
export type StateViewProps =
  | (StateViewBase & { state: 'normal'; children: ReactNode })
  | (StateViewBase & { state: 'loading' })
  | (StateViewBase & { state: 'empty'; reasonCode: 'never-created'; action: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'filtered-out'; action: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'no-target-bound'; action: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'nothing-enabled'; action: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'none-installed'; action: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'no-target-selected'; action: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'not-yet'; action?: never })
  | (StateViewBase & { state: 'empty'; reasonCode: 'older-than-window'; action: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'nothing-in-window'; action: StateViewAction })
  | (StateViewBase & { state: 'error'; reasonCode: 'unreadable'; action: StateViewAction; details?: StateDetails })
  | (StateViewBase & { state: 'error'; reasonCode: 'unavailable'; action: StateViewAction; details?: StateDetails })
  | (StateViewBase & {
      state: 'error'
      reasonCode: 'operation-failed'
      action: StateViewAction
      details?: StateDetails
    })
  | (StateViewBase & { state: 'error'; reasonCode: 'needs-restart'; action: StateViewAction; details?: StateDetails })
  | (StateViewBase & { state: 'disabled'; reasonCode: 'capability-not-wired'; action?: never })
  | (StateViewBase & { state: 'disabled'; reasonCode: 'target-disabled'; action: StateViewAction })
  | (StateViewBase & { state: 'disabled'; reasonCode: 'precondition-unsaved'; action: StateViewAction })
  | (StateViewBase & { state: 'permission'; reasonCode: 'not-granted'; action: StateViewAction })

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
  // 唯一一处取文案：默认走平台，测试可注入。两者共用同一个纯函数，行为不会各漂各的。
  const contextText = useStateViewText()
  const resolveText = props.resolveText ?? ((key: string) => contextText(key as StateViewTextKey))

  if (props.state === 'normal') {
    return <>{props.children}</>
  }

  const minHeight = MIN_HEIGHT[props.size ?? 'md']

  if (props.state === 'loading') {
    // 等待只走平台唯一的加载组件：不在这里再写旋转，也不再包一层 live region。
    return (
      <LoadingState
        label={resolveText('ui.state.loading')}
        {...(minHeight === undefined ? {} : { minHeight })}
      />
    )
  }

  const { state, reasonCode } = props
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
