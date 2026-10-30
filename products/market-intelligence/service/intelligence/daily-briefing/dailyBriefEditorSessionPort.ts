import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { AgentSessionEntity, AgentSessionMessageEntity, CreateAgentSessionDto, CreateAgentSessionMessagesDto, UpdateAgentSessionDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { DailyBriefSessionLinkStore, DailyBriefSessionState } from './dailyBriefSessionLinks'

export type DailyBriefEditorSessionPort = Readonly<{
  ensure: (input: Readonly<{ editionKey: string; editionDate: string; locale: 'zh-CN' | 'en-US'; title: string; agentId: string; allowedTools?: readonly string[] }>) => Promise<{ sessionId: string; created: boolean; attempt: number }>
  send: (sessionId: string, request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  state: (sessionId: string, state: DailyBriefSessionState) => Promise<void>
}>

export function createDailyBriefEditorSessionPort(deps: Readonly<{
  links: DailyBriefSessionLinkStore
  createSession: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
  send: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  now?: () => string
}>): DailyBriefEditorSessionPort {
  const now = deps.now ?? (() => new Date().toISOString())
  return Object.freeze({
    async ensure(input) {
      const attempt = (await deps.links.listByEdition(input.editionKey)).length + 1
      const title = `${input.title} · ${attempt}`
      const session = await deps.createSession({ agentId: input.agentId, name: title, workspace: { type: 'system' }, ...(input.allowedTools && input.allowedTools.length > 0 ? { allowedTools: [...input.allowedTools] } : {}) })
      const at = now()
      await deps.links.put({ editionKey: input.editionKey, sessionId: session.id, editionDate: input.editionDate, locale: input.locale, state: 'running', createdAt: at, updatedAt: at })
      return { sessionId: session.id, created: true, attempt }
    },
    send: (sessionId, request) => deps.send({ ...request, sessionId }),
    async state(sessionId, state) {
      const link = await deps.links.findBySession(sessionId)
      if (!link) return
      await deps.links.put({ ...link, state, updatedAt: now() })
    },
  })
}
