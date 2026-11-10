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
   * 值缺失时**该显示什么**（状态类空值必须给状态词，不许用 `—` 冒充）：
   * - 传了 → 显示它（例：`读不到`、`没启用`、`未知：排期投影读不到`）；
   * - 没传且 `value` 也没给 → **留白**，不铺 `—`。
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

/** 来源列表里的一条：只放读者要判断的三样——名字、状态词、启不启用。 */
export type DrawerSourceRow = {
  sourceId: string
  name: string
  /** 这个源属于哪个供应商：列表按它分组，读者才不必在一长串名字里找。 */
  groupName?: string
  /** 健康标记，投影给什么画什么；`none` 就是不画（**不是**「健康」，只是没有标记）。 */
  healthMarker?: 'none' | 'ring' | 'warn' | 'bad'
  /** 状态词（已格式化）；不给就是不画状态词，不编一个「正常」。 */
  statusLabel?: string
  enabled: boolean
}

export type DrawerSourcesView = DrawerScreenView<DrawerSourceRow>
