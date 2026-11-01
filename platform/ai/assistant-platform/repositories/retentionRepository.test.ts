import { describe, expect, it } from 'vitest'

import { createAssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import { applySessionRetention, DEFAULT_ASSISTANT_SESSION_RETENTION } from '../retention/assistantSessionRetention'
import { createRetentionRepository } from './retentionRepository'

function seedTopic(
  db: ReturnType<typeof createAssistantPlatformDatabase>,
  id: string,
  updatedAt: string,
  messageCount: number,
  pinned = false
): void {
  db.connection
    .prepare(
      `insert into assistant_topics (id, assistant_id, name, is_name_manually_edited, order_key, created_at, updated_at)
       values (?, null, ?, 0, ?, ?, ?)`
    )
    .run(id, id, id, updatedAt, updatedAt)
  const insertMessage = db.connection.prepare(
    `insert into assistant_messages (id, topic_id, parent_id, role, data_json, searchable_text, status, siblings_group_id, created_at, updated_at)
     values (?, ?, null, 'user', '{"parts":[]}', '', 'success', 0, ?, ?)`
  )
  for (let index = 0; index < messageCount; index += 1) {
    insertMessage.run(`${id}-m${index}`, id, `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.000Z`, updatedAt)
  }
  if (pinned) {
    db.connection.prepare('insert into assistant_pins (topic_id, pinned_at) values (?, ?)').run(id, updatedAt)
  }
}

describe('retention repository', () => {
  it('lists candidates with pin state and live message counts', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    seedTopic(db, 'old', '2020-01-01T00:00:00.000Z', 2)
    seedTopic(db, 'pinned', '2020-01-01T00:00:00.000Z', 1, true)
    const repo = createRetentionRepository(db)

    const candidates = repo.listCandidates()

    expect(candidates.find((row) => row.topicId === 'old')).toMatchObject({ pinned: false, messageCount: 2 })
    expect(candidates.find((row) => row.topicId === 'pinned')).toMatchObject({ pinned: true, messageCount: 1 })
  })

  it('deletes a topic with its messages and pin', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    seedTopic(db, 'gone', '2020-01-01T00:00:00.000Z', 3, true)
    const repo = createRetentionRepository(db)

    repo.deleteTopic('gone')

    expect(repo.listCandidates()).toEqual([])
    expect(
      db.connection.prepare('select count(*) as n from assistant_messages where topic_id = ?').get('gone')
    ).toEqual({ n: 0 })
  })

  it('trims the oldest messages and reports how many went', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    seedTopic(db, 'big', '2026-10-01T00:00:00.000Z', 5)
    const repo = createRetentionRepository(db)

    expect(repo.trimMessages('big', 2)).toBe(2)
    expect(repo.listCandidates()[0]?.messageCount).toBe(3)
  })

  it('applies the policy end to end and leaves one audit per reason', () => {
    const db = createAssistantPlatformDatabase(':memory:')
    seedTopic(db, 'ancient', '2020-01-01T00:00:00.000Z', 2)
    seedTopic(db, 'huge', '2026-10-01T00:00:00.000Z', 10_005)
    seedTopic(db, 'kept', '2026-10-01T00:00:00.000Z', 3)
    const repo = createRetentionRepository(db)

    const outcome = applySessionRetention(repo, DEFAULT_ASSISTANT_SESSION_RETENTION, new Date('2026-11-01T00:00:00.000Z'))

    expect(outcome.deletedTopics).toBe(1)
    expect(outcome.deletedMessages).toBe(2 + 5)
    expect(outcome.audits.map((audit) => audit.reason).sort()).toEqual(['age', 'message-count'])
    expect(repo.listAudits()).toHaveLength(2)
    expect(repo.listCandidates().map((row) => row.topicId)).toEqual(['huge', 'kept'])
    expect(repo.listCandidates().find((row) => row.topicId === 'huge')?.messageCount).toBe(10_000)
  })
})
