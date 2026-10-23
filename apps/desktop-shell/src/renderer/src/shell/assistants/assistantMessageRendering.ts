import { bucketAssistantSiblingsByModel } from '@platform/ai/assistant-platform/messageTree/assistantMessageTree'
import type { AssistantMessageEntity } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import type { AssistantMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import type { AssistantStreamChunkPayload, AssistantTopicStreamSnapshot } from '@platform/ai/assistant-platform/schemas/streamSchemas'
import { extractAssistantSearchableText } from '@platform/ai/assistant-platform/schemas/messageSchemas'

export type AssistantBranchEntry = {
  message: AssistantMessageEntity
  siblingsGroup?: AssistantMessageEntity[]
}

export type RenderedAssistantMessage = {
  id: string
  createdAt: string
  role: AssistantMessageEntity['role']
  status: AssistantMessageEntity['status']
  text: string
  parts: AssistantMessagePart[]
  modelId: string | null
  modelName: string | null
  siblingBuckets: Array<{ modelId: string; messages: AssistantMessageEntity[] }>
  activeSiblingId: string
  isLiveOverlay: boolean
}

export function mergeAssistantStreamOverlay(
  messages: readonly AssistantBranchEntry[],
  streamSnapshot: AssistantTopicStreamSnapshot | null,
  bufferedChunks: readonly AssistantStreamChunkPayload[] = []
): RenderedAssistantMessage[] {
  const isLive = streamSnapshot?.status === 'streaming' || streamSnapshot?.status === 'pending'
  const overlayTextByExecution = new Map<string, string>()
  for (const chunk of bufferedChunks) {
    if (chunk.executionId && chunk.chunk.type === 'text-delta' && typeof chunk.chunk.text === 'string') {
      overlayTextByExecution.set(chunk.executionId, chunk.chunk.text)
    }
  }

  return messages.map((entry) => {
    const siblings = entry.siblingsGroup ?? [entry.message]
    const buckets = entry.message.role === 'assistant' ? bucketAssistantSiblingsByModel(siblings) : []
    const activeSiblingId = entry.message.id
    const anchorExecution = streamSnapshot?.activeExecutions.find((item) => item.anchorMessageId === entry.message.id)
    const overlayText = anchorExecution?.executionId
      ? overlayTextByExecution.get(anchorExecution.executionId)
      : undefined
    const baseText = extractAssistantSearchableText(entry.message.data)
    const text = isLive && overlayText ? overlayText : baseText

    return {
      id: entry.message.id,
      createdAt: entry.message.createdAt,
      role: entry.message.role,
      status: entry.message.status,
      text,
      parts: entry.message.data.parts,
      modelId: entry.message.modelId,
      modelName: entry.message.modelSnapshot?.name ?? null,
      siblingBuckets: buckets,
      activeSiblingId,
      isLiveOverlay: Boolean(isLive && overlayText)
    }
  })
}

export function selectAssistantSiblingIndex(
  siblings: readonly AssistantMessageEntity[],
  activeId: string
): number {
  const index = siblings.findIndex((item) => item.id === activeId)
  return index >= 0 ? index : 0
}
