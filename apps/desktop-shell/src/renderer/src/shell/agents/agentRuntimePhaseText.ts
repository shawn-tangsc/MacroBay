import type { AgentSessionRuntimeTurnPhase } from '@platform/ai/agent-platform/runtime/runtimeTypes'

import type { AgentText } from './agentTextTypes'
import type { AgentRuntimeActivityCard } from './agentRuntimeActivityViewModel'

export type AgentRuntimePhaseTextInput = {
  phase: AgentSessionRuntimeTurnPhase | null | undefined
  cards: readonly AgentRuntimeActivityCard[]
  text: AgentText['runtimeText']
}

/**
 * Shared across every host of `AgentChatSurface`. The persisted pending message starts as
 * "connecting" and only gains text on the first answer delta, so without this the transcript
 * keeps claiming it is connecting while the model is thinking, calling tools, or waiting.
 */
export function resolveAgentRuntimePhaseText(input: AgentRuntimePhaseTextInput): string | null {
  const { phase, cards, text } = input
  if (!phase || phase === 'idle' || phase === 'queued' || phase === 'resolving-context') {
    return null
  }
  if (phase === 'pausing' || phase === 'finishing') return null
  // `opening-stream` still covers SDK startup and provider preflight, so the original
  // "connecting" copy is the truthful one until the first runtime chunk arrives.
  if (phase === 'opening-stream') return null

  if (cards.some((card) => card.kind === 'reasoning' && card.status === 'running')) {
    return text.thinking
  }
  if (cards.some((card) => card.kind === 'tool' && (card.status === 'running' || card.status === 'pending'))) {
    return text.usingTools
  }
  if (cards.some((card) => card.kind === 'assistant-text')) {
    return text.generating
  }
  return text.waitingModel
}
