import type { AgentSessionRuntimeTurnPhase } from '@platform/ai/agent-platform/runtime/runtimeTypes'

import type { AgentText } from './agentTextTypes'
import type { AgentRuntimeActivityCard } from './agentRuntimeActivityViewModel'

/** After this long without a first chunk, "connecting" becomes an explicit wait. */
export const AGENT_STILL_WAITING_THRESHOLD_MS = 90_000

export type AgentRuntimePhaseTextInput = {
  phase: AgentSessionRuntimeTurnPhase | null | undefined
  cards: readonly AgentRuntimeActivityCard[]
  /** Wall-clock time since the pending assistant message was created. */
  elapsedMs?: number
  text: AgentText['runtimeText']
}

/**
 * Shared across every host of `AgentChatSurface`. The persisted pending message starts as
 * "connecting" and only gains text on the first answer delta, so without this the transcript
 * keeps claiming it is connecting while the model is thinking, calling tools, or waiting.
 */
export function resolveAgentRuntimePhaseText(input: AgentRuntimePhaseTextInput): string | null {
  const { phase, cards, elapsedMs, text } = input
  if (!phase || phase === 'idle' || phase === 'queued' || phase === 'resolving-context') {
    return null
  }
  if (phase === 'pausing' || phase === 'finishing') return null
  // `opening-stream` still covers SDK startup and provider preflight. Before the threshold the
  // original "connecting" copy is the truthful one; past it the wait is long enough to name.
  if (phase === 'opening-stream') {
    return elapsedMs !== undefined && elapsedMs >= AGENT_STILL_WAITING_THRESHOLD_MS
      ? text.stillWaiting
      : null
  }

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
