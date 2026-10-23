import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

import type { AgentRuntimeActivityCard } from './agentRuntimeActivityViewModel'

const PERSISTED_RUNTIME_PART_PREFIX = 'claude-sdk-'

/**
 * The assistant message is patched while the turn streams, so its parts already carry the same
 * tool calls the live activity panel renders. Reading them here keeps the trace to one copy.
 */
export function hasPersistedRuntimeParts(
  messages: readonly Pick<AgentSessionMessageEntity, 'data'>[]
): boolean {
  return messages.some((message) =>
    message.data.parts.some(
      (part) => typeof part.type === 'string' && part.type.startsWith(PERSISTED_RUNTIME_PART_PREFIX)
    )
  )
}

/**
 * The live panel only adds what the message cannot hold yet: a pending approval. Everything else
 * is already rendered from the message, and showing both is what produced two "Executed commands"
 * sections for one turn.
 */
export function selectLiveActivityCards(
  cards: AgentRuntimeActivityCard[],
  messageHasRuntimeParts: boolean
): AgentRuntimeActivityCard[] {
  if (!messageHasRuntimeParts) return cards
  return cards.filter((card) => card.kind === 'approval' && card.status === 'pending')
}
