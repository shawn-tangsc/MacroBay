import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { AgentRuntimeMentionedModelInput } from '@platform/ai/agent-platform/runtime/agentMentionedModels'
import type { AgentChatContextReference } from '@platform/ai/agent-platform/runtime/agentChatRuntime'

/** A host-composed turn: raw prompt text plus the readable transcript card. */
export type AgentComposedMessage = string | {
  text: string
  displayText?: string
  context?: AgentChatContextReference
}

export type SendAgentSessionMessageInput = {
  platform: Window['platform']
  request: {
    agentId: string
    sessionId: string
    text: string
    displayText?: string
    context?: AgentChatContextReference
    mentionedModels?: AgentRuntimeMentionedModelInput[]
    runId: string
  }
  clearDraft: () => void
  restoreDraft: () => void
  clearFiles: () => void
  restoreFiles: () => void
  resetTextarea: () => void
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  onError: (message: string | null) => void
}

export async function sendAgentSessionMessage(input: SendAgentSessionMessageInput): Promise<void> {
  input.onError(null)
  input.clearDraft()
  input.clearFiles()
  input.resetTextarea()

  try {
    const result = await input.platform.agents.sendMessage(input.request)
    if (result && typeof result === 'object' && 'state' in result) {
      input.onStateChange(() => (result as { state: AgentStoreState }).state)
      return
    }

    await recoverFromMissingSendState(input, 'Agent runtime did not return an updated state.')
  } catch (error) {
    await recoverFromMissingSendState(input, errorMessage(error))
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Unknown error')
}

async function recoverFromMissingSendState(input: SendAgentSessionMessageInput, message: string): Promise<void> {
  const latest = await readLatestState(input.platform)
  if (latest) {
    input.onStateChange(() => latest)
    if (hasSubmittedUserMessage(latest, input.request.sessionId, input.request.text)) {
      input.onError(null)
      return
    }
  }

  input.restoreDraft()
  input.restoreFiles()
  input.onError(message)
}

async function readLatestState(platform: Window['platform']): Promise<AgentStoreState | null> {
  try {
    return (await platform.agents.getState()) as AgentStoreState
  } catch {
    return null
  }
}

function hasSubmittedUserMessage(state: AgentStoreState, sessionId: string, text: string): boolean {
  const messages = state.messagesBySessionId?.[sessionId] ?? []
  const submittedText = text.trim()
  return messages.some((message) => {
    if (message.role !== 'user') return false
    const textParts = (message.data?.parts ?? [])
      .flatMap((part) => (part.type === 'text' && typeof (part as { text?: unknown }).text === 'string' ? [(part as { text: string }).text] : []))
      .join('\n')
      .trim()
    return textParts === submittedText || message.searchableText.trim() === submittedText
  })
}
