import type { ReactNode } from 'react'

import { Alert } from 'antd'

/**
 * 说明横幅：**antd warning `Alert`**（跨平台同一套渲染，产品样式表不描述第二遍）。
 *
 * 代理提示与「私有数据源」这条说明共用这一件：前者带动作（去设置代理），后者不带。
 * 为什么不做成 `InlineNotice`：它是 `nowrap + ellipsis`，会把「向开发者申请 API Key」截掉——
 * 这句不能截。窄窗折行可以（行高 1.6），截断与缩字号不行。
 *
 * 位置与间距归调用方：本组件只管这一段话与图标，不带外边距。
 */
export function NoticeBanner({ title, description, action }: Readonly<{
  /** 一句话主体（读者要读完的那句）。 */
  title: string
  /** 第二段（可选）；不要在这里放动作，动作走 `action`。 */
  description?: string
  /** 右侧动作（可无）：私有数据源这条**不传**。 */
  action?: ReactNode
}>): React.ReactElement {
  return <Alert
    action={action}
    description={description}
    message={title}
    showIcon
    type="warning" />
}
