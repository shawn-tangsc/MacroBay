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
  /** 状态词（已格式化）；不给就是不画状态词，不编一个「正常」。 */
  statusLabel?: string
  enabled: boolean
}

export type DrawerSourcesView = DrawerScreenView<DrawerSourceRow>
