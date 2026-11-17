import { createPortal } from 'react-dom'

/**
 * 事件详情的**唯一承载层**（用户 2026-11-17：两条入口打开的详情一上一下）。
 *
 * 为什么必须挂到 `document.body`：指标抽屉自己带 `transform` 动画，`transform` 会**产生层叠上下文**——
 * 任何 `position: fixed` 的子孙都被锚在它身上，z-index 再大也只在抽屉那一层里比大小，永远压不过
 * 挂在 body 上的弹框（antd 默认 1000）。第一版就弹在抽屉里，同一个原因。
 *
 * 所以两条入口（右列当日事件、图表区「接下来要看的」）都必须经过这一层：
 * **后打开的详情盖在任何弹层之上**，不按组件类型分。层级值只写在 CSS 的一处 token 里
 * （`--mi-layer-detail`），组件不写数字。
 */
export function EventDetailLayer({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return createPortal(<div className="mk-detail-overlay" data-layer="detail">{children}</div>, document.body)
}
