import type { AgentChatRuntimeRequest, AgentChatRuntimeResult } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { AgentSessionEntity, AgentSessionMessageEntity, CreateAgentSessionDto, CreateAgentSessionMessagesDto, UpdateAgentSessionDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { DailyBriefSessionLinkStore, DailyBriefSessionState } from './dailyBriefSessionLinks'

/**
 * The attempt the session belongs to, resolved before the session opens so the attempt row exists
 * first and the link only points at it. Absent in a build without the attempt store: then no
 * ordinal is recorded, and nothing is invented to fill the gap.
 */
export type DailyBriefAttemptAllocator = (input: Readonly<{ editionDate: string; periodId: string; locale: 'zh-CN' | 'en-US' }>) => Promise<number | undefined> | number | undefined

export type DailyBriefEditorSessionPort = Readonly<{
  ensure: (input: Readonly<{ editionDate: string; periodId: string; locale: 'zh-CN' | 'en-US'; title: string; agentId: string; allowedTools?: readonly string[] }>) => Promise<{ sessionId: string; created: boolean }>
  send: (sessionId: string, request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  /** Stops the runtime session that is still working on a generation that already timed out. */
  cancel: (sessionId: string) => Promise<void>
  state: (sessionId: string, state: DailyBriefSessionState) => Promise<void>
}>

export function createDailyBriefEditorSessionPort(deps: Readonly<{
  links: DailyBriefSessionLinkStore
  createSession: (input: CreateAgentSessionDto) => Promise<AgentSessionEntity>
  send: (request: AgentChatRuntimeRequest) => Promise<AgentChatRuntimeResult>
  /** The platform cancel entry. Absent in builds without a runtime, so cancel is then a no-op. */
  cancelAgentSession?: (sessionId: string) => Promise<void> | void
  /** Owned by the attempt store; the port never derives its own sequence. */
  allocateAttempt?: DailyBriefAttemptAllocator
  now?: () => string
}>): DailyBriefEditorSessionPort {
  const now = deps.now ?? (() => new Date().toISOString())
  return Object.freeze({
    async ensure(input) {
      const attemptNo = deps.allocateAttempt
        ? await deps.allocateAttempt({ editionDate: input.editionDate, periodId: input.periodId, locale: input.locale })
        : undefined
      // The ordinal is in the session name so two attempts of the same edition are told apart in
      // the assistant list; without an allocator there is no ordinal to name.
      const name = attemptNo === undefined ? input.title : `${input.title} · ${attemptNo}`
      const session = await deps.createSession({ agentId: input.agentId, name, workspace: { type: 'system' }, ...(input.allowedTools && input.allowedTools.length > 0 ? { allowedTools: [...input.allowedTools] } : {}) })
      const at = now()
      await deps.links.put({ editionDate: input.editionDate, periodId: input.periodId, locale: input.locale, ...(attemptNo === undefined ? {} : { attemptNo }), sessionId: session.id, state: 'running', createdAt: at, updatedAt: at })
      return { sessionId: session.id, created: true }
    },
    send: (sessionId, request) => deps.send({ ...request, sessionId }),
    async cancel(sessionId) {
      await deps.cancelAgentSession?.(sessionId)
    },
    async state(sessionId, state) {
      const link = await deps.links.findBySession(sessionId)
      if (!link) return
      // Terminal is terminal: a link is created `running`, and whichever outcome lands first wins.
      // The deadline and a turn that finishes on the same tick can both report, and the loser must
      // not rewrite the winner — neither `abandoned` over `accepted` nor `accepted` over
      // `abandoned`.
      if (link.state !== 'running') return
      await deps.links.put({ ...link, state, updatedAt: now() })
    },
  })
}
