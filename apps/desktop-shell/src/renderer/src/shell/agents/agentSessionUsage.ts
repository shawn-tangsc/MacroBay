import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'

export type AgentSessionTokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  turnCount: number
}

/**
 * Session-level usage is derived from the persisted per-turn stats, so every host shows the same
 * number without re-reading provider responses. Prompt tokens include the full context sent on
 * each turn; that is the billed input, not just the new user text.
 */
export function summarizeAgentSessionTokenUsage(
  messages: readonly AgentSessionMessageEntity[]
): AgentSessionTokenUsage | null {
  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let turnCount = 0

  for (const message of messages) {
    if (message.role !== 'assistant' || !message.stats) continue
    const prompt = safeTokenCount(message.stats.promptTokens)
    const completion = safeTokenCount(message.stats.completionTokens)
    const total = safeTokenCount(message.stats.totalTokens) || prompt + completion
    if (prompt === 0 && completion === 0 && total === 0) continue
    promptTokens += prompt
    completionTokens += completion
    totalTokens += total
    turnCount += 1
  }

  if (turnCount === 0) return null
  return { promptTokens, completionTokens, totalTokens, turnCount }
}

export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0'
  return Math.round(value).toLocaleString('en-US')
}

function safeTokenCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0
}
