import type {
  AgentSessionMessageEntity,
  MessageRole,
  MessageStatus
} from '@platform/ai/agent-platform/schemas/sessionSchemas'

export type AgentMessageNavigationDirection = 'previous' | 'next'

export type AgentMessageAnchorItem = {
  id: string
  role: MessageRole
  title: string
  preview: string
  status: MessageStatus
}

export type AgentVisibleMessageEntry = {
  id: string
  element: HTMLDivElement
}

export function buildAgentMessageAnchorItems(
  messages: readonly AgentSessionMessageEntity[],
  labels: {
    assistantName: string
    userName: string
    nonTextContent: string
  }
): AgentMessageAnchorItem[] {
  return messages
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .map((message) => ({
      id: message.id,
      role: message.role,
      title: message.role === 'assistant' ? labels.assistantName : labels.userName,
      preview: getMessagePreview(message, labels.nonTextContent),
      status: message.status
    }))
}

export function getVisibleMessageIndices(
  rects: ReadonlyArray<{ top: number; bottom: number }>,
  containerHeight: number
): number[] {
  const visibilityThreshold = Math.max(containerHeight * 0.1, 24)

  return rects.flatMap((rect, index) => {
    const visibleHeight = Math.min(rect.bottom, containerHeight) - Math.max(rect.top, 0)
    return visibleHeight >= visibilityThreshold ? [index] : []
  })
}

export function getNavigationTargetIndex(input: {
  visibleIndices: readonly number[]
  total: number
  direction: AgentMessageNavigationDirection
}): number | null {
  const { visibleIndices, total, direction } = input
  if (total <= 0 || visibleIndices.length === 0) return null

  if (direction === 'previous') {
    const highestVisible = Math.min(...visibleIndices)
    return highestVisible > 0 ? highestVisible - 1 : null
  }

  const lowestVisible = Math.max(...visibleIndices)
  return lowestVisible < total - 1 ? lowestVisible + 1 : null
}

export function getVisibleMessageEntries(
  messages: readonly AgentSessionMessageEntity[],
  refs: Record<string, HTMLDivElement | null>
): AgentVisibleMessageEntry[] {
  return messages
    .filter((message) => message.role === 'assistant' || message.role === 'user')
    .map((message) => ({ id: message.id, element: refs[message.id] }))
    .filter((entry): entry is AgentVisibleMessageEntry => Boolean(entry.element))
}

function getMessagePreview(message: AgentSessionMessageEntity, fallback: string): string {
  const textPart = message.data.parts.find(
    (part): part is Extract<AgentSessionMessageEntity['data']['parts'][number], { type: 'text'; text: string }> =>
      part.type === 'text' && typeof (part as { text?: unknown }).text === 'string'
  )

  if (textPart?.text?.trim()) {
    return formatPreview(textPart.text, fallback)
  }

  const searchablePreview = message.searchableText?.trim()
  return formatPreview(searchablePreview || fallback, fallback)
}

function formatPreview(preview: string, fallback: string): string {
  const normalized = preview.trim()
  if (!normalized) return fallback
  return normalized.length > 72 ? `${normalized.slice(0, 72).trimEnd()}...` : normalized
}
