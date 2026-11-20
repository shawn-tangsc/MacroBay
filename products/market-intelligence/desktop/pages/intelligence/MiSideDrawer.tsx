import { useCallback, useEffect } from 'react'

import { X } from 'lucide-react'

import { DRAWER_CLOSE_KEY, useDrawerText } from '@platform/ui/components/drawer'
import { createPortal } from 'react-dom'

import { IconButton } from '@platform/ui/components/icon-button'

/**
 * 同时打开的侧抽屉，后挂载的在上。Escape 只关最上面那层（用户 2026-11-20：政策抽屉要叠在
 * 日历抽屉上，一次 Esc 不许把两层都关掉）。平台 modal Drawer 自己处理 Esc，且焦点在它的
 * 另一棵 portal 树里，不会走到这里。
 */
const escapeStack: { close: () => void }[] = []

/**
 * The product's one side drawer.
 *
 * Every product drawer uses this shell: same width, same left edge, same slide, same close
 * affordances (button and Escape). A drawer built as its own `position: fixed` panel drifts from the
 * others and, worse, its header can land under the window's drag band where clicks never reach the
 * close button.
 */
export function MiSideDrawer({ title, meta, actions, footer, placement = 'left', closeLabel, onClose, returnFocusTo, layer = 'inline', children }: Readonly<{
  title: string
  /** Header controls between the title and the close button (a link out, a mode switch). */
  actions?: React.ReactNode
  /** A quiet strip under the body: attribution, counts, the licence line. */
  footer?: React.ReactNode
  /** Which screen edge it slides from. Left is the workspace's reading drawer; right is a report. */
  placement?: 'left' | 'right'
  /** A second line under the title: the time, the state, the meeting. */
  meta?: React.ReactNode
  /**
   * @deprecated 关闭键的读屏名归组件（平台 `ui.drawer.close`）。本属性仅为两个调用点的迁移保留：
   * 删掉它要同时改 `PolicyPathDrawer` 与 `AnalysisDetailDrawer`，那两处不在本批范围。
   */
  closeLabel?: string
  onClose: () => void
  /** 关闭后焦点回到哪里（触发这颗抽屉的按钮）；不传就维持原行为。 */
  returnFocusTo?: HTMLElement | null
  /**
   * `overlay` = 挂到 body、用 `--layer-modal-top` 叠在平台 modal 之上，**不加遮罩、不设焦点陷阱**
   * （用户 2026-11-20：下面那层是自己刚打开的，盖暗它像换了页）。默认 `inline` 保持原行为。
   * 只有确实要「叠在另一层上」的调用点才开，别当默认。
   */
  layer?: 'inline' | 'overlay'
  children: React.ReactNode
}>): React.ReactElement {
  useEffect(() => {
    const entry = { close: onClose }
    escapeStack.push(entry)
    const onKeyDown = (event: KeyboardEvent) => {
      // 不是最上层就让路：下层抽屉等上层卸载后才接棒，第二下 Esc 才轮到它。
      if (event.key !== 'Escape' || escapeStack[escapeStack.length - 1] !== entry) return
      event.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      const index = escapeStack.indexOf(entry)
      if (index >= 0) escapeStack.splice(index, 1)
    }
  }, [onClose])

  // 焦点回位：关闭后回到触发它的那颗按钮，别落回 body 让键盘读者从头走。
  useEffect(() => {
    if (!returnFocusTo) return undefined
    return () => { if (returnFocusTo.isConnected) returnFocusTo.focus() }
  }, [returnFocusTo])

  const closeName = useDrawerText()
  // `IconButton` asks its resolver with `(key: string)`, while the drawer's own table owns exactly one
  // key. Every key therefore resolves to that sentence: an unknown key must never blank the button's
  // only name — the same rule the drawer text table states for its own callers.
  const resolveText = useCallback((_key: string) => closeName(), [closeName])
  const panel = <aside className={`mi-analysis-drawer${layer === 'overlay' ? ' mi-analysis-drawer--overlay' : ''}`} role="complementary" aria-label={title} data-placement={placement}>
    <header className="mi-analysis-drawer__header">
      <div>
        <h2>{title}</h2>
        {meta ? <div className="mi-analysis-drawer__meta">{meta}</div> : null}
      </div>
      {/* The close control is the shared one: 22px, platform key, focus ring — the shell keeps its own
          Escape listener and layout, because this is a non-modal overlay, not a platform drawer. */}
      <div className="mi-analysis-drawer__controls">
        {actions}
        <IconButton ariaLabelKey={DRAWER_CLOSE_KEY} icon={X} onSelect={onClose} resolveText={resolveText} size="sm" />
      </div>
    </header>
    <div className="mi-analysis-drawer__body">{children}</div>
    {footer ? <footer className="mi-analysis-drawer__footer">{footer}</footer> : null}
  </aside>
  // portal 追加在 body 末尾：DOM 顺序就是「后打开的在上面」，Tab 也按这个顺序走，不会倒过来。
  return layer === 'overlay' ? createPortal(panel, document.body) : panel
}
