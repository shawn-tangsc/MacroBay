import { Tooltip as AntTooltip } from 'antd'
import type { ReactElement } from 'react'

/**
 * 可聚焦提示（规格：`docs-private/05-desktop/ui-audit/2026-11-02-tooltip.html`）。
 *
 * 底层是 antd `Tooltip`：**定位、翻转、窗口内夹取**都由它承担，本组件不自己算坐标。
 * 它存在的理由只有一个——原生 `title` 键盘用户根本拿不到：`title` 只跟着鼠标走，
 * 而且不进可访问描述。所以这里的触发器必须是**可聚焦元素**，提示同时挂在 hover 与 focus 上。
 *
 * 几条写进结构与守卫、不靠评审：
 * - 文案只收键（`labelKey`），句子由调用方注入的 `resolveText` 解析；组件内零文案零 i18n；
 * - 未知键解析成**空串时整条提示不渲染**，也不回退键名——把 `ui.tooltip.x` 念给读者是最糟的一种；
 * - 禁用元素不许挂提示：禁用接不到焦点，提示就只剩鼠标能看；这条由类型外的调用点守卫扫，
 *   因为 React 里「元素被禁用」不是一个能从中推导出来的类型；
 * - 悬停 300ms 后出现，**聚焦立即出现**（读者已经明确指向它了，不该再等）。
 */

/*
 * 文案上限（28 个汉字 / 60 个英文字符）是**文档与验收口径**，不设代码常量：
 * 一条「断言常量等于 28」的用例永远通过，它不守护任何真实行为，只会让人以为上限被管住了。
 * 将来真要机械管，扫的是实际句子，不是常量。
 */

export type TooltipProps = {
  /** 提示文案的 i18n 键；不收字面量。 */
  labelKey: string
  /** 调用方的文案解析入口；未知键返回空串时本组件不渲染提示。 */
  resolveText: (key: string) => string
  /** 触发器：必须是可聚焦元素（按钮、链接、带 tabIndex 的元素）。 */
  children: ReactElement
}

/**
 * 气泡字号锁死在 12px，不继承外层。
 *
 * antd 的 tooltip 样式里没有写 `font-size`，气泡会跟着正文走：`windowTheme` 的字号一改，
 * 提示就跟着漂。提示是辅助说明，不该随正文字号变——所以这里显式给，并用渲染值断言钉住。
 */
const BUBBLE_STYLE = { fontSize: 12 } as const

/**
 * 定位不接受参数（契约 §6），但它**必须显式写死**：antd 的默认位置是 `top`，不是 `bottom`。
 * 直接把参数删掉，提示会跑到上方——那不是「没设置」，是设置错了。
 *
 * 所以这里是组件内部唯一一处位置，固定 `bottom`，空间不足时由 antd 自动向上翻转。
 * 不导出 `Placement`、不从 props 透传：今天能传 `top`，明天就会有人传 `left`，
 * 再往后就开始自己算坐标——那正是这个组件要收掉的。
 */
const PLACEMENT = 'bottom' as const

export function Tooltip({ labelKey, resolveText, children }: TooltipProps): ReactElement {
  const text = resolveText(labelKey)

  // 没有句子就不存在提示：空气泡比没有气泡更糟，键名更糟。
  if (text.trim() === '') return children

  return (
    <AntTooltip
      mouseEnterDelay={0.3}
      placement={PLACEMENT}
      styles={{ body: BUBBLE_STYLE }}
      title={text}
      trigger={['hover', 'focus']}>
      {children}
    </AntTooltip>
  )
}
