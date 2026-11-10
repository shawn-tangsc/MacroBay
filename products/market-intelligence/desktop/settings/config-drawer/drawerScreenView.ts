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
