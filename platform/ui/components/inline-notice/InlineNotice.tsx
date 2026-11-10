import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'

import type { ReactNode } from 'react'

/**
 * 行内提示条（平台唯一）：把「这句话是什么性质」画出来，而不是塞一行灰字。
 *
 * 三档语义，颜色与角色都绑死在档位上（调用方不再自己挑颜色）：

 * - `info`：中性（提示、说明性状态）——`role="status"`
 * - `caution`：**黄色**（`--caution`）：「配置不完整，功能降级但不报错」——`role="status"`
 * - `danger`：**红色**（`--danger`）：保存失败、读失败——`role="alert"`
 *
 * 三条硬规矩：
 * 1. **不是浮层、不可关闭**：它跟随状态在位，状态没了它就不渲染；
 * 2. 文案一行（过长由 CSS 压短），细节进 ⓘ / popover，不在这里铺长句；
 * 3. 颜色只走 token，不写字面色值；图标左侧一颗 16，与文字间距 8。
 */
export type InlineNoticeTone = 'info' | 'caution' | 'danger'

const ICONS = { info: Info, caution: AlertTriangle, danger: OctagonAlert } as const

export function InlineNotice({ tone, children }: Readonly<{
  tone: InlineNoticeTone
  /** 一句话（已解析好的文案）。 */
  children: ReactNode
}>): React.ReactElement {
  const Icon = ICONS[tone]
  const role = tone === 'danger' ? 'alert' : 'status'
  return <div className={`inline-notice inline-notice--${tone}`} data-inline-notice={tone} role={role}>
    <Icon aria-hidden="true" size={16} />
    <span className="inline-notice__text">{children}</span>
  </div>
}
