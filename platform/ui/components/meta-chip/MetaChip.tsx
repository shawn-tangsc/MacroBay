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
 * - 句子只收键（`key`），数据原样呈现（`text`）——组件内零文案、零 i18n。
 *
 * 长度是调用方义务：≤8 个汉字 / 16 个字符；超了说明它不是分类，而是正文或说明。
 */

/**
 * 内容的两种来源，**必须显式二选一**：句子走键，数据走原值。
 *
 * 分类标签实际装两类东西：
 * - **句子**：`利率`、`美股`、协议名——有 i18n 键，要跟着语言切换；
 * - **数据**：`claude-plugins`、工具 id、文件语言 `yaml`——运行时标识，**没有键，也不该翻译**。
 *
 * 为什么是一个联合、不给默认值：有了默认值，下一个人会不假思索地用 `text`，而 `text` 跳过
 * i18n、跳过语言切换——某一枚标签在英文界面里还是中文，**而且没有任何检查会红**。
 * `kind` 是这层区分唯一能落到编译期的地方：不写就是编译错误，不是默认走某一边。
 *
 * **字段名必须是 `labelKey`，不能叫 `key`**：`key` 是 React 的保留属性，JSX 里写
 * `<MetaChip kind="textKey" labelKey="…" />` 时它会被 React 消费掉，**根本不会进到组件的 props**——
 * 类型对、编译过、渲染出来是空的。这个坑只能用名字避开，没有检查能替你发现它。
 */
export type MetaChipLabel = { kind: 'textKey'; labelKey: string } | { kind: 'text'; text: string }

export type MetaChipProps = MetaChipLabel & {
  /** 文案解析入口，由调用方注入（壳层传 `t` 的包装，测试传键回显）。**`text` 从不经过它。** */
  resolveText: (key: string) => string
}

export function MetaChip(props: MetaChipProps): ReactElement {
  // 数据原样呈现，**不查表**：它是标识，不是句子。让它经过 `resolveText`，就等于假装它会被翻译。
  if (props.kind === 'text') return <span className="meta-chip meta-chip--data">{props.text}</span>
  return <span className="meta-chip">{props.resolveText(props.labelKey)}</span>
}
