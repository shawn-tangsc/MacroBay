import { randomUUID } from 'node:crypto'

import type { AssistantPlatformDatabase } from '../db/createAssistantPlatformDatabase'
import {
  allocateSiblingsGroupId,
  collectDescendantIds,
  flattenActiveBranch,
  resolveNextActiveNodeAfterDelete,
  resolveParentIdForCreate
} from '../messageTree/assistantMessageTree'
import {
  extractAssistantSearchableText,
  type AssistantMessageData,
  type AssistantMessageEntity,
  type AssistantMessageStatus,
  type CreateAssistantMessageDto,
  type CreateAssistantSiblingDto,
  type CreateUserMessageWithPlaceholdersDto,
  type DeleteAssistantMessageOptions
} from '../schemas/messageSchemas'
import type { TopicRepository } from './topicRepository'

type MessageRow = {
  id: string
  topic_id: string
  parent_id: string | null
  role: AssistantMessageEntity['role']
  data_json: string
  searchable_text: string
  status: AssistantMessageStatus
  siblings_group_id: number
  model_id: string | null
  model_snapshot_json: string | null
  stats_json: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export type BranchMessage = {
  message: AssistantMessageEntity
  siblingsGroup?: AssistantMessageEntity[]
}

export type AssistantTopicPruneResult = {
  topicId: string
  latestTurns: number
  activeMessagesBefore: number
  activeMessagesAfter: number
  deletedMessages: number
  activeBytesBefore: number
  activeBytesAfter: number
  durationMs: number
}

export type MessageRepository = {
  getById: (id: string) => AssistantMessageEntity | null
  listByTopic: (topicId: string) => AssistantMessageEntity[]
  getBranchMessages: (
    topicId: string,
    nodeId?: string | null,
    options?: { includeSiblings?: boolean }
  ) => { activeNodeId: string | null; messages: BranchMessage[] }
  create: (topicId: string, dto: CreateAssistantMessageDto) => AssistantMessageEntity
  createSibling: (messageId: string, dto: CreateAssistantSiblingDto) => AssistantMessageEntity
  createUserMessageWithPlaceholders: (
    topicId: string,
    dto: CreateUserMessageWithPlaceholdersDto
  ) => {
    userMessage: AssistantMessageEntity
    placeholders: AssistantMessageEntity[]
  }
  update: (
    id: string,
    patch: {
      data?: AssistantMessageData
      status?: AssistantMessageStatus
      stats?: AssistantMessageEntity['stats']
      searchableText?: string
    }
  ) => AssistantMessageEntity
  delete: (id: string, options?: DeleteAssistantMessageOptions) => boolean
  clearByTopic: (topicId: string) => number
  pruneTopicToLatestTurns: (topicId: string, latestTurns: number) => AssistantTopicPruneResult
  searchInTopic: (topicId: string, query: string, limit?: number) => AssistantMessageEntity[]
}

export function createMessageRepository(
  db: AssistantPlatformDatabase,
  topics: TopicRepository
): MessageRepository {
  function insertMessage(
    topicId: string,
    dto: {
      id?: string
      parentId: string | null
      role: AssistantMessageEntity['role']
      data: AssistantMessageData
      status: AssistantMessageStatus
      siblingsGroupId?: number
      modelId?: string | null
      modelSnapshot?: AssistantMessageEntity['modelSnapshot']
      stats?: AssistantMessageEntity['stats']
      setAsActive?: boolean
    }
  ): AssistantMessageEntity {
    const now = new Date().toISOString()
    const id = dto.id?.trim() || randomUUID()
    const searchableText = extractAssistantSearchableText(dto.data)
    db.connection
      .prepare(
        `insert into assistant_messages (
          id, topic_id, parent_id, role, data_json, searchable_text, status, siblings_group_id,
          model_id, model_snapshot_json, stats_json, created_at, updated_at, deleted_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null)`
      )
      .run(
        id,
        topicId,
        dto.parentId,
        dto.role,
        JSON.stringify(dto.data),
        searchableText,
        dto.status,
        dto.siblingsGroupId ?? 0,
        dto.modelId ?? null,
        dto.modelSnapshot ? JSON.stringify(dto.modelSnapshot) : null,
        dto.stats ? JSON.stringify(dto.stats) : null,
        now,
        now
      )
    if (dto.setAsActive !== false) {
      topics.setActiveNode(topicId, id)
    }
    const created = db.connection
      .prepare('select * from assistant_messages where id = ? and deleted_at is null')
      .get(id) as MessageRow | undefined
    if (!created) throw new Error('Failed to create message.')
    return hydrateMessage(created)
  }

  return {
    getById(id) {
      const row = db.connection
        .prepare('select * from assistant_messages where id = ? and deleted_at is null')
        .get(id) as MessageRow | undefined
      return row ? hydrateMessage(row) : null
    },

    listByTopic(topicId) {
      const rows = db.connection
        .prepare(
          // `id` is a random UUID, so two messages written in the same millisecond would come back
          // in an arbitrary order. `rowid` preserves insertion order within the same timestamp.
          'select * from assistant_messages where topic_id = ? and deleted_at is null order by created_at asc, rowid asc'
        )
        .all(topicId) as MessageRow[]
      return rows.map(hydrateMessage)
    },

    getBranchMessages(topicId, nodeId, options) {
      const topic = topics.getById(topicId)
      if (!topic) throw new Error(`Topic not found: ${topicId}`)
      const all = this.listByTopic(topicId)
      const leafId = nodeId ?? topic.activeNodeId ?? null
      const path = flattenActiveBranch(all, leafId)
      const includeSiblings = options?.includeSiblings !== false
      return {
        activeNodeId: leafId,
        messages: path.map((message) => ({
          message,
          ...(includeSiblings && message.siblingsGroupId > 0
            ? {
                siblingsGroup: all.filter(
                  (item) =>
                    item.parentId === message.parentId &&
                    item.siblingsGroupId === message.siblingsGroupId
                )
              }
            : {})
        }))
      }
    },

    create(topicId, dto) {
      return db.transact(() => {
        const topic = topics.getById(topicId)
        if (!topic) throw new Error(`Topic not found: ${topicId}`)
        const messages = this.listByTopic(topicId)
        const parent = resolveParentIdForCreate({
          messages,
          activeNodeId: topic.activeNodeId,
          parentAnchorId: dto.parentId
        })
        if (!parent.ok) throw new Error(parent.message)
        return insertMessage(topicId, {
          id: dto.id,
          parentId: parent.parentId,
          role: dto.role,
          data: dto.data,
          status: dto.status ?? 'success',
          siblingsGroupId: dto.siblingsGroupId,
          modelId: dto.modelId,
          modelSnapshot: dto.modelSnapshot,
          stats: dto.stats,
          setAsActive: dto.setAsActive
        })
      })
    },

    createSibling(messageId, dto) {
      return db.transact(() => {
        const source = this.getById(messageId)
        if (!source) throw new Error(`Message not found: ${messageId}`)
        const groupId = allocateSiblingsGroupId(source.siblingsGroupId)
        if (source.siblingsGroupId === 0) {
          db.connection
            .prepare('update assistant_messages set siblings_group_id = ? where id = ?')
            .run(groupId, source.id)
        }
        return insertMessage(source.topicId, {
          parentId: source.parentId,
          role: source.role,
          data: dto.data,
          status: dto.status ?? 'pending',
          siblingsGroupId: groupId,
          modelId: dto.modelId ?? source.modelId,
          modelSnapshot: dto.modelSnapshot ?? source.modelSnapshot,
          setAsActive: true
        })
      })
    },

    createUserMessageWithPlaceholders(topicId, dto) {
      return db.transact(() => {
        let userMessage: AssistantMessageEntity
        if (dto.userMessage.mode === 'existing') {
          const existing = this.getById(dto.userMessage.id)
          if (!existing || existing.topicId !== topicId) {
            throw new Error(`User message not found: ${dto.userMessage.id}`)
          }
          userMessage = existing
        } else if (dto.userMessage.allowDetachedRoot === true) {
          userMessage = insertMessage(topicId, {
            id: dto.userMessage.id,
            parentId: null,
            role: 'user',
            data: dto.userMessage.data,
            status: 'success',
            setAsActive: false
          })
        } else {
          userMessage = this.create(topicId, {
            id: dto.userMessage.id,
            parentId: dto.userMessage.parentAnchorId,
            role: 'user',
            data: dto.userMessage.data,
            status: 'success',
            setAsActive: false
          })
        }

        const children = dto.userMessage.mode === 'create' && dto.userMessage.allowDetachedRoot === true
          ? []
          : this.listByTopic(topicId).filter((item) => item.parentId === userMessage.id)
        let groupId = dto.siblingsGroupId ?? 0
        if (dto.placeholders.length > 1 || children.some((item) => item.siblingsGroupId === 0)) {
          groupId = allocateSiblingsGroupId(groupId)
          for (const child of children) {
            if (child.siblingsGroupId === 0) {
              db.connection
                .prepare('update assistant_messages set siblings_group_id = ? where id = ?')
                .run(groupId, child.id)
            }
          }
        }

        const placeholders = dto.placeholders.map((placeholder) =>
          insertMessage(topicId, {
            id: placeholder.id,
            parentId: userMessage.id,
            role: 'assistant',
            data: { parts: [] },
            status: 'pending',
            siblingsGroupId: groupId,
            modelId: placeholder.modelId,
            modelSnapshot: placeholder.modelSnapshot,
            setAsActive: false
          })
        )

        const activeId = placeholders[placeholders.length - 1]?.id ?? userMessage.id
        topics.setActiveNode(topicId, activeId)
        return { userMessage, placeholders }
      })
    },

    update(id, patch) {
      return db.transact(() => {
        const existing = this.getById(id)
        if (!existing) throw new Error(`Message not found: ${id}`)
        const now = new Date().toISOString()
        const data = patch.data ?? existing.data
        const searchableText =
          patch.searchableText ??
          (patch.data ? extractAssistantSearchableText(patch.data) : existing.searchableText)
        db.connection
          .prepare(
            `update assistant_messages set
              data_json = ?, searchable_text = ?, status = ?, stats_json = ?, updated_at = ?
             where id = ?`
          )
          .run(
            JSON.stringify(data),
            searchableText,
            patch.status ?? existing.status,
            patch.stats !== undefined
              ? patch.stats
                ? JSON.stringify(patch.stats)
                : null
              : existing.stats
                ? JSON.stringify(existing.stats)
                : null,
            now,
            id
          )
        const updated = this.getById(id)
        if (!updated) throw new Error(`Message not found after update: ${id}`)
        return updated
      })
    },

    delete(id, options = {}) {
      return db.transact(() => {
        const existing = this.getById(id)
        if (!existing) return false
        const topic = topics.getById(existing.topicId)
        const cascade = options.cascade !== false
        const now = new Date().toISOString()
        const all = this.listByTopic(existing.topicId)

        if (cascade) {
          const ids = collectDescendantIds(all, id)
          for (const messageId of ids) {
            db.connection
              .prepare('update assistant_messages set deleted_at = ?, updated_at = ? where id = ?')
              .run(now, now, messageId)
          }
        } else {
          db.connection
            .prepare('update assistant_messages set parent_id = ? where parent_id = ? and deleted_at is null')
            .run(existing.parentId, id)
          db.connection
            .prepare('update assistant_messages set deleted_at = ?, updated_at = ? where id = ?')
            .run(now, now, id)
        }

        if (topic) {
          const deletedIds = new Set(cascade ? collectDescendantIds(all, id) : [id])
          const activeWasDeleted = topic.activeNodeId != null && deletedIds.has(topic.activeNodeId)
          const nextActive = activeWasDeleted
            ? resolveNextActiveNodeAfterDelete({
                deletedId: topic.activeNodeId!,
                activeNodeId: topic.activeNodeId,
                parentId: existing.parentId,
                strategy: options.activeNodeStrategy ?? 'parent'
              })
            : (topic.activeNodeId ?? null)
          // If strategy kept a node that was also cascade-deleted, clear it.
          const safeActive =
            nextActive && deletedIds.has(nextActive)
              ? options.activeNodeStrategy === 'clear'
                ? null
                : existing.parentId && !deletedIds.has(existing.parentId)
                  ? existing.parentId
                  : null
              : nextActive
          topics.setActiveNode(existing.topicId, safeActive)
        }
        return true
      })
    },

    clearByTopic(topicId) {
      return db.transact(() => {
        const now = new Date().toISOString()
        const result = db.connection
          .prepare('update assistant_messages set deleted_at = ?, updated_at = ? where topic_id = ? and deleted_at is null')
          .run(now, now, topicId)
        topics.setActiveNode(topicId, null)
        return Number(result.changes ?? 0)
      })
    },

    pruneTopicToLatestTurns(topicId, latestTurns) {
      return db.transact(() => {
        const startedAt = Date.now()
        const limit = Math.max(0, Math.floor(latestTurns))
        const now = new Date().toISOString()
        const before = readTopicActiveStats(db, topicId)
        if (limit <= 0) {
          const deletedMessages = this.clearByTopic(topicId)
          return {
            topicId,
            latestTurns: limit,
            activeMessagesBefore: before.activeMessages,
            activeMessagesAfter: 0,
            deletedMessages,
            activeBytesBefore: before.activeBytes,
            activeBytesAfter: 0,
            durationMs: Date.now() - startedAt
          }
        }

        const result = db.connection
          .prepare(
            `with keep_users as (
               select id from assistant_messages
               where topic_id = ? and deleted_at is null and role = 'user'
               order by rowid desc
               limit ?
             ),
             keep_messages as (
               select id from keep_users
               union
               select child.id from assistant_messages child
               join keep_users on child.parent_id = keep_users.id
               where child.topic_id = ? and child.deleted_at is null
             )
             update assistant_messages
             set deleted_at = ?, updated_at = ?
             where topic_id = ?
               and deleted_at is null
               and id not in (select id from keep_messages)`
          )
          .run(topicId, limit, topicId, now, now, topicId)

        const topic = topics.getById(topicId)
        if (topic && topic.activeNodeId) {
          const activeStillPresent = db.connection
            .prepare('select id from assistant_messages where id = ? and topic_id = ? and deleted_at is null')
            .get(topic.activeNodeId, topicId) as { id: string } | undefined
          if (!activeStillPresent) {
            const activeRow = db.connection
              .prepare(
                `select id from assistant_messages
                 where topic_id = ? and deleted_at is null
                 order by rowid desc
                 limit 1`
              )
              .get(topicId) as { id: string } | undefined
            topics.setActiveNode(topicId, activeRow?.id ?? null)
          }
        } else if (topic) {
          const activeRow = db.connection
            .prepare(
              `select id from assistant_messages
               where topic_id = ? and deleted_at is null
               order by rowid desc
               limit 1`
            )
            .get(topicId) as { id: string } | undefined
          topics.setActiveNode(topicId, activeRow?.id ?? null)
        }

        const after = readTopicActiveStats(db, topicId)
        return {
          topicId,
          latestTurns: limit,
          activeMessagesBefore: before.activeMessages,
          activeMessagesAfter: after.activeMessages,
          deletedMessages: Number(result.changes ?? 0),
          activeBytesBefore: before.activeBytes,
          activeBytesAfter: after.activeBytes,
          durationMs: Date.now() - startedAt
        }
      })
    },

    searchInTopic(topicId, query, limit = 50) {
      const keyword = query.trim().toLowerCase()
      if (!keyword) return []
      const rows = db.connection
        .prepare(
          `select * from assistant_messages
           where topic_id = ? and deleted_at is null and lower(searchable_text) like ?
           order by created_at desc, id desc
           limit ?`
        )
        .all(topicId, `%${keyword}%`, Math.max(1, Math.min(limit, 200))) as MessageRow[]
      return rows.map(hydrateMessage)
    }
  }
}

function readTopicActiveStats(db: AssistantPlatformDatabase, topicId: string): {
  activeMessages: number
  activeBytes: number
} {
  const row = db.connection
    .prepare(
      `select count(*) as active_messages,
              coalesce(sum(length(data_json)), 0) as active_bytes
       from assistant_messages
       where topic_id = ? and deleted_at is null`
    )
    .get(topicId) as { active_messages: number; active_bytes: number } | undefined
  return {
    activeMessages: Number(row?.active_messages ?? 0),
    activeBytes: Number(row?.active_bytes ?? 0)
  }
}

function hydrateMessage(row: MessageRow): AssistantMessageEntity {
  return {
    id: row.id,
    topicId: row.topic_id,
    parentId: row.parent_id,
    role: row.role,
    data: JSON.parse(row.data_json) as AssistantMessageData,
    searchableText: row.searchable_text,
    status: row.status,
    siblingsGroupId: row.siblings_group_id,
    modelId: row.model_id,
    modelSnapshot: row.model_snapshot_json
      ? (JSON.parse(row.model_snapshot_json) as AssistantMessageEntity['modelSnapshot'])
      : null,
    stats: row.stats_json ? (JSON.parse(row.stats_json) as AssistantMessageEntity['stats']) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
