import { expect, it } from 'vitest'
import type { AgentConversationContext } from '../../../contracts/analysisWorkspaceContracts'
import { contextFromAnalysisBinding, contextFromCalendarRow, contextKey, isSameContext } from './agentConversationContext'

const binding = { agentId: 'crypto-market-analyst', eventGroupId: 'g-1', analysisRunId: 'r-1', summaryId: 's-1', asOf: '2026-10-11T00:00:00.000Z' }
const row = { eventKey: 'market-observation-1', titleKey: 'cpi', month: '2026-10', date: '2026-10-13', at: '2026-10-13T12:30:00.000Z', importance: 'high' as const, category: 'economic-indicator' as const, kind: 'upcoming' as const, actual: null, previous: null, consensus: null }

it('carries the node a timeline entry stands for', () => {
  expect(contextFromAnalysisBinding(binding)).toEqual({ kind: 'analysis-node', binding })
})

it('carries the event a card row stands for, including when it has no time', () => {
  expect(contextFromCalendarRow(row as never)).toMatchObject({ kind: 'calendar-event', eventKey: 'market-observation-1', month: '2026-10', scheduledAt: '2026-10-13T12:30:00.000Z' })
  expect(contextFromCalendarRow({ ...row, at: null } as never)).toMatchObject({ scheduledAt: null })
})

it('identifies a selection so a node and an event can never collide', () => {
  const node = contextFromAnalysisBinding(binding)
  const event = contextFromCalendarRow(row as never)
  expect(contextKey(node)).toBe('analysis-node:g-1')
  expect(contextKey(event)).toBe('calendar-event:market-observation-1')
  expect(contextKey(undefined)).toBeUndefined()
  expect(isSameContext(node, contextFromAnalysisBinding({ ...binding }))).toBe(true)
  expect(isSameContext(node, event)).toBe(false)
  // Nothing selected is never "the same as" a selection.
  expect(isSameContext(undefined, undefined)).toBe(false)
})

it('accepts both variants as one context type', () => {
  const contexts: readonly AgentConversationContext[] = [contextFromAnalysisBinding(binding), contextFromCalendarRow(row as never)]
  expect(contexts.map(context => context.kind)).toEqual(['analysis-node', 'calendar-event'])
})
