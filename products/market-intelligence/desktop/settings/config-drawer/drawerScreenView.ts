/**
 * 抽屉各屏的**视图形状**——只有类型，没有任何读取实现。
 *
 * 数据由**宿主页面**读好、通过 props 交进来；抽屉只渲染、不自己取数（守卫仍然在，含义是
 * 「抽屉不自己接数据」）。四态里的两种「空」必须分开：`error` 是**读不到**（错误态 + 重试），
 * `ready` 且 `rows` 为空是**确实没有**（空态）。
 */
export type DrawerScreenView<Row> =
  | { state: 'loading' }
  | { state: 'error'; onRetry: () => void }
  | { state: 'ready'; rows: readonly Row[] }

export type DrawerRowView = {
  /** 与注册表行 key 对应。 */
  key: string
  /** 已格式化好的值；没有值就不传（不要用空串冒充）。 */
  value?: string
  /**
   * 值缺失时**该显示什么**，按 `docs/ui-rules.md` 的三分：
   * - **确实没有** → 不传它，渲染处落一个 `—`（一格一个，不铺一串）；
   * - **拿不到 / 未加载** → 传状态词（例：`读不到`、`没启用`、`未知：排期投影读不到`），
   *   **不许**用 `—` 冒充「拿不到」，也不许留白；
   * - **留白只允许演示态**（数据未接时的占位），接数据后必须收敛成上面两种。
   *
   * 一行最多一个空值标记：值列只用一个位置表达「没有」。
   */
  emptyLabel?: string
  /**
   * 这一格「为什么是未知」：**只进 ⓘ**，正文只留状态词（界面设计判据：正文只有「未知」两字）。
   * 传了才会在标签旁画一颗 ⓘ；没有原因就不放——空 ⓘ 比没有更糟。
   */
  reason?: string
  /** 禁用是**行**属性，不是屏属性。 */
  disabled?: boolean
  /** 行内动作（B2 那三处「测试」）：宿主实现，抽屉只渲染在行尾。 */
  action?: { labelKey: string; onSelect: () => void; disabled?: boolean }
}

/** 平台与模型那一屏的当前值：**宿主读好再传**；缺键就是「读不到」，不是「没设置」。 */
export type DrawerPlatformValues = {
  timeZone?: string
  language?: string
  theme?: string
  proxy?: string
  modelService?: string
}

/** 跳转目标：平台基本设置页 / 模型服务页。抽屉不拼路由，只转达这个目标。 */
export type DrawerPlatformTarget = 'preferences' | 'models'
