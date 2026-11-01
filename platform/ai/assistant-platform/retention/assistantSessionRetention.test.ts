import { describe, expect, it } from 'vitest'

import {
  DEFAULT_ASSISTANT_SESSION_RETENTION,
  planSessionRetention,
  type SessionRetentionCandidate
} from './assistantSessionRetention'

const NOW = new Date('2026-11-01T00:00:00.000Z')

function candidate(overrides: Partial<SessionRetentionCandidate>): SessionRetentionCandidate {
  return {
    topicId: 'topic-1',
    pinned: false,
    updatedAt: '2026-10-01T00:00:00.000Z',
    messageCount: 10,
    ...overrides
  }
}

describe('assistant session retention', () => {
  it('keeps the agreed starting parameters', () => {
    expect(DEFAULT_ASSISTANT_SESSION_RETENTION).toEqual({
      maxAgeDays: 365,
      maxMessagesPerSession: 10_000
    })
  })

  it('deletes a conversation older than the age cap', () => {
    const decisions = planSessionRetention(
      [candidate({ updatedAt: '2025-09-01T00:00:00.000Z' })],
      DEFAULT_ASSISTANT_SESSION_RETENTION,
      NOW
    )

    expect(decisions).toEqual([
      { topicId: 'topic-1', action: 'delete-topic', dropMessages: 10, reason: 'age', limitValue: 365 }
    ])
  })

  it('keeps a conversation inside the age cap even when it is quiet', () => {
    expect(planSessionRetention([candidate({})], DEFAULT_ASSISTANT_SESSION_RETENTION, NOW)).toEqual([])
  })

  it('never deletes a pinned conversation, however old it is', () => {
    const decisions = planSessionRetention(
      [candidate({ pinned: true, updatedAt: '2020-01-01T00:00:00.000Z', messageCount: 50_000 })],
      DEFAULT_ASSISTANT_SESSION_RETENTION,
      NOW
    )

    expect(decisions).toEqual([])
  })

  it('trims only the overflow above the message cap', () => {
    const decisions = planSessionRetention(
      [candidate({ messageCount: 10_050 })],
      DEFAULT_ASSISTANT_SESSION_RETENTION,
      NOW
    )

    expect(decisions).toEqual([
      {
        topicId: 'topic-1',
        action: 'trim-messages',
        dropMessages: 50,
        reason: 'message-count',
        limitValue: 10_000
      }
    ])
  })

  it('lets the age cap win when both would fire', () => {
    const decisions = planSessionRetention(
      [candidate({ updatedAt: '2020-01-01T00:00:00.000Z', messageCount: 50_000 })],
      DEFAULT_ASSISTANT_SESSION_RETENTION,
      NOW
    )

    expect(decisions.map((decision) => decision.reason)).toEqual(['age'])
  })
})
