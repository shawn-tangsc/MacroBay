import type { ReactElement } from 'react'

import './metaChip.css'

/**
 * 分类标签（规格：`docs-private/05-desktop/ui-audit/prototypes/2026-11-02-toast-metachip.html` ②）。
 *
 * 只做一件事：把一枚**分类名词**（宏观 / 利率 / 美股 / 加密 / 协议名 / 工具名）画成中性小标签。
 * 它和 `StatusPill` 的边界写在规格里，也写在这里：
 * - **状态词**（已启用、数据偏旧、读取失败）→ `StatusPill`：有圆点、胶囊形；
 * - **分类名词** → 本组件：无圆点、直角、中性一色；
 * - **计数** → `CountBadge`；**操作后的一句话** → `Toast`。
 *
 * 三条写进结构、不靠评审：
 * - 纯文字 `<span>`：**不可点击**（要可点的用按钮）、不带图标、不带关闭叉——需要筛选的用
 *   `Segmented`，不要把这颗标签做成按钮；
 * - **不收颜色**：分类不靠色相区分，靠文字；组件内只有中性一档；
 * - 文案只收键（`labelKey`），句子由调用方注入的 `resolveText` 解析——组件内零文案、零 i18n。
 *
 * 长度是调用方义务：≤8 个汉字 / 16 个字符；超了说明它不是分类，而是正文或说明。
 */

export type MetaChipProps = {
  /** 分类名的 i18n 键；不收字面量。 */
  labelKey: string
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传键回显）。 */
  resolveText: (key: string) => string
}

export function MetaChip({ labelKey, resolveText }: MetaChipProps): ReactElement {
  return <span className="meta-chip">{resolveText(labelKey)}</span>
}
