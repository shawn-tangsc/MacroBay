import type { ReactElement, ReactNode } from 'react'

import type { STATE_VIEW_ACTION_KEYS } from './stateViewText'
import { LoadingState } from '../loading'

import { useStateViewText } from './stateViewText'
import type {
  DisabledReasonCode,
  EmptyReasonCode,
  ErrorReasonCode,
  PermissionReasonCode
} from '@platform/contracts/queryOutcome'
import './stateView.css'

/** 码表归 `platform/contracts/queryOutcome`（数据层与 UI 共用一份）；这里只做转出，方便组件与产品沿用旧入口。 */
export type {
  DisabledReasonCode,
  EmptyReasonCode,
  ErrorReasonCode,
  PermissionReasonCode
} from '@platform/contracts/queryOutcome'

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
 * 动作位是**场景属性**，不是 `state × reason` 的必然属性，所以 `action` 一律可选（契约 §16）：
 * - 「还没跑过」的正解是「现在跑一次」，但「这段时间确实没有消息」是事实、没有可做的事；
 * - 有没有动作由调用方按场景判，类型不替人判（契约 §16）。替代保障是 `queryOutcome.ts` 的
 *   `STATE_VIEW_ACTION_RULES` 表 + 两条扫描守卫：文档动作列与表逐条相等；调用点标 `required`
 *   缺动作、标 `forbidden` 带动作都红。
 *
 * 文档判据（验收用，不是类型）：`error` 与可恢复的 `empty` 必须给动作；`empty · not-yet`、
 * `disabled · capability-not-wired` 可以没有；`permission · not-granted` 给的是「去系统设置」，
 * `contact-admin` 那类假动作仍然禁止。
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
  'ui.state.empty.reason.never-ran',
  'ui.state.empty.reason.target-missing',
  'ui.state.empty.reason.older-than-window',
  'ui.state.empty.reason.nothing-in-window',
  'ui.state.error',
  'ui.state.error.reason.unreadable',
  'ui.state.error.reason.unavailable',
  'ui.state.error.reason.operation-failed',
  'ui.state.error.reason.needs-restart',
  'ui.state.error.reason.page-load-failed',
  'ui.state.error.reason.notification-unknown',
  'ui.state.error.details',
  'ui.state.disabled',
  'ui.state.disabled.reason.capability-not-wired',
  'ui.state.disabled.reason.target-disabled',
  'ui.state.disabled.reason.precondition-unsaved',
  'ui.state.permission',
  'ui.state.permission.reason.not-granted'
] as const

/**
 * 键的类型 = 状态与原因键（本文件的位置清单）+ 动作键（`STATE_VIEW_ACTION_KEYS` 的值推导）。
 *
 * **不要再把动作键手写进上面那张清单**：那样同一个键集就有两份清单，靠人同步，
 * 今晚已经掉队过两个（`focus-form`、`run-now`）。动作键的唯一来源是那个对象；
 * 这里只做推导，于是「加一个键忘了写文案」会红在文案表上——红的位置就是错的位置。
 */
export type StateViewTextKey =
  | (typeof STATE_VIEW_TEXT_KEYS)[number]
  | (typeof STATE_VIEW_ACTION_KEYS)[keyof typeof STATE_VIEW_ACTION_KEYS]

/**
 * 三档高度。与 `IconButton` 的尺寸词共用一套（`sm` / `md` / `lg`）——同一个界面里两套密度词，
 * 读者会以为是两件事。
 *
 * 这个类型原来住在 `../empty-state` 里（旧组件复用），旧组件退役时搬了过来：**退役不是删目录，
 * 是把还被用着的东西搬出来再删**。删掉目录却没搬类型，`tsc` 当场红——那次红就是这条注释的来历。
 */
export type StateSize = 'sm' | 'md' | 'lg'

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
  /** 产品原因句入口（§17）；只覆盖原因句这一格，`normal` / `loading` 传了编译不过。 */
  productReason?: ProductReason
}

type StateDetails = { summaryKey: StateViewTextKey; bodyKey: StateViewTextKey }

