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
  // **暂无站点**（2026-11-02）：类型、动作规则、白名单、两句文案、两份文档都在，但界面上还没有一处用它。
  // 这种「看起来完整」正是它危险的地方——它会给后来人一个「这个处境已经有标准答案」的错觉。
  // 先看 `SelectedCalendarEventDrawer` 有没有迁移计划；有，就同笔带站点与用例；没有，就别照它写。
  // 评审结论（架构师 2026-11-02）：**条件通过**——处境唯一、动作规则与白名单齐、两种语言同笔，四条里
  // 只差「真实站点 + 用例」。到期条件是那道迁移落地时必须同笔带上；逾期则撤码。
  | 'target-missing'
  // 「有数据，但都在窗口之外」与「这段确实没有」是两句话：都不能用 `not-yet`（那是「还没到」）顶替。
  | 'older-than-window'
  | 'nothing-in-window'

/**
 * 「拿不到」有两种：`unreadable` 是读失败、知道重试；`notification-unknown` 是连「读失败还是本来就为空」
 * 都判不出来（读接口既没回成功，也没给可判定的错误）。后者必须如实说「原因还没查清」，并写明
 * 「这不代表没有通知」——不许退成 `empty`（那是在说没有），也不许推到 `permission`（权限查不到≠没给）。
 *
 * **`error.*` 只用于「损坏阻断了读取」。** 损坏的东西**本身就是要展示的对象**时，它是内容，不是错误态
 * （例：存储页隔离副本清单里那一行坏文件——读者来这一屏就是想看坏在哪）。判据一句话：**读者来这一屏，
 * 是想看坏东西，还是想读好东西？** 前者画成内容，后者才画成错误。把后者写成 `empty` 就是「读不到 = 没有」，
 * 那是本规范第一条要治的病。
 *
 * **`error.record-corrupt` 现在不存在，形状先钉死**（架构师 2026-11-19 判：契约按现场长，不按预想长）：
 * 今天没有任何一处处于「坏记录阻断读取」——附件那条桥还没接，存储页的坏记录是内容不是错误。它出现时
 * 按下面的形状加，**不许实现方自己编码**：
 *
 * - 档位取 `forbidden`：重读读到的是同一条坏记录，给动作只会让人反复点；
 * - 不进 `STATE_VIEW_ACTION_CHOICES`：白名单里连 `retry` 都不许出现。
 *
 * 先例：`disabled.capability-not-wired` 同样在 `forbidden` 档、也不在那张白名单里。
 */
export type ErrorReasonCode =
  | 'unreadable'
  | 'unavailable'
  | 'operation-failed'
  | 'needs-restart'
  | 'page-load-failed'
  | 'notification-unknown'
  /*
    渲染这一步崩了：界面画不出来。它既不是「没读到」（`unreadable`），也不是「页面没加载」
    （`page-load-failed`）——是画的时候抛了错，恢复办法是先重试、反复出现再重载界面。
  */
  | 'render-failed'
export type DisabledReasonCode = 'capability-not-wired' | 'target-disabled' | 'precondition-unsaved'
export type PermissionReasonCode = 'not-granted'

/**
 * 数据查询的结果。
 *
 * `permission` 不在这里：它不是查询结果，而是「这次查询根本不允许发生」——由界面在发起查询前判定，
 * 所以留在 `StateView` 的六态里，不进数据层。
 *
 * **只有一处合法入口**：数据读取层 → `platform/ui/async/asyncState.ts` 的适配处（今天全仓的非测试引用
 * 也只有定义和它两处）。消息内容里出现同一个处境（「附件看不到内容」「附件信息读不出」）**可以沿用这套词，
 * 但不许包成 `QueryOutcome`**——它不是一次查询：`loading` 不成立（这一版不取字节，不许造假加载态）、
 * `empty` 不成立（没有附件就不画任何形状）、`disabled`/`permission` 也不成立。
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
 *
 * **只约束 `QueryOutcome` 的码。** 消息内容里的同名处境不受这张表管，**也不许为了让它受管而把消息内容
 * 包成 `QueryOutcome`**（那就是把内容变成查询终态的入口）。所以 `stateViewCallSiteGuard` 看不见消息里
 * 的附件行是对的，不是漏检——那里本来就没有 `StateView`，也没有 `QueryOutcome`。
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
  // 页面自己没加载出来：重载页面能恢复，所以不给动作就是缺陷。
  'error.page-load-failed': 'required',
  // 通知中心「状态不明」：读者只能再试一次；不给动作就把人丢在一个没有出路的页面里。
  'error.notification-unknown': 'required',
  // 渲染崩了：先重试（可能只是一次性数据），反复出现再重载界面——两个出口都没有就是白屏上没路。
  'error.render-failed': 'required',
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
  // 页面级：重载页面，不是「这次操作重试」，也不是「重启应用」——三种代价完全不同。
  'error.page-load-failed': ['ui.state.action.reload-page'],
  // 「状态不明」不是页面没加载、也不是来源不可用：只允许重试，不提供别的出口。
  'error.notification-unknown': ['ui.state.action.retry'],
  // 先 `retry`，反复出现再 `reload-page`：一次偶发崩溃不该逼读者丢掉整页状态。
  'error.render-failed': ['ui.state.action.retry', 'ui.state.action.reload-page'],
  'disabled.target-disabled': ['ui.state.action.enable'],
  'disabled.precondition-unsaved': ['ui.state.action.save'],
  'permission.not-granted': ['ui.state.action.open-system-settings']
}
