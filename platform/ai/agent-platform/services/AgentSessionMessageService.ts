import type {
  AgentSessionMessageEntity,
  AgentSessionMessagesListQuery,
  CreateAgentSessionMessageDto,
  CreateAgentSessionMessagesDto,
  MessageData
} from '../schemas/sessionSchemas'
import { getAgentMessagePromptText } from '../schemas/messageDataHelpers'
import { clearAgentSessionMessages, deleteAgentSessionMessage, listAgentSessionMessages } from '../store/agentStore'
import type { AgentPlatformQueryAdapters, AgentPlatformStateStore } from './agentServiceTypes'

export class AgentSessionMessageService {
  constructor(
    private readonly store: AgentPlatformStateStore,
    private readonly queries: AgentPlatformQueryAdapters = {}
  ) {}

  async listSessionMessages(sessionId: string, options: AgentSessionMessagesListQuery = {}) {
    const page = this.queries.messages?.listByCursor(sessionId, options)
    if (!page) {
      return listAgentSessionMessages(await this.store.getState(), sessionId, options)
    }

    const state = await this.store.getState()
    const messagesById = new Map((state.messagesBySessionId[sessionId] ?? []).map((message) => [message.id, message]))
    return {
      items: page.items.flatMap((item) => {
        const message = messagesById.get(item.id)
        return message ? [message] : []
      }),
      nextCursor: page.nextCursor
    }
  }

  async saveMessage(params: {
    sessionId: string
    runtimeResumeToken?: string
    message: CreateAgentSessionMessageDto
  }): Promise<AgentSessionMessageEntity> {
    const saved = await this.store.update((state) => upsertMessageInState(state, params))
    const messageId = params.message.id
    const messages = saved.messagesBySessionId[params.sessionId] ?? []
    const message = messageId ? messages.find((item) => item.id === messageId) : messages.at(-1)
    if (!message) throw new Error('save message failed')
    return message
  }

  async saveMessages(params: CreateAgentSessionMessagesDto): Promise<AgentSessionMessageEntity[]> {
    let savedIds: string[] = []
    const state = await this.store.update((current) => {
      let next = current
      for (const message of params.messages) {
        next = upsertMessageInState(next, {
          sessionId: params.sessionId,
          runtimeResumeToken: params.runtimeResumeToken,
          message
        })
        savedIds = [...savedIds, message.id ?? (next.messagesBySessionId[params.sessionId] ?? []).at(-1)?.id ?? '']
      }
      return next
    })

    const ids = new Set(savedIds.filter(Boolean))
    return (state.messagesBySessionId[params.sessionId] ?? []).filter((message) => ids.has(message.id))
  }

  async deleteSessionMessage(sessionId: string, messageId: string): Promise<void> {
    await this.store.update((state) => deleteAgentSessionMessage(state, sessionId, messageId))
  }

  async clearSessionMessages(sessionId: string) {
    return this.store.update((state) => clearAgentSessionMessages(state, sessionId))
  }

  async findPendingAssistantMessageIds(): Promise<string[]> {
    const state = await this.store.getState()
    return Object.values(state.messagesBySessionId)
      .flat()
      .filter((message) => message.role === 'assistant' && message.status === 'pending')
      .map((message) => message.id)
  }

  async markMessagesError(ids: string[]): Promise<void> {
    const idSet = new Set(ids)
    if (idSet.size === 0) return
    const now = new Date().toISOString()
    await this.store.update((state) => ({
      ...state,
      messagesBySessionId: Object.fromEntries(
        Object.entries(state.messagesBySessionId).map(([sessionId, messages]) => [
          sessionId,
          messages.map((message) =>
            idSet.has(message.id)
              ? {
                  ...message,
                  status: 'error' as const,
                  updatedAt: now
                }
              : message
          )
        ])
      )
    }))
  }

  async getLastRuntimeResumeToken(sessionId: string): Promise<string | null> {
    const messages = (await this.store.getState()).messagesBySessionId[sessionId] ?? []
    return [...messages]
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .find((message) => message.runtimeResumeToken)?.runtimeResumeToken ?? null
  }
}

function upsertMessageInState(
  state: Awaited<ReturnType<AgentPlatformStateStore['getState']>>,
  params: { sessionId: string; runtimeResumeToken?: string; message: CreateAgentSessionMessageDto }
) {
  if (!state.sessions.some((session) => session.id === params.sessionId)) return state

  const now = new Date().toISOString()
  const currentMessages = state.messagesBySessionId[params.sessionId] ?? []
  const messageId = params.message.id ?? createId('message')
  const existing = currentMessages.find((message) => message.id === messageId)
  const status = params.message.status ?? 'success'
  const searchableText = messageDataToSearchableText(params.message.data)
  const nextMessage: AgentSessionMessageEntity = existing
    ? {
        ...existing,
        role: params.message.role,
        data: params.message.data,
        searchableText,
        status,
        modelId: params.message.modelId === undefined ? existing.modelId : params.message.modelId,
        modelSnapshot: params.message.modelSnapshot === undefined ? existing.modelSnapshot : params.message.modelSnapshot,
        stats: params.message.stats === undefined ? existing.stats : params.message.stats,
        runtimeResumeToken: params.runtimeResumeToken ?? existing.runtimeResumeToken,
        updatedAt: now
      }
    : {
        id: messageId,
        sessionId: params.sessionId,
        role: params.message.role,
        data: params.message.data,
        searchableText,
        status,
        modelId: params.message.modelId ?? null,
        modelSnapshot: params.message.modelSnapshot ?? null,
        stats: params.message.stats ?? null,
        runtimeResumeToken: params.runtimeResumeToken ?? null,
        createdAt: now,
        updatedAt: now
      }

  return {
    ...state,
    messagesBySessionId: {
      ...state.messagesBySessionId,
      [params.sessionId]: existing
        ? currentMessages.map((message) => (message.id === messageId ? nextMessage : message))
        : [...currentMessages, nextMessage]
    },
    sessions: state.sessions.map((session) => (session.id === params.sessionId ? { ...session, updatedAt: now } : session))
  }
}

function messageDataToSearchableText(data: MessageData): string {
  return getAgentMessagePromptText(data)
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
