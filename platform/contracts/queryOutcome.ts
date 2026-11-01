/**
 * 查询结果的统一形态（架构师 2026-11-02 裁定，归属 `platform/contracts`）。
 *
 * 之前每个消费方各自把失败折叠成一个 `unavailable` 桶：源被关、回包坏、这次没拿到，
 * 三件事在 UI 上长得一模一样，读者于是被建议去重试一个根本没开的数据源。五条线同时卡在这里，
 * 根因不是组件不够用，而是**数据层从来没有把原因说出来**。
 *
 * 所以状态码表从这里定义一次，`StateView` 只 re-export：数据层返回它，UI 直接映射，
 * 不需要、也不允许每条线再造一个桶。
 *
 * 方向：数据层与 UI 都依赖本文件；UI 不依赖数据实现，数据层不依赖 UI 组件。
 */

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

/**
 * 数据查询的结果。
 *
 * `permission` 不在这里：它不是查询结果，而是「这次查询根本不允许发生」——由界面在发起查询前判定，
 * 所以留在 `StateView` 的六态里，不进数据层。
 */
export type QueryOutcome<T> =
  | { state: 'ok'; data: T }
  | { state: 'loading' }
  | { state: 'disabled'; reasonCode: DisabledReasonCode }
  | { state: 'error'; reasonCode: ErrorReasonCode }
  | { state: 'empty'; reasonCode: EmptyReasonCode }

/** 从查询结果直接取状态词；`ok` 不产生状态视图。 */
export type QueryOutcomeState = Exclude<QueryOutcome<unknown>['state'], 'ok'>

/**
 * 每个原因码要不要动作（契约 §16，2026-11-02）。
 *
 * 「有没有动作」是场景属性，类型不再替人判；于是这层保障从类型搬到这张表和两条扫描守卫：
 * 文档动作列与本表逐条相等；调用点标 `required` 缺动作、标 `forbidden` 带动作都红。
 *
 * `none-installed` 的动作是**三选一**，不是一个固定键：三个站点各自是一种恢复方式。
 */
export type StateActionRule = 'required' | 'forbidden'

export const STATE_VIEW_ACTION_RULES: Record<string, StateActionRule> = {
  'empty.never-created': 'required',
  'empty.filtered-out': 'required',
  'empty.no-target-bound': 'required',
  'empty.nothing-enabled': 'required',
  'empty.none-installed': 'required',
  'empty.no-target-selected': 'required',
  'empty.not-yet': 'forbidden',
  'empty.older-than-window': 'required',
  'empty.nothing-in-window': 'required',
  'error.unreadable': 'required',
  'error.unavailable': 'required',
  'error.operation-failed': 'required',
  'error.needs-restart': 'required',
  'disabled.capability-not-wired': 'forbidden',
  'disabled.target-disabled': 'required',
  'disabled.precondition-unsaved': 'required',
  'permission.not-granted': 'required'
}

/** 允许出现在某个码上的动作键；没列出的码不限制（必填/禁止已由上一张表判）。 */
export const STATE_VIEW_ACTION_CHOICES: Record<string, readonly string[]> = {
  'empty.none-installed': [
    'ui.state.action.install',
    'ui.state.action.bind-target',
    'ui.state.action.open-settings'
  ]
}
