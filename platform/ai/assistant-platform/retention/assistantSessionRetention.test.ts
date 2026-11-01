import { describe, expect, it } from 'vitest'

import type { RetentionAuditEntry, RetentionRepository } from '../repositories/retentionRepository'

import {
  applySessionRetention,
  AUDIT_MAX_ENTRIES,
  AUDIT_RETENTION_DAYS,
  DEFAULT_ASSISTANT_SESSION_RETENTION,
  MAX_SESSIONS_PER_RUN,
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

function stubRepo(candidates: SessionRetentionCandidate[]) {
  const calls = {
    deleted: [] as string[],
    trimmed: [] as Array<[string, number]>,
    audits: [] as RetentionAuditEntry[],
    pruned: [] as Array<[string, number]>
  }
  const repo: RetentionRepository = {
    listCandidates: () => candidates,
    deleteTopic: (topicId: string) => { calls.deleted.push(topicId) },
    trimMessages: (topicId: string, dropCount: number) => { calls.trimmed.push([topicId, dropCount]); return dropCount },
    appendAudit: (entry: RetentionAuditEntry) => { calls.audits.push(entry) },
    pruneAudits: (cutoffIso: string, maxEntries: number) => { calls.pruned.push([cutoffIso, maxEntries]); return 0 },
    listAudits: () => calls.audits
  }
  return { calls, repo }
}

describe('assistant session retention run', () => {
  it('handles at most the per-run cap and leaves the rest for tomorrow', () => {
    const many = Array.from({ length: 600 }, (_, index) =>
      candidate({ topicId: `topic-${index}`, updatedAt: '2020-01-01T00:00:00.000Z' })
    )
    const { calls, repo } = stubRepo(many)

    const outcome = applySessionRetention(repo, DEFAULT_ASSISTANT_SESSION_RETENTION, NOW)

    expect(calls.deleted).toHaveLength(MAX_SESSIONS_PER_RUN)
    expect(outcome.deletedTopics).toBe(MAX_SESSIONS_PER_RUN)
  })

  it('prunes its own audit trail in the same run instead of letting it grow', () => {
    const { calls, repo } = stubRepo([candidate({ updatedAt: '2020-01-01T00:00:00.000Z' })])

    applySessionRetention(repo, DEFAULT_ASSISTANT_SESSION_RETENTION, NOW)

    expect(calls.pruned).toHaveLength(1)
    const [cutoff, maxEntries] = calls.pruned[0]!
    expect(maxEntries).toBe(AUDIT_MAX_ENTRIES)
    const expectedCutoff = new Date(NOW.getTime() - AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
    expect(cutoff).toBe(expectedCutoff)
  })
})
