export type AssistantTopicEntity = {
  id: string
  assistantId?: string
  name: string
  isNameManuallyEdited: boolean
  activeNodeId?: string | null
  groupId?: string
  traceId?: string
  orderKey: string
  createdAt: string
  updatedAt: string
}

export type CreateAssistantTopicDto = {
  id?: string
  assistantId?: string
  name?: string
  isNameManuallyEdited?: boolean
  groupId?: string
  traceId?: string
}

export type UpdateAssistantTopicDto = {
  name?: string
  isNameManuallyEdited?: boolean
  assistantId?: string | null
  groupId?: string | null
  activeNodeId?: string | null
}

export type AssistantTopicListQuery = {
  assistantId?: string
  cursor?: string
  limit?: number
  pinnedFirst?: boolean
}

export const ASSISTANT_TOPICS_DEFAULT_LIMIT = 50
export const ASSISTANT_TOPICS_MAX_LIMIT = 200
