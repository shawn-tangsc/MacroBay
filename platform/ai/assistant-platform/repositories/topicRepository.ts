import { randomUUID } from 'node:crypto'

import type { AssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import {
  ASSISTANT_TOPICS_DEFAULT_LIMIT,
  ASSISTANT_TOPICS_MAX_LIMIT,
  type AssistantTopicEntity,
  type AssistantTopicListQuery,
  type CreateAssistantTopicDto,
  type UpdateAssistantTopicDto
} from '../schemas/topicSchemas'
import { nextOrderKey } from './assistantRepository'

type TopicRow = {
  id: string
  assistant_id: string | null
  name: string
  is_name_manually_edited: number
  active_node_id: string | null
  group_id: string | null
  trace_id: string | null
  order_key: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type AssistantTopicListResult = {
  topics: AssistantTopicEntity[]
  nextCursor: string | null
  pinnedIds: string[]
}

export type TopicRepository = {
  getById: (id: string) => AssistantTopicEntity | null
  create: (dto: CreateAssistantTopicDto) => AssistantTopicEntity
  update: (id: string, dto: UpdateAssistantTopicDto) => AssistantTopicEntity
  delete: (id: string) => boolean
  setActiveNode: (id: string, nodeId: string | null) => AssistantTopicEntity
  listByProductTemplateAndGroup: (query: {
    sourceProductId: string
    templateId: string
    groupId: string
  }) => AssistantTopicEntity[]
  listByCursor: (query?: AssistantTopicListQuery) => AssistantTopicListResult
  pin: (topicId: string) => void
  unpin: (topicId: string) => void
  listPinnedIds: () => string[]
}

export function createTopicRepository(db: AssistantPlatformDatabase): TopicRepository {
  return {
    getById(id) {
      const row = db.connection
        .prepare('select * from assistant_topics where id = ? and deleted_at is null')
        .get(id) as TopicRow | undefined
      return row ? hydrateTopic(row) : null
    },

    create(dto) {
      return db.transact(() => {
        const now = new Date().toISOString()
        const id = dto.id?.trim() || randomUUID()
        db.connection
          .prepare(
            `insert into assistant_topics (
              id, assistant_id, name, is_name_manually_edited, active_node_id, group_id, trace_id, order_key, created_at, updated_at, deleted_at
            ) values (?, ?, ?, ?, null, ?, ?, ?, ?, ?, null)`
          )
          .run(
            id,
            dto.assistantId ?? null,
            dto.name?.trim() ?? '',
            dto.isNameManuallyEdited === true ? 1 : 0,
            dto.groupId ?? null,
            dto.traceId ?? null,
            nextOrderKey(db, 'assistant_topics'),
            now,
            now
          )
        const created = this.getById(id)
        if (!created) throw new Error('Failed to create topic.')
        return created
      })
    },

    update(id, dto) {
      return db.transact(() => {
        const existing = this.getById(id)
        if (!existing) throw new Error(`Topic not found: ${id}`)
        const now = new Date().toISOString()
        db.connection
          .prepare(
            `update assistant_topics set
              name = ?, is_name_manually_edited = ?, assistant_id = ?, group_id = ?, active_node_id = ?, updated_at = ?
             where id = ?`
          )
          .run(
            dto.name !== undefined ? dto.name.trim() : existing.name,
            dto.isNameManuallyEdited !== undefined
              ? dto.isNameManuallyEdited
                ? 1
                : 0
              : existing.isNameManuallyEdited
                ? 1
                : 0,
            dto.assistantId !== undefined ? dto.assistantId : existing.assistantId ?? null,
            dto.groupId !== undefined ? dto.groupId : existing.groupId ?? null,
            dto.activeNodeId !== undefined ? dto.activeNodeId : existing.activeNodeId ?? null,
            now,
            id
          )
        const updated = this.getById(id)
        if (!updated) throw new Error(`Topic not found after update: ${id}`)
        return updated
      })
    },

    delete(id) {
      return db.transact(() => {
        const now = new Date().toISOString()
        const result = db.connection
          .prepare('update assistant_topics set deleted_at = ?, updated_at = ? where id = ? and deleted_at is null')
          .run(now, now, id)
        return Number(result.changes ?? 0) > 0
      })
    },

    setActiveNode(id, nodeId) {
      return this.update(id, { activeNodeId: nodeId })
    },

    listByProductTemplateAndGroup(query) {
      const rows = db.connection
        .prepare(
          `select topics.* from assistant_topics topics
           join assistant_template_installs installs on installs.assistant_id = topics.assistant_id
           where topics.deleted_at is null
             and topics.group_id = ?
             and installs.source_kind = 'product'
             and installs.source_product_id = ?
             and installs.source_template_id = ?
           order by topics.order_key asc, topics.id asc`
        )
        .all(query.groupId, query.sourceProductId, normalizeTemplateId(query)) as TopicRow[]
      return rows.map(hydrateTopic)
    },

    listByCursor(query = {}) {
      const limit = Math.min(
        Math.max(query.limit ?? ASSISTANT_TOPICS_DEFAULT_LIMIT, 1),
        ASSISTANT_TOPICS_MAX_LIMIT
      )
      const pinnedIds = this.listPinnedIds()
      const params: Array<string | number> = []
      let sql =
        'select * from assistant_topics where deleted_at is null'
      if (query.assistantId) {
        sql += ' and assistant_id = ?'
        params.push(query.assistantId)
      }
      if (query.cursor) {
        sql += ' and (order_key > ? or (order_key = ? and id > ?))'
        params.push(query.cursor, query.cursor, query.cursor)
      }
      sql += ' order by order_key asc, id asc limit ?'
      params.push(limit + 1)

      const rows = db.connection.prepare(sql).all(...params) as TopicRow[]
      const page = rows.slice(0, limit).map(hydrateTopic)
      const nextCursor = rows.length > limit ? page[page.length - 1]?.orderKey ?? null : null

      if (query.pinnedFirst !== false && !query.cursor) {
        const pinnedSet = new Set(pinnedIds)
        page.sort((left, right) => {
          const leftPinned = pinnedSet.has(left.id) ? 0 : 1
          const rightPinned = pinnedSet.has(right.id) ? 0 : 1
          if (leftPinned !== rightPinned) return leftPinned - rightPinned
          return left.orderKey.localeCompare(right.orderKey) || left.id.localeCompare(right.id)
        })
      }

      return { topics: page, nextCursor, pinnedIds }
    },

    pin(topicId) {
      db.connection
        .prepare(
          'insert into assistant_pins (topic_id, pinned_at) values (?, ?) on conflict(topic_id) do update set pinned_at = excluded.pinned_at'
        )
        .run(topicId, new Date().toISOString())
    },

    unpin(topicId) {
      db.connection.prepare('delete from assistant_pins where topic_id = ?').run(topicId)
    },

    listPinnedIds() {
      const rows = db.connection
        .prepare('select topic_id as id from assistant_pins order by pinned_at desc')
        .all() as Array<{ id: string }>
      return rows.map((row) => row.id)
    }
  }
}

function normalizeTemplateId(query: { sourceProductId: string; templateId: string }): string {
  if (query.templateId.includes(':')) return query.templateId
  return `product:${query.sourceProductId}:${query.templateId}`
}

function hydrateTopic(row: TopicRow): AssistantTopicEntity {
  return {
    id: row.id,
    ...(row.assistant_id ? { assistantId: row.assistant_id } : {}),
    name: row.name,
    isNameManuallyEdited: row.is_name_manually_edited === 1,
    activeNodeId: row.active_node_id,
    ...(row.group_id ? { groupId: row.group_id } : {}),
    ...(row.trace_id ? { traceId: row.trace_id } : {}),
    orderKey: row.order_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
