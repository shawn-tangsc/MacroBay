import type { AgentSessionMessageEntity, MessageRole } from '@platform/ai/agent-platform/schemas/sessionSchemas'

export type AgentMessageGroup = {
  id: string
  role: MessageRole
  messages: AgentSessionMessageEntity[]
}

export function groupAgentSessionMessages(messages: readonly AgentSessionMessageEntity[]): AgentMessageGroup[] {
  const groups: AgentMessageGroup[] = []
  for (const message of sortAgentSessionMessages(messages)) {
    const last = groups.at(-1)
    if (last?.role === message.role) {
      last.messages.push(message)
      continue
    }
    groups.push({
      id: message.id,
      role: message.role,
      messages: [message]
    })
  }
  return groups
}

export function sortAgentSessionMessages(
  messages: readonly AgentSessionMessageEntity[]
): AgentSessionMessageEntity[] {
  return messages
    .map((message, index) => ({ message, index }))
    .sort((a, b) => {
      const order = compareAgentSessionMessages(a.message, b.message)
      return order === 0 ? a.index - b.index : order
    })
    .map((item) => item.message)
}

function compareAgentSessionMessages(
  a: AgentSessionMessageEntity,
  b: AgentSessionMessageEntity
): number {
  const createdAtOrder = timestampMs(a.createdAt) - timestampMs(b.createdAt)
  if (createdAtOrder !== 0) return createdAtOrder

  const updatedAtOrder = timestampMs(a.updatedAt) - timestampMs(b.updatedAt)
  if (updatedAtOrder !== 0) return updatedAtOrder

  // A turn starts with the user message, and instant failures (gateway/route errors) can be
  // written in the same millisecond as that user message. Without this tie-break the assistant
  // id (`assistant-…`) sorts before `message-…`, putting the error above the prompt it answers.
  // Only replies that are not completed yet need the reorder: a successful tool-result message
  // can legitimately share the timestamp of surrounding rows and must keep its input position.
  if (a.role === 'user' && isUnfinishedAssistantReply(b)) return -1
  if (b.role === 'user' && isUnfinishedAssistantReply(a)) return 1

  return 0
}

function isUnfinishedAssistantReply(message: AgentSessionMessageEntity): boolean {
  return message.role === 'assistant' && message.status !== 'success'
}

function timestampMs(value: string): number {
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? timestamp : 0
}
