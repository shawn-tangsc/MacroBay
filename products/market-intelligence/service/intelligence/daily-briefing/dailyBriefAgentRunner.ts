import type { AgentChatContextReference } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { AgentRuntimeToolInvocation } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { DailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'
import { dailyBriefSessionCopy, dailyBriefSessionCopyText, dailyBriefSessionTitle } from './dailyBriefEditorSessionNaming'
import type { DailyBriefSessionState } from './dailyBriefSessionLinks'

export type DailyBriefAgentRunner = Readonly<{
  start: (input: Readonly<{ editionKey: string; date: string; locale: 'zh-CN' | 'en-US'; prompt: string; topic?: string; context?: AgentChatContextReference; displayText?: string; allowedTools?: readonly string[] }>) => Promise<{ sessionId: string; created: boolean; assistantText: string; toolInvocations: readonly AgentRuntimeToolInvocation[] }>
  continue: (sessionId: string, text: string) => Promise<{ assistantText: string; toolInvocations: readonly AgentRuntimeToolInvocation[] }>
  finish: (sessionId: string, state: DailyBriefSessionState) => Promise<void>
}>

export function createDailyBriefAgentRunner(deps: Readonly<{
  port: DailyBriefEditorSessionPort
  agentId: string
}>): DailyBriefAgentRunner {
  return Object.freeze({
    async start(input) {
      const title = dailyBriefSessionTitle({ date: input.date, locale: input.locale, ...(input.topic ? { topic: input.topic } : {}) })
      const session = await deps.port.ensure({ editionKey: input.editionKey, editionDate: input.date, locale: input.locale, title, agentId: deps.agentId, ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}) })
      const result = await deps.port.send(session.sessionId, { agentId: deps.agentId, sessionId: session.sessionId, text: input.prompt, displayText: input.displayText ?? dailyBriefSessionCopyText(dailyBriefSessionCopy(input.locale).startTask, { date: input.date }) })
      return { ...session, assistantText: result.assistantMessage.searchableText, toolInvocations: result.toolInvocations ?? [] }
    },
    async continue(sessionId, text) {
      const result = await deps.port.send(sessionId, { agentId: deps.agentId, sessionId, text })
      return { assistantText: result.assistantMessage.searchableText, toolInvocations: result.toolInvocations ?? [] }
    },
    finish: (sessionId, state) => deps.port.state(sessionId, state)
  })
}
