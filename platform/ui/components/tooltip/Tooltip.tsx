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

/** 提示文案的字数上限：超了要改成可见说明或折叠详情，提示不是文档。 */
export const TOOLTIP_MAX_CJK = 28
export const TOOLTIP_MAX_LATIN = 60

export type TooltipProps = {
  /** 提示文案的 i18n 键；不收字面量。 */
  labelKey: string
  /** 调用方的文案解析入口；未知键返回空串时本组件不渲染提示。 */
  resolveText: (key: string) => string
  /** 触发器：必须是可聚焦元素（按钮、链接、带 tabIndex 的元素）。 */
  children: ReactElement
  /** 默认下方；空间不足时 antd 自动翻到上方。 */
  placement?: 'bottom' | 'top'
}

export function Tooltip({ labelKey, resolveText, children, placement = 'bottom' }: TooltipProps): ReactElement {
  const text = resolveText(labelKey)

  // 没有句子就不存在提示：空气泡比没有气泡更糟，键名更糟。
  if (text.trim() === '') return children

  return (
    <AntTooltip mouseEnterDelay={0.3} placement={placement} title={text} trigger={['hover', 'focus']}>
      {children}
    </AntTooltip>
  )
}
