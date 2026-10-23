import { describe, expect, it } from 'vitest'

import {
  createSessionSeenState,
  getSessionBadgeStatus,
  markSessionSeen,
  pruneSessionSeenState,
  reconcileSessionSeenState
} from './agentSessionSeenState'

describe('agentSessionSeenState', () => {
  it('shows a done badge only when a successful assistant update is newer than the last seen time', () => {
    const state = createSessionSeenState()

    expect(
      getSessionBadgeStatus(state, {
        sessionId: 'session-1',
        runtimeStatus: 'done',
        latestAssistantUpdatedAt: '2026-01-02T00:00:00.000Z',
        isActive: false
      })
    ).toBe('done')
  })

  it('suppresses done badge after the session is marked seen', () => {
    const seen = markSessionSeen(createSessionSeenState(), 'session-1', '2026-01-02T00:00:00.000Z')

    expect(
      getSessionBadgeStatus(seen, {
        sessionId: 'session-1',
        runtimeStatus: 'done',
        latestAssistantUpdatedAt: '2026-01-02T00:00:00.000Z',
        isActive: false
      })
    ).toBe('idle')
  })

  it('never shows runtime badges for the active session', () => {
    expect(
      getSessionBadgeStatus(createSessionSeenState(), {
        sessionId: 'session-1',
        runtimeStatus: 'pending',
        latestAssistantUpdatedAt: '2026-01-02T00:00:00.000Z',
        isActive: true
      })
    ).toBe('idle')
  })

  it('keeps pending, error, and paused badges visible regardless of seen state', () => {
    const seen = markSessionSeen(createSessionSeenState(), 'session-1', '2026-01-03T00:00:00.000Z')

    expect(
      getSessionBadgeStatus(seen, {
        sessionId: 'session-1',
        runtimeStatus: 'pending',
        latestAssistantUpdatedAt: '2026-01-02T00:00:00.000Z',
        isActive: false
      })
    ).toBe('pending')
    expect(
      getSessionBadgeStatus(seen, {
        sessionId: 'session-1',
        runtimeStatus: 'error',
        latestAssistantUpdatedAt: '2026-01-02T00:00:00.000Z',
        isActive: false
      })
    ).toBe('error')
    expect(
      getSessionBadgeStatus(seen, {
        sessionId: 'session-1',
        runtimeStatus: 'paused',
        latestAssistantUpdatedAt: '2026-01-02T00:00:00.000Z',
        isActive: false
      })
    ).toBe('paused')
  })

  it('prunes removed sessions from the seen-state cache', () => {
    const state = markSessionSeen(
      markSessionSeen(createSessionSeenState(), 'session-1', '2026-01-01T00:00:00.000Z'),
      'session-2',
      '2026-01-02T00:00:00.000Z'
    )

    expect(pruneSessionSeenState(state, ['session-2'])).toEqual({ 'session-2': '2026-01-02T00:00:00.000Z' })
  })

  it('marks the active session seen and prunes removed sessions in one reconciliation pass', () => {
    const state = markSessionSeen(createSessionSeenState(), 'removed-session', '2026-01-01T00:00:00.000Z')

    expect(
      reconcileSessionSeenState(state, {
        sessionIds: ['session-1', 'session-2'],
        activeSessionId: 'session-1',
        latestAssistantUpdatedAtBySessionId: {
          'session-1': '2026-01-03T00:00:00.000Z',
          'session-2': '2026-01-02T00:00:00.000Z'
        }
      })
    ).toEqual({ 'session-1': '2026-01-03T00:00:00.000Z' })
  })

  it('keeps the same object when reconciliation has no visible change', () => {
    const state = markSessionSeen(createSessionSeenState(), 'session-1', '2026-01-03T00:00:00.000Z')

    expect(
      reconcileSessionSeenState(state, {
        sessionIds: ['session-1'],
        activeSessionId: 'session-1',
        latestAssistantUpdatedAtBySessionId: {
          'session-1': '2026-01-03T00:00:00.000Z'
        }
      })
    ).toBe(state)
  })
})
