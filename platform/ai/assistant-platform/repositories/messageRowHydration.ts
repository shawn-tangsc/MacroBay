import type { AssistantMessageData, AssistantMessageEntity, AssistantMessageStatus } from '../schemas/messageSchemas'

/**
 * `assistant_messages` 的一行 → 实体。
 *
 * 单独成文件是为了一件事：行形状只有这一个地方认识，加列时改这里一处；仓储文件本身已经很长。
 */
export type MessageRow = {
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
  owner_boot_id: string | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export function hydrateMessage(row: MessageRow): AssistantMessageEntity {
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
    ...(row.owner_boot_id ? { ownerBootId: row.owner_boot_id } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
