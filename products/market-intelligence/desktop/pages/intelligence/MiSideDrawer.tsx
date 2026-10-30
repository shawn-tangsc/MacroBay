import { useEffect } from 'react'

import { Button } from 'antd'
import { X } from 'lucide-react'

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
  closeLabel: string
  onClose: () => void
  children: React.ReactNode
}>): React.ReactElement {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return <aside className="mi-analysis-drawer" role="complementary" aria-label={title}>
    <header className="mi-analysis-drawer__header">
      <div>
        <h2>{title}</h2>
        {meta ? <div className="mi-analysis-drawer__meta">{meta}</div> : null}
      </div>
      <Button type="text" size="small" icon={<X aria-hidden="true" size={15} />} aria-label={closeLabel} onClick={onClose} />
    </header>
    <div className="mi-analysis-drawer__body">{children}</div>
  </aside>
}