/**
 * 产品原因句入口（契约 §17）。**只覆盖原因句这一格**：标题/状态词、图标、播报、动作仍归平台。
 *
 * - `key` 必须带产品前缀（`mi.newsSentiment.*`），由守卫扫；
 * - `params` 只收**已经展示好**的字符串——时刻必须先经平台时间格式化器算好再传，
 *   所以这里不收 `number`，数字进不来；
 * - 缺键、空串、抛错**一律回落平台句**：原因句是这一格唯一的解释，空串等于「没有理由」；
 * - 节点带 `data-reason-source`，回落不许静默，调用点测试能断言走的是哪一路。
 */
export type ProductReason = {
  key: string
  params?: Record<string, string>
  resolve: (key: string, params?: Record<string, string>) => string
}

/**
 * 每个 `reasonCode` 单独一分支（§13）：它们不只是「哪些值合法」，还决定 `action` 与 `details`
 * 的归属。写成 `state + Exclude<code>` 的联合会把「这个码能不能带动作」这一层丢掉。
 */
export type StateViewProps =
  | (StateViewBase & { state: 'normal'; children: ReactNode; productReason?: never })
  | (StateViewBase & { state: 'loading'; productReason?: never })
  | (StateViewBase & { state: 'empty'; reasonCode: 'never-created'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'filtered-out'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'no-target-bound'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'nothing-enabled'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'none-installed'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'no-target-selected'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'not-yet'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'never-ran'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'target-missing'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'older-than-window'; action?: StateViewAction })
  | (StateViewBase & { state: 'empty'; reasonCode: 'nothing-in-window'; action?: StateViewAction })
  | (StateViewBase & { state: 'error'; reasonCode: 'unreadable'; action?: StateViewAction; details?: StateDetails })
  | (StateViewBase & { state: 'error'; reasonCode: 'unavailable'; action?: StateViewAction; details?: StateDetails })
  | (StateViewBase & {
      state: 'error'
      reasonCode: 'operation-failed'
      action?: StateViewAction
      details?: StateDetails
    })
  | (StateViewBase & { state: 'error'; reasonCode: 'needs-restart'; action?: StateViewAction; details?: StateDetails })
  // 页面本身没加载出来：恢复办法是重载页面，不是重试那次操作，也不是重启应用。
  | (StateViewBase & { state: 'error'; reasonCode: 'page-load-failed'; action?: StateViewAction; details?: StateDetails })
  // 「状态不明」：拿不到，且连原因都判不出来。句子必须含「这不代表没有通知」；仍是六态之一，不是第七态。
  | (StateViewBase & {
      state: 'error'
      reasonCode: 'notification-unknown'
      action?: StateViewAction
      details?: StateDetails
    })
  | (StateViewBase & { state: 'disabled'; reasonCode: 'capability-not-wired'; action?: StateViewAction })
  | (StateViewBase & { state: 'disabled'; reasonCode: 'target-disabled'; action?: StateViewAction })
  | (StateViewBase & { state: 'disabled'; reasonCode: 'precondition-unsaved'; action?: StateViewAction })
  | (StateViewBase & { state: 'permission'; reasonCode: 'not-granted'; action?: StateViewAction })

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
  const platformReason = resolveText(keys.reason)
  // 产品句只在 productReason 存在时生效，且必须问得出一句非空的话；否则回落平台句。
  const productReason = 'productReason' in props ? props.productReason : undefined
  let reasonText = platformReason
  let reasonSource = 'platform'
  if (productReason !== undefined) {
    try {
      const candidate = productReason.resolve(productReason.key, productReason.params)
      if (typeof candidate === 'string' && candidate.trim() !== '') {
        reasonText = candidate
        reasonSource = 'product'
      }
    } catch {
      // 产品解析器抛错不该把整屏打成白屏：回落平台句，并让 data-reason-source 说出这件事。
    }
  }
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
        <span className="state-view__reason" data-reason-source={reasonSource}>
          {reasonText}
        </span>
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
