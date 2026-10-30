import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { AgentSessionEntity, AgentSessionMessageEntity, CreateAgentSessionDto, CreateAgentSessionMessagesDto, UpdateAgentSessionDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { DailyBriefSessionLinkStore, DailyBriefSessionState } from './dailyBriefSessionLinks'

export type DailyBriefEditorSessionPort = Readonly<{
  ensure: (input: Readonly<{ editionKey: string; editionDate: string; locale: 'zh-CN' | 'en-US'; title: string; agentId: string }>) => Promise<{ sessionId: string; created: boolean }>
  send: (sessionId: string, request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  append: (sessionId: string, input: CreateAgentSessionMessagesDto) => Promise<AgentSessionMessageEntity[]>
  rename: (sessionId: string, title: string) => Promise<void>
  state: (editionKey: string, state: DailyBriefSessionState) => Promise<void>
  delete: (sessionIds: string[]) => Promise<void>
  find: (editionKey: string) => Promise<string | undefined>
}>

export function createDailyBriefEditorSessionPort(deps: Readonly<{
  links: DailyBriefSessionLinkStore
  createSession: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
  send: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  append: (input: CreateAgentSessionMessagesDto) => Promise<AgentSessionMessageEntity[]>
  update: (sessionId: string, patch: UpdateAgentSessionDto) => Promise<AgentSessionEntity>
  delete: (sessionIds: string[]) => Promise<void>
  now?: () => string
}>): DailyBriefEditorSessionPort {
  const now = deps.now ?? (() => new Date().toISOString())
  return Object.freeze({
    async ensure(input) {
      const existing = await deps.links.find(input.editionKey)
      if (existing) return { sessionId: existing.sessionId, created: false }
      const session = await deps.createSession({ agentId: input.agentId, name: input.title, workspace: { type: 'system' } })
      const at = now()
      await deps.links.put({ editionKey: input.editionKey, sessionId: session.id, editionDate: input.editionDate, locale: input.locale, state: 'running', createdAt: at, updatedAt: at })
      return { sessionId: session.id, created: true }
    },
    send: (sessionId, request) => deps.send({ ...request, sessionId }),
    append: (_sessionId, input) => deps.append(input),
    async rename(sessionId, title) { await deps.update(sessionId, { name: title }) },
    async state(editionKey, state) {
      const link = await deps.links.find(editionKey)
      if (!link) return
      await deps.links.put({ ...link, state, updatedAt: now() })
    },
    delete: (sessionIds) => deps.delete(sessionIds),
    async find(editionKey) { return (await deps.links.find(editionKey))?.sessionId }
  })
}
