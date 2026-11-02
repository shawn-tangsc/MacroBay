import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { IconButton } from '../icon-button'
import { PANEL_COLLAPSE_KEY, usePanelText } from './panelText'

import './sidePanel.css'

/**
 * 并排侧面板（形态：`docs-private/05-desktop/ui-audit/side-panel-form-2026-11-02.md`）。
 *
 * 判据：**面板出现时读者还能看到并点到主内容 → `SidePanel`；不能 → `Drawer`**。
 * 所以它没有遮罩、不锁焦点、也不监听全局 Esc——读者本来就该能在两侧之间来回走，
 * 抢走 Esc 会和页面里的 Esc 打架。
 *
 * 骨架期只落已定的部分（契约未定稿的槽位细节一律不碰）：
 * - 两档闭集 `rail` 282 / `flex` min(480px, 46vw)，比例写在组件里，调用点不传数字；
 * - 左置固定，不提供 `side`（仓库三处左置、零处右置）；
 * - 收起键归组件，读屏名走 `panelText` 常量，不经过调用方 `resolveText`；
 * - 宽度不参与过渡（会连续重排主内容），只做 120ms 的 opacity 淡入，`reduced-motion` 下 0ms。
 */

export const SIDE_PANEL_SIZES = ['rail', 'flex'] as const
export type SidePanelSize = (typeof SIDE_PANEL_SIZES)[number]

const SIZE_CSS: Record<SidePanelSize, string> = {
  rail: '282px',
  flex: 'min(480px, 46vw)'
}

export type SidePanelProps = {
  open: boolean
  /** 收起时调用；键盘收起后焦点回到触发元素，由调用方负责（组件不猜触发器是谁）。 */
  onClose: () => void
  size: SidePanelSize
  /** 标题的 i18n 键；不收句子。 */
  titleKey: string
  /** 底部动作区；**不传即不渲染**。 */
  footer?: ReactNode
  children: ReactNode
  className?: string
  resolveText: (key: string) => string
}

export function SidePanel(props: SidePanelProps): ReactElement | null {
  const { open, onClose, size, titleKey, footer, children, className, resolveText } = props
  const panelRef = useRef<HTMLElement>(null)
  /** 打开前焦点在哪：收起时还回去。谁移动了焦点，谁负责还原。 */
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const collapseLabel = usePanelText()()

  // 开：记住原焦点，再把它送进**正文**里第一个可操作项（正文没有才落在收起键上）。
  // 关：把焦点还回去——三个调用点各写一份等于没人写，而键盘用户的位置会掉到 body 上。
  // 不做焦点陷阱：Tab 仍能走回主内容，这是它与 `Drawer` 在键盘上的区别。
  useEffect(() => {
    if (!open) {
      returnFocusRef.current?.focus()
      returnFocusRef.current = null
      return
    }
    const active = document.activeElement
    returnFocusRef.current = active instanceof HTMLElement ? active : null
    const selector = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    const body = panelRef.current?.querySelector<HTMLElement>('.side-panel__body')
    const target = body?.querySelector<HTMLElement>(selector) ?? panelRef.current?.querySelector<HTMLElement>(selector)
    target?.focus()
  }, [open])

  if (!open) return null

  return (
    <aside
      aria-label={resolveText(titleKey)}
      className={['side-panel', `side-panel--${size}`, className].filter(Boolean).join(' ')}
      ref={panelRef}
      style={{ '--side-panel-width': SIZE_CSS[size] } as React.CSSProperties}>
      <header className="side-panel__header">
        <h2 className="side-panel__title">{resolveText(titleKey)}</h2>
        <IconButton
          ariaLabelKey={PANEL_COLLAPSE_KEY}
          icon={X}
          onSelect={onClose}
          // 收起键的名字是组件常量，不让调用方的解析器有机会把它变成空串。
          resolveText={(key) => (key === PANEL_COLLAPSE_KEY ? collapseLabel : key)}
          size="sm"
        />
      </header>
      <div className="side-panel__body">{children}</div>
      {footer === undefined ? null : <footer className="side-panel__footer">{footer}</footer>}
    </aside>
  )
}
