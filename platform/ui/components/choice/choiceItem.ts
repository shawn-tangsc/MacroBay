/**
 * 一组互斥选项（契约 §7）：`Tabs` 与 `Segmented` 共用这一个类型，组件不合并、类型不各写一套。
 *
 * `value` 是**稳定标识**，不是下标：下标会随排序和增删漂移，存进设置里就成了错项。验收时判
 * `value` 是否来自 `items`。
 */
export type ChoiceItem = {
  /** 稳定标识；不接受下标。 */
  value: string
  /** 文案的 i18n 键；不收字面量。 */
  labelKey: string
  /** 禁用项：不进 Tab 序列、不响应方向键、也不挂提示。 */
  disabled?: boolean
}
