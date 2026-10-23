import { useState, type ReactNode } from 'react'
import { Bot, CalendarDays, PanelRightClose } from 'lucide-react'

/**
 * The right column's slot: one of two views, plus a collapsible agent.
 *
 * Both views stay mounted and are hidden rather than unmounted, because the agent owns a
 * conversation, a timeline selection and a drag width — collapsing it must not throw that
 * away. State is session-local on purpose: per the design, nothing here is persisted.
 */

export type IntelligenceRightColumnText = Readonly<{
  switchToAgent: string; switchToCalendar: string; collapseAgent: string; expandAgent: string
}>

export function IntelligenceRightColumn({ card, children, text, initialView = 'card' }: Readonly<{
  card: ReactNode
  /** The agent view, passed as children so the caller keeps ownership of it. */
  children: ReactNode
  text: IntelligenceRightColumnText
  initialView?: 'card' | 'agent'
}>): React.ReactElement {
  const [view, setView] = useState<'card' | 'agent'>(initialView)
  const [collapsed, setCollapsed] = useState(false)
  const agentCollapsed = view === 'agent' && collapsed
  return <div className="mi-right-column" data-right-column-view={agentCollapsed ? 'agent-collapsed' : view}>
    <div className="mi-right-column__controls">
      <button aria-label={view === 'agent' ? text.switchToCalendar : text.switchToAgent} className="mi-right-column__switch"
        onClick={() => setView(view === 'agent' ? 'card' : 'agent')} type="button">
        {view === 'agent' ? <CalendarDays aria-hidden="true" size={15} /> : <Bot aria-hidden="true" size={15} />}
      </button>
      {view === 'agent' ? <button aria-expanded={!collapsed} aria-label={collapsed ? text.expandAgent : text.collapseAgent}
        className="mi-right-column__collapse" onClick={() => setCollapsed(!collapsed)} type="button">
        <PanelRightClose aria-hidden="true" size={15} />
      </button> : null}
    </div>
    <div className="mi-right-column__body">
      {/* Hidden, never unmounted: the agent keeps its conversation and selection. */}
      <div hidden={view !== 'card'}>{card}</div>
      <div hidden={view !== 'agent' || collapsed}>{children}</div>
      {agentCollapsed ? <button aria-label={text.expandAgent} className="mi-right-column__rail" onClick={() => setCollapsed(false)} type="button">
        <Bot aria-hidden="true" size={16} />
      </button> : null}
    </div>
  </div>
}
