import type { AssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'

export type RetentionAuditEntry = {
  id: string
  ranAt: string
  cutoffAt: string
  reason: 'age' | 'message-count'
  limitValue: number
  deletedTopics: number
  deletedMessages: number
}

export type SessionRetentionRow = {
  topicId: string
  pinned: boolean
  updatedAt: string
  messageCount: number
}

export type RetentionRepository = {
  listCandidates: () => SessionRetentionRow[]
  deleteTopic: (topicId: string) => void
  /** 从最旧的开始删掉 `dropCount` 条消息。 */
  trimMessages: (topicId: string, dropCount: number) => number
  appendAudit: (entry: RetentionAuditEntry) => void
  listAudits: (limit?: number) => RetentionAuditEntry[]
}

type CandidateRow = {
  id: string
  updated_at: string
  pinned: number
  message_count: number
}

export function createRetentionRepository(db: AssistantPlatformDatabase): RetentionRepository {
  return {
    listCandidates() {
      const rows = db.connection
        .prepare(
          `select t.id as id,
                  t.updated_at as updated_at,
                  case when p.topic_id is null then 0 else 1 end as pinned,
                  (select count(*) from assistant_messages m
                    where m.topic_id = t.id and m.deleted_at is null) as message_count
             from assistant_topics t
             left join assistant_pins p on p.topic_id = t.id
            where t.deleted_at is null`
        )
        .all() as CandidateRow[]

      return rows.map((row) => ({
        topicId: row.id,
        pinned: row.pinned === 1,
        updatedAt: row.updated_at,
        messageCount: row.message_count
      }))
    },

    deleteTopic(topicId) {
      // 消息与置顶记录都由外键 cascade 带走；这里只负责会话本体。
      db.connection.prepare('delete from assistant_topics where id = ?').run(topicId)
    },

    trimMessages(topicId, dropCount) {
      const doomed = db.connection
        .prepare(
          `select id from assistant_messages
            where topic_id = ? and deleted_at is null
            order by created_at asc, rowid asc
            limit ?`
        )
        .all(topicId, Math.max(0, dropCount)) as Array<{ id: string }>
      if (doomed.length === 0) return 0
      const statement = db.connection.prepare('delete from assistant_messages where id = ?')
      db.transact(() => {
        for (const row of doomed) statement.run(row.id)
      })
      return doomed.length
    },

    appendAudit(entry) {
      db.connection
        .prepare(
          `insert into assistant_retention_audits
             (id, ran_at, cutoff_at, reason, limit_value, deleted_topics, deleted_messages)
           values (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          entry.id,
          entry.ranAt,
          entry.cutoffAt,
          entry.reason,
          entry.limitValue,
          entry.deletedTopics,
          entry.deletedMessages
        )
    },

    listAudits(limit = 50) {
      const rows = db.connection
        .prepare(
          `select id, ran_at, cutoff_at, reason, limit_value, deleted_topics, deleted_messages
             from assistant_retention_audits
            order by ran_at desc
            limit ?`
        )
        .all(Math.max(1, Math.min(limit, 500))) as Array<{
        id: string
        ran_at: string
        cutoff_at: string
        reason: RetentionAuditEntry['reason']
        limit_value: number
        deleted_topics: number
        deleted_messages: number
      }>

      return rows.map((row) => ({
        id: row.id,
        ranAt: row.ran_at,
        cutoffAt: row.cutoff_at,
        reason: row.reason,
        limitValue: row.limit_value,
        deletedTopics: row.deleted_topics,
        deletedMessages: row.deleted_messages
      }))
    }
  }
}
