import type {
  AgentSessionMessageEntity,
  AgentSessionMessagesListQuery,
  CreateAgentSessionMessageDto,
  CreateAgentSessionMessagesDto,
  MessageData
} from '../schemas/sessionSchemas'
import { getAgentMessagePromptText } from '../schemas/messageDataHelpers'
import { clearAgentSessionMessages, deleteAgentSessionMessage, listAgentSessionMessages } from '../store/agentStore'
import type {
  AgentPlatformQueryAdapters,
  AgentPlatformStateStore,
  SessionMessageContentSearchItem
} from './agentServiceTypes'
import { buildSnippet, includesSearchText, normalizeSearch } from './agentSearch'

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

  async search(query: {
    q: string
    cursor?: string
    limit?: number
    createdAtFrom?: string
    sessionId?: string
  }): Promise<{ items: SessionMessageContentSearchItem[]; nextCursor?: string }> {
    const search = normalizeSearch(query.q)
    if (!search) return { items: [] }
    const repoSearch = this.queries.messages?.search(query)
    if (repoSearch) {
      const state = await this.store.getState()
      return {
        items: repoSearch.items.map((item) => {
          const session = state.sessions.find((entry) => entry.id === item.sessionId)
          const agent = state.agents.find((entry) => entry.id === session?.agentId)
          return {
            messageId: item.messageId,
            sessionId: item.sessionId,
            sessionName: session?.name ?? '',
            agentId: agent?.id,
            agentName: agent?.name,
            role: item.role,
            snippet: item.snippet,
            createdAt: item.createdAt
          }
        }),
        nextCursor: repoSearch.nextCursor
      }
    }

    const limit = Math.max(1, Math.min(query.limit ?? 50, 200))
    const createdAtFromMs = query.createdAtFrom ? Date.parse(query.createdAtFrom) : undefined
    const cursor = decodeSearchCursor(query.cursor)
    const state = await this.store.getState()

    const sorted = Object.values(state.messagesBySessionId)
      .flat()
      .filter((message) => {
        if (query.sessionId && message.sessionId !== query.sessionId) return false
        if (createdAtFromMs !== undefined && Date.parse(message.createdAt) < createdAtFromMs) return false
        if (cursor && !isOlderThanSearchCursor(message, cursor)) return false
        return includesSearchText(message.searchableText, search)
      })
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))

    const items = sorted.slice(0, limit)
    const hasNext = sorted.length > limit
    const tail = items.at(-1)
    return {
      items: items.map((message) => {
        const session = state.sessions.find((item) => item.id === message.sessionId)
        const agent = state.agents.find((item) => item.id === session?.agentId)
        return {
          messageId: message.id,
          sessionId: message.sessionId,
          sessionName: session?.name ?? '',
          agentId: agent?.id,
          agentName: agent?.name,
          role: message.role,
          snippet: buildSnippet(message.searchableText, query.q),
          createdAt: message.createdAt
        }
      }),
      nextCursor: hasNext && tail ? encodeSearchCursor(tail) : undefined
    }
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

function encodeSearchCursor(message: AgentSessionMessageEntity): string {
  return `${Date.parse(message.createdAt)}:${message.id}`
}

function decodeSearchCursor(raw: string | undefined): { createdAt: number; id: string } | null {
  if (!raw) return null
  const separatorIndex = raw.indexOf(':')
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) return null
  const createdAt = Number(raw.slice(0, separatorIndex))
  const id = raw.slice(separatorIndex + 1)
  return Number.isFinite(createdAt) && id ? { createdAt, id } : null
}

function isOlderThanSearchCursor(
  message: AgentSessionMessageEntity,
  cursor: { createdAt: number; id: string }
): boolean {
  const createdAt = Date.parse(message.createdAt)
  return createdAt < cursor.createdAt || (createdAt === cursor.createdAt && message.id < cursor.id)
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
