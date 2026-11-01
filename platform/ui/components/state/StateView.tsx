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
 * `state` 是判别联合不是平铺对象：`empty` / `error` / `disabled` / `permission` 缺 `reasonCode`
 * 编译不过，否则 `<StateView state="empty" />` 会落回一句兜底文案，而那正是「暂无数据」的撒谎方式。
 * `disabled` 必须带 `action`；`permission` 的 `action` 可缺省且本批一律缺省——本地单用户版没有
 * 「管理员」这个人，缺省时**不渲染动作行、不留空位**。
 *
 * 播报：**只有 `error` 进 live region**，且只包标题与原因。`role="alert"` 是 assertive，会打断
 * 正在朗读的内容并把按钮一起念出来，所以用 `status` + `polite`。`empty` / `disabled` /
 * `permission` 不播报；`loading` 由 `LoadingState` 自己播报，这里不再包一层，否则读屏念两遍。
 */

export type StateViewState = 'normal' | 'loading' | 'empty' | 'error' | 'disabled' | 'permission'

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

export type StateViewProps =
  | (StateViewBase & { state: 'normal'; children: ReactNode })
  | (StateViewBase & { state: 'loading' })
  | (StateViewBase & { state: 'empty'; reasonCode: string; action?: StateViewAction })
  | (StateViewBase & {
      state: 'error'
      reasonCode: string
      action?: StateViewAction
      /** 排障详情，默认折叠，不进 live region。 */
      details?: { summaryKey: string; bodyKey: string }
    })
  | (StateViewBase & { state: 'disabled'; reasonCode: string; action: StateViewAction })
  | (StateViewBase & { state: 'permission'; reasonCode: string; action?: StateViewAction })

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
  // `details` 只挂在 error 上（判别联合已挡住别的态传它），收成局部量给 JSX 收窄。
  const details = state === 'error' ? props.details : undefined
  const announced = state === 'error'

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
        {...(announced ? { role: 'status', 'aria-live': 'polite' } : {})}>
        <strong className="state-view__title">{resolveText(`ui.state.${state}`)}</strong>
        <span className="state-view__reason">{resolveText(`ui.state.${state}.reason.${reasonCode}`)}</span>
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
