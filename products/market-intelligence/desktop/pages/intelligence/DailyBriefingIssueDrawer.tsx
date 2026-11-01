import { useEffect, useRef } from 'react'

import type { BriefingIssueGroup } from './dailyBriefingIssues'
import type { DailyBriefingText } from './dailyBriefingText'

/**
 * The details behind one grouped summary row.
 *
 * The rail stays a short list of group summaries; this drawer is the only place the individual
 * facts are listed. It is modal so the reader can close it with Escape and returns focus to the
 * summary row that opened it.
 */
export function DailyBriefingIssueDrawer({ group, text, formatTime, returnFocusTo, onClose }: Readonly<{
  group: BriefingIssueGroup
  text: DailyBriefingText
  formatTime: (value: string, precision?: 'minute' | 'second') => string
  /** The summary row that opened the drawer; focus returns here on close. */
  returnFocusTo?: HTMLElement | null
  onClose: () => void
}>): React.ReactElement {
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const returnFocusRef = useRef(returnFocusTo)
  returnFocusRef.current = returnFocusTo

  useEffect(() => {
    const previous = returnFocusRef.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previous?.focus()
    }
  }, [])

  const titleId = 'mi-issue-drawer-title'
  return <div className="mi-issue-drawer" data-issue-drawer="true">
    <div className="mi-issue-drawer__backdrop" onClick={() => onCloseRef.current()} />
    <div className="mi-issue-drawer__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}
      data-drawer-group={group.key} data-drawer-severity={group.severity}>
      <header className="mi-issue-drawer__head">
        <div className="mi-issue-drawer__tags">
          <span data-severity={group.severity}>{text.limits.severity[group.severity]}</span>
          <span data-category={group.category}>{text.limits.categories[group.category]}</span>
        </div>
        <button className="mi-issue-drawer__close" type="button" ref={closeRef} data-drawer-close onClick={() => onCloseRef.current()}>
          {text.limits.drawerClose}
        </button>
      </header>
      <h2 id={titleId}>{text.limits.drawerTitle.replace('{label}', group.label).replace('{count}', String(group.count))}</h2>
      <ol className="mi-issue-drawer__list">
        {group.issues.map((issue) => <li className="mi-issue-drawer__item" key={issue.id} data-issue-detail="true">
          <p className="mi-issue-drawer__title">{issue.title}</p>
          <p className="mi-issue-drawer__meta">
            {text.limits.roles.source}{text.labelSeparator}{issue.source} · {text.limits.roles.time}{text.labelSeparator}{formatTime(issue.at, 'minute')}
          </p>
          <p className="mi-issue-drawer__advice">{text.limits.roles.advice}{text.labelSeparator}{issue.advice}</p>
        </li>)}
      </ol>
    </div>
  </div>
}
