import type { AgentConversationContext, AnalysisWorkspaceBinding } from '../../../contracts/analysisWorkspaceContracts'
import type { CalendarCardRow } from './projectUpcomingCalendarCard'

/**
 * Builds and identifies the panel's current conversation context.
 *
 * One selection at a time, shared by the timeline entries and the calendar card rows, so the
 * floating agent is never a place apart from what the reader is looking at.
 */

/** The analysis node a timeline entry stands for. */
export function contextFromAnalysisBinding(binding: AnalysisWorkspaceBinding): AgentConversationContext {
  return { kind: 'analysis-node', binding }
}

/** The calendar event a card row stands for. */
export function contextFromCalendarRow(row: CalendarCardRow): AgentConversationContext {
  return { kind: 'calendar-event', eventKey: row.eventKey, month: row.month, category: row.category, scheduledAt: row.at }
}

/**
 * A stable identity for a selection, so the panel can tell "the same thing is still selected" from
 * "the selection changed" — and so a node and an event can never collide.
 */
export function contextKey(context: AgentConversationContext | undefined): string | undefined {
  if (!context) return undefined
  return context.kind === 'analysis-node'
    ? `analysis-node:${context.binding.eventGroupId}`
    : `calendar-event:${context.eventKey}`
}

/** True when both selections are the same thing, whatever rebuilt them. */
export function isSameContext(left: AgentConversationContext | undefined, right: AgentConversationContext | undefined): boolean {
  const key = contextKey(left)
  return key !== undefined && key === contextKey(right)
}
