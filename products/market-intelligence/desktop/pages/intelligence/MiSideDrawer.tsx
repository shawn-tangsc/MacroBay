import { useCallback, useEffect } from 'react'

import { X } from 'lucide-react'

import { DRAWER_CLOSE_KEY, useDrawerText } from '@platform/ui/components/drawer'
import { IconButton } from '@platform/ui/components/icon-button'

/**
 * The product's one side drawer.
 *
 * Every product drawer uses this shell: same width, same left edge, same slide, same close
 * affordances (button and Escape). A drawer built as its own `position: fixed` panel drifts from the
 * others and, worse, its header can land under the window's drag band where clicks never reach the
 * close button.
 */
export function MiSideDrawer({ title, meta, closeLabel, onClose, children }: Readonly<{
  title: string
  /** A second line under the title: the time, the state, the meeting. */
  meta?: React.ReactNode
  /**
   * @deprecated 关闭键的读屏名归组件（平台 `ui.drawer.close`）。本属性仅为两个调用点的迁移保留：
   * 删掉它要同时改 `PolicyPathDrawer` 与 `AnalysisDetailDrawer`，那两处不在本批范围。
   */
  closeLabel?: string
  onClose: () => void
  children: React.ReactNode
}>): React.ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const closeName = useDrawerText()
  // `IconButton` asks its resolver with `(key: string)`, while the drawer's own table owns exactly one
  // key. Every key therefore resolves to that sentence: an unknown key must never blank the button's
  // only name — the same rule the drawer text table states for its own callers.
  const resolveText = useCallback((_key: string) => closeName(), [closeName])
  return <aside className="mi-analysis-drawer" role="complementary" aria-label={title}>
    <header className="mi-analysis-drawer__header">
      <div>
        <h2>{title}</h2>
        {meta ? <div className="mi-analysis-drawer__meta">{meta}</div> : null}
      </div>
      {/* The close control is the shared one: 22px, platform key, focus ring — the shell keeps its own
          Escape listener and layout, because this is a non-modal overlay, not a platform drawer. */}
      <IconButton ariaLabelKey={DRAWER_CLOSE_KEY} icon={X} onSelect={onClose} resolveText={resolveText} size="sm" />
    </header>
    <div className="mi-analysis-drawer__body">{children}</div>
  </aside>
}
