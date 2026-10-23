import type { AssistantWebSearchMessagePart } from '../../web-search/assistant/assistantWebSearchMessageParts'

export const assistantMessageRoles = ['system', 'user', 'assistant'] as const
export type AssistantMessageRole = (typeof assistantMessageRoles)[number]

export const assistantMessageStatuses = ['pending', 'success', 'paused', 'error'] as const
export type AssistantMessageStatus = (typeof assistantMessageStatuses)[number]

export type AssistantTextMessagePart = {
  type: 'text'
  text: string
}

export type AssistantErrorMessagePart = {
  type: 'error'
  message: string
  code?: string
  /** 图像生成的失败分类码（人话由渲染层按码映射；主进程只给码 + 脱敏后的英文摘要）。 */
  reasonCode?: string
}

export type AssistantInterruptionMessagePart = {
  type: 'interruption'
  message: string
}

/**
 * T1：图片消息 part。只存引用（文件名 + 元数据），永不存 base64 ——
 * 渲染层用 `buildGeneratedImageUrl(fileName)` 得到 `app-image://` 地址，主进程从
 * `userData/generated-images/` 读盘。
 */
export type AssistantImageMessagePart = {
  type: 'image'
  kind: 'image'
  mime: string
  fileName: string
  byteLength: number
  width?: number
  height?: number
}

/**
 * T2：生成/编辑进行中的占位 part。它让「刷新 / 重开 App 后仍是生成中」也能显示正确的
 * 人话（`status:'pending'` 是既有消息状态枚举，不新增 'generating' 状态）。
 */
export type AssistantImageGenerationPart = {
  type: 'image-generation'
  status: 'generating'
  operation: 'generate' | 'edit'
}

export type AssistantGenericMessagePart = {
  type: string
} & Record<string, unknown>

export type AssistantMessagePart =
  | AssistantTextMessagePart
  | AssistantErrorMessagePart
  | AssistantInterruptionMessagePart
  | AssistantWebSearchMessagePart
  | AssistantImageMessagePart
  | AssistantImageGenerationPart
  | AssistantGenericMessagePart

export function isAssistantImageGenerationPart(part: unknown): part is AssistantImageGenerationPart {
  if (!part || typeof part !== 'object') return false
  const record = part as Record<string, unknown>
  return record.type === 'image-generation' && record.status === 'generating'
}

export function isAssistantImageMessagePart(part: unknown): part is AssistantImageMessagePart {
  if (!part || typeof part !== 'object') return false
  const record = part as Record<string, unknown>
  return (
    record.type === 'image' &&
    record.kind === 'image' &&
    typeof record.mime === 'string' &&
    typeof record.fileName === 'string' &&
    typeof record.byteLength === 'number'
  )
}

export type AssistantMessageData = {
  parts: AssistantMessagePart[]
}

export type AssistantModelSnapshot = {
  id: string
  name: string
  provider: string
  group?: string
}

export type AssistantMessageStats = {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  thoughtsTokens?: number
  cost?: number
  timeFirstTokenMs?: number
  timeCompletionMs?: number
  timeThinkingMs?: number
} & Record<string, unknown>

export type AssistantMessageEntity = {
  id: string
  topicId: string
  parentId: string | null
  role: AssistantMessageRole
  data: AssistantMessageData
  searchableText: string
  status: AssistantMessageStatus
  siblingsGroupId: number
  modelId: string | null
  modelSnapshot: AssistantModelSnapshot | null
  stats: AssistantMessageStats | null
  createdAt: string
  updatedAt: string
}

export type CreateAssistantMessageDto = {
  id?: string
  parentId?: string | null
  role: AssistantMessageRole
  data: AssistantMessageData
  status?: AssistantMessageStatus
  siblingsGroupId?: number
  modelId?: string | null
  modelSnapshot?: AssistantModelSnapshot | null
  stats?: AssistantMessageStats | null
  setAsActive?: boolean
}

export type CreateAssistantSiblingDto = {
  data: AssistantMessageData
  status?: AssistantMessageStatus
  modelId?: string | null
  modelSnapshot?: AssistantModelSnapshot | null
}

export type CreateUserMessageWithPlaceholdersDto = {
  userMessage:
    | {
        mode: 'create'
        data: AssistantMessageData
        parentAnchorId?: string | null
        id?: string
        allowDetachedRoot?: boolean
      }
    | {
        mode: 'existing'
        id: string
      }
  placeholders: Array<{
    id?: string
    modelId: string
    modelSnapshot: AssistantModelSnapshot
  }>
  siblingsGroupId?: number
}

export type AssistantActiveNodeStrategy = 'parent' | 'clear'

export type DeleteAssistantMessageOptions = {
  cascade?: boolean
  activeNodeStrategy?: AssistantActiveNodeStrategy
}

export function extractAssistantSearchableText(data: AssistantMessageData): string {
  return data.parts
    .flatMap((part) => {
      if (part.type === 'text' && typeof part.text === 'string') return [part.text]
      if (part.type === 'error' && typeof part.message === 'string') return [part.message]
      if (part.type === 'interruption' && typeof part.message === 'string') return [part.message]
      return []
    })
    .join('\n')
    .trim()
}

export function createAssistantTextData(text: string): AssistantMessageData {
  return {
    parts: [{ type: 'text', text }]
  }
}
