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
  // 「还没跑过」（正解是现在跑一次）与「这段期间确实没有」是两种处境：前者要动作，后者没有。
  | 'never-ran'
  // 目标本身已被删除：这是「拿不到」，不是「没有」，也不能复用 `target-disabled`（那要求去启用）。
  | 'target-missing'
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
/**
 * 一个码对动作的要求。
 *
 * `optional` 是 2026-11-02 补的：**有没有动作是场景属性**，同一个码在两处可能一处给按钮、一处不给
 * （整月无事件给「打开设置」，确实没有消息就不给）。`required` 只该留给「不给动作就是缺陷」的码，
 * 它同时也是审核判据——类型层不替它决定，`action` 在所有码上都是可选的。
 */
export type StateActionRule = 'required' | 'forbidden' | 'optional'

export const STATE_VIEW_ACTION_RULES: Record<string, StateActionRule> = {
  'empty.never-created': 'required',
  'empty.filtered-out': 'required',
  'empty.no-target-bound': 'required',
  'empty.nothing-enabled': 'required',
  'empty.none-installed': 'required',
  'empty.no-target-selected': 'required',
  'empty.not-yet': 'forbidden',
  'empty.never-ran': 'required',
  'empty.target-missing': 'required',
  'empty.older-than-window': 'required',
  'empty.nothing-in-window': 'optional',
  'error.unreadable': 'required',
  'error.unavailable': 'required',
  'error.operation-failed': 'required',
  'error.needs-restart': 'required',
  'disabled.capability-not-wired': 'forbidden',
  'disabled.target-disabled': 'required',
  'disabled.precondition-unsaved': 'required',
  'permission.not-granted': 'required'
}

/**
 * 允许出现在某个码上的动作键——**每个码一条白名单，码内允许多键**。
 *
 * 为什么不是「一个码锁一个键」：同一个码在不同屏上的恢复方式不同
 * （`error.unavailable` 可能是 `retry`、`check-source` 或 `refresh`）。
 * 锁成一键，第一个合法的第二现场就会红，然后守卫会被人放宽——那比没有守卫更糟。
 *
 * 内容与 `docs/development/ui-state-components.md` 的「Action」列一一对应；
 * 改这张表＝契约变更。`stateViewCallSiteGuard` 断言三件事：每个 `required` 的码都在这里有一条、
 * 站点用的键都在它那条白名单里、以及反向夹具（`never-created` + `focus-form`）必须被报出。
 */
export const STATE_VIEW_ACTION_CHOICES: Record<string, readonly string[]> = {
  'empty.never-created': ['ui.state.action.create'],
  'empty.filtered-out': ['ui.state.action.clear-filter'],
  'empty.no-target-bound': ['ui.state.action.bind-target'],
  'empty.nothing-enabled': ['ui.state.action.enable'],
  // 四选一，各对应一种恢复方式（架构师 2026-11-02 批准加 focus-form）：
  // 同屏有可填表单 → focus-form；有可选列表 → install；已有目标可绑 → bind-target；本屏给不了入口 → open-settings。
  'empty.none-installed': [
    'ui.state.action.install',
    'ui.state.action.bind-target',
    'ui.state.action.open-settings',
    'ui.state.action.focus-form'
  ],
  'empty.no-target-selected': ['ui.state.action.select-target', 'ui.state.action.focus-form'],
  'empty.never-ran': ['ui.state.action.run-now'],
  'empty.target-missing': ['ui.state.action.back-to-list'],
  'empty.older-than-window': ['ui.state.action.widen-time-window'],
  // 场景不同，出口也不同：整月无事件是「去设置看范围」，确实没有消息就不给动作。
  'empty.nothing-in-window': ['ui.state.action.widen-time-window', 'ui.state.action.open-settings'],
  'error.unreadable': ['ui.state.action.retry'],
  'error.unavailable': ['ui.state.action.check-source', 'ui.state.action.retry', 'ui.state.action.refresh'],
  'error.operation-failed': ['ui.state.action.retry'],
  'error.needs-restart': ['ui.state.action.restart-app'],
  'disabled.target-disabled': ['ui.state.action.enable'],
  'disabled.precondition-unsaved': ['ui.state.action.save'],
  'permission.not-granted': ['ui.state.action.open-system-settings']
}
