import { cloneElement, useId } from 'react'
import type { ReactElement } from 'react'

import './disabledHint.css'

/**
 * 被禁用的控件 + 看得见的原因（契约：`docs-private/iterations/BACKLOG.md` R145，架构师 2026-11-02 批准）。
 *
 * **只覆盖一种处境：能力在、但此刻被外部条件挡住。** 能力还没有的东西不该用这套组件去解释它为什么
 * 不能用——没有的东西整块不渲染，而不是灰着加一句理由。「一个永远点不亮的开关」和那两颗没有处理
 * 函数的顶栏图标是同一件事。
 *
 * 三条写进结构、不靠评审：
 *
 * 1. **可见文字与 `aria-describedby` 两者都要。** 只挂 `role="note"` 不关联，读屏走到控件时听不到
 *    原因；只关联不显示，鼠标用户看不到。所以这里既渲染文本节点、也把它的 id 挂到控件上。
 * 2. **不接 `Tooltip`，这是组件级的不是临时的。** 禁用的控件接不到焦点，提示就只剩鼠标能看；
 *    而「禁用控件不能靠悬停解释自己」这条，换个组件也还是同一条。
 * 3. **原因的真假由调用方实时算，组件不缓存、不记住。** 它收的是键，不是结论：用户去系统设置打开
 *    权限、回到应用，那行原因就该消失。缓存一次判断，就会让「设置没生效」和「界面没重读」长得
 *    一模一样。
 *
 * 位置：原因在控件**左侧**、同一行。右侧是控件区，把原因塞到右边会挤——这是布局判断，不是玄学。
 */
export type DisabledHintProps<K extends string = string> = {
  /** 原因的 i18n 键。句子说的是**处境**，不是动作（「先选一个助手」而不是「点击不可用」）。 */
  labelKey: K
  /** 调用方的文案解析入口；解析为空串时这一层整块不存在。 */
  resolveText: (key: K) => string
  /** 被禁用的控件。必须可聚焦（禁用的 `<button>` 也符合：它可聚焦，只是不能激活）。 */
  children: ReactElement<{ 'aria-describedby'?: string }>
}

export function DisabledHint<K extends string = string>({
  labelKey,
  resolveText,
  children
}: DisabledHintProps<K>): ReactElement {
  const reasonId = useId()
  const reason = resolveText(labelKey).trim()

  // 没有原因就不存在这一层：不渲染空段落，也不挂一个指向不存在元素的描述。
  // 半个「禁用 + 空原因」比什么都不做更糟——读者会以为界面上少了一块。
  if (reason === '') return children

  const existing = children.props['aria-describedby']
  // 追加，不覆盖：控件可能已经由一个字段级错误说明着，两条都得能被读到。
  const describedBy = existing === undefined || existing === '' ? reasonId : `${existing} ${reasonId}`

  return (
    <span className="disabled-hint">
      <span className="disabled-hint__reason" id={reasonId}>
        {reason}
      </span>
      {cloneElement(children, { 'aria-describedby': describedBy })}
    </span>
  )
}
