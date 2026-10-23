import type { UniqueModelId } from '../schemas/agentSchemas'
import type {
  AgentMentionedModelDescriptor,
  AgentSessionMessageEntity,
  MessageData
} from '../schemas/sessionSchemas'
import {
  createAgentMentionedModelsMessagePart,
  getAgentMessagePromptText,
  getAgentTextParts
} from '../schemas/messageDataHelpers'
import { addAgentSessionMessage, getSessionMessages, replaceAgentSessionMessage, type AgentStoreState } from '../store/agentStore'
import { buildAgentSessionAutoTitle, shouldAutoRenameAgentSession } from './agentSessionAutoTitle'
import type { AgentChatContextReference, AgentChatRuntimeResult } from './agentChatRuntime'
import type { AgentSessionNamingResult } from './naming'
import { createRuntimeTextDataFromDescriptor, runtimeStatusText } from './runtimeText'

type AgentTurnPersistenceIo = {
  getAgentState: () => Promise<AgentStoreState>
  saveAgentState: (state: AgentStoreState, options?: { mergeSessionId?: string }) => Promise<void>
}

export type AgentSessionAiNamingHook = (input: {
  agentId: string
  sessionId: string
  sessionName: string
  userText: string
  assistantText: string
  modelId: string | null
}) => Promise<AgentSessionNamingResult>

export function createRuntimeTextData(text: string): MessageData {
  return { parts: [{ type: 'text', text }] }
}

export function createRuntimeUserMessageData(
  text: string,
  mentionedModels: readonly AgentMentionedModelDescriptor[],
  options: { displayText?: string; context?: AgentChatContextReference } = {}
): MessageData {
  const parts: MessageData['parts'] = []
  if (mentionedModels.length > 0) {
    parts.push(createAgentMentionedModelsMessagePart(mentionedModels))
  }
  if (options.context?.label) {
    parts.push({
      type: 'agent-context',
      kind: options.context.kind,
      label: options.context.label,
      ...(options.context.detail ? { detail: options.context.detail } : {}),
      ...(options.context.payload ? { payload: options.context.payload } : {})
    })
  }
  parts.push({ type: 'text', text: options.displayText ?? text })
  return { parts }
}

export function buildRuntimePromptText(
  text: string,
  mentionedModels: readonly AgentMentionedModelDescriptor[]
): string {
  return getAgentMessagePromptText(createRuntimeUserMessageData(text, mentionedModels))
}

export function addPendingAssistantMessageToState(
  state: AgentStoreState,
  input: {
    sessionId: string
    assistantMessageId: string
    modelId: UniqueModelId | null
    modelName: string | null
  }
): AgentStoreState {
  return addAgentSessionMessage(state, input.sessionId, {
    id: input.assistantMessageId,
    role: 'assistant',
    status: 'pending',
    modelId: input.modelId,
    modelSnapshot: input.modelId ? modelSnapshotFromUniqueId(input.modelId, input.modelName) : null,
    data: createRuntimeTextDataFromDescriptor(runtimeStatusText.connecting)
  })
}

export function addRuntimeErrorTurnToState(
  state: AgentStoreState,
  input: {
    sessionId: string
    text: string
    errorText: string
    assistantMessageId: string
    modelId: UniqueModelId | null
    modelName: string | null
    mentionedModels: readonly AgentMentionedModelDescriptor[]
    displayText?: string
    context?: AgentChatContextReference
  }
): AgentStoreState {
  const withUser = addAgentSessionMessage(state, input.sessionId, {
    role: 'user',
    status: 'success',
    data: createRuntimeUserMessageData(input.text, input.mentionedModels, {
      ...(input.displayText ? { displayText: input.displayText } : {}),
      ...(input.context ? { context: input.context } : {})
    })
  })

  return addAgentSessionMessage(withUser, input.sessionId, {
    id: input.assistantMessageId,
    role: 'assistant',
    status: 'error',
    modelId: input.modelId,
    modelSnapshot: input.modelId ? modelSnapshotFromUniqueId(input.modelId, input.modelName) : null,
    data: createRuntimeTextData(input.errorText)
  })
}

export async function patchRuntimeAssistantMessage(
  io: AgentTurnPersistenceIo,
  sessionId: string,
  assistantMessageId: string,
  patch: Partial<AgentSessionMessageEntity>
): Promise<AgentStoreState> {
  const latestState = await io.getAgentState()
  const nextState = replaceAgentSessionMessage(latestState, sessionId, assistantMessageId, patch)
  await io.saveAgentState(nextState, { mergeSessionId: sessionId })
  return nextState
}

export async function maybeAutoRenameSessionAfterTurn(
  io: AgentTurnPersistenceIo,
  state: AgentStoreState,
  sessionId: string,
  userText: string,
  options?: {
    assistantText?: string
    modelId?: string | null
    aiNaming?: AgentSessionAiNamingHook
  }
): Promise<AgentStoreState> {
  const session = state.sessions.find((item) => item.id === sessionId)
  if (!session || !shouldAutoRenameAgentSession(session.name)) return state

  const fallbackTitle = buildAgentSessionAutoTitle(userText)
  const assistantText = options?.assistantText?.trim() ?? ''
  if (options?.aiNaming && assistantText) {
    try {
      const namingResult = await options.aiNaming({
        agentId: session.agentId ?? '',
        sessionId,
        sessionName: session.name,
        userText,
        assistantText,
        modelId: options.modelId ?? null
      })
      if (namingResult.renamed && namingResult.title) {
        const latest = await io.getAgentState()
        return latest
      }
    } catch {
      // Best-effort AI naming must never block the chat turn.
    }
  }

  if (!fallbackTitle || fallbackTitle === session.name) {
    const latest = await io.getAgentState()
    return latest
  }

  const latest = await io.getAgentState()
  const latestSession = latest.sessions.find((item) => item.id === sessionId)
  if (!latestSession || !shouldAutoRenameAgentSession(latestSession.name)) return latest
  if (latestSession.name === fallbackTitle) return latest

  const now = new Date().toISOString()
  const nextState: AgentStoreState = {
    ...latest,
    sessions: latest.sessions.map((item) =>
      item.id === sessionId
        ? {
            ...item,
            name: fallbackTitle,
            updatedAt: now
          }
        : item
    )
  }
  await io.saveAgentState(nextState)
  return nextState
}

export function extractAssistantTextForNaming(message: AgentSessionMessageEntity | null | undefined): string {
  if (!message) return ''
  return getAgentTextParts(message.data).join('\n\n').trim()
}

export function buildRuntimeTurnResult(
  state: AgentStoreState,
  sessionId: string,
  assistantMessageId: string
): AgentChatRuntimeResult {
  const messages = getSessionMessages(state, sessionId)
  const assistantMessage = messages.find((message) => message.id === assistantMessageId)
  const userMessage = [...messages].reverse().find((message) => message.role === 'user')
  if (!assistantMessage || !userMessage) throw new Error('Agent runtime failed to persist the chat turn.')
  return { state, userMessage, assistantMessage }
}

function modelSnapshotFromUniqueId(
  modelId: UniqueModelId,
  modelName: string | null
): AgentSessionMessageEntity['modelSnapshot'] {
  const separatorIndex = modelId.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === modelId.length - 1) {
    return {
      id: modelId,
      name: modelName ?? modelId,
      provider: 'unknown'
    }
  }

  return {
    id: modelId.slice(separatorIndex + 1),
    name: modelName ?? modelId.slice(separatorIndex + 1),
    provider: modelId.slice(0, separatorIndex)
  }
}
