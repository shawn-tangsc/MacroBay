import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import { copyTextToClipboard } from '../clipboard'

export async function resendAgentMessage(
  agentId: string,
  sessionId: string,
  text: string,
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return

  try {
    const result = await window.platform.agents.sendMessage({
      agentId,
      sessionId,
      text: trimmed,
      runId: `agent-rerun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    })
    if (result && typeof result === 'object' && 'state' in result) {
      onStateChange(() => (result as { state: AgentStoreState }).state)
    }
  } catch {
    const latest = await window.platform.agents.getState()
    onStateChange(() => latest as AgentStoreState)
  }
}

export async function copyAgentMessageText(text: string): Promise<void> {
  await copyTextToClipboard(text)
}
