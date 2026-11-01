/**
 * 菜单项的共用形状。`ContextMenu` 与将来的触发式菜单都只认这一份，
 * 不许各处再长一套 `{ id, label, icon }`。
 *
 * - `key` 是回调里回来的那个字符串，**不是索引**：列表重排后索引会指到别人头上；
 * - `labelKey` 是 i18n 键，不是句子：句子由调用方注入的 `resolveText` 解析；
 * - `tone` 是闭集，危险项传 `'danger'`，**不许调用方传颜色**——颜色是组件的决定，不是调用方的。
 */

export const MENU_TONES = ['default', 'danger'] as const

export type MenuTone = (typeof MENU_TONES)[number]

export type MenuItem = {
  /** 回到 `onSelect` 的那个值；同一菜单内唯一。 */
  key: string
  /** 文案的 i18n 键；不收字面量，也不收已解析好的句子。 */
  labelKey: string
  /** 禁用项要给出为什么不能点的说明，由调用方在可见文案里写，不留一个灰块。 */
  disabled?: boolean
  /** 破坏性操作传 `'danger'`；默认档不写。 */
  tone?: MenuTone
}
