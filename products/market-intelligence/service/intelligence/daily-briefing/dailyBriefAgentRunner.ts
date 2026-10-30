import type { AgentChatContextReference } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { DailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'
import { dailyBriefSessionTitle } from './dailyBriefEditorSessionNaming'
import type { DailyBriefSessionState } from './dailyBriefSessionLinks'

export type DailyBriefAgentRunner = Readonly<{
  start: (input: Readonly<{ editionKey: string; date: string; locale: 'zh-CN' | 'en-US'; prompt: string; topic?: string; context?: AgentChatContextReference; displayText?: string; allowedTools?: readonly string[] }>) => Promise<{ sessionId: string; created: boolean; assistantText: string }>
  continue: (sessionId: string, text: string) => Promise<string>
  finish: (editionKey: string, state: DailyBriefSessionState) => Promise<void>
}>

export function createDailyBriefAgentRunner(deps: Readonly<{
  port: DailyBriefEditorSessionPort
  agentId: string
}>): DailyBriefAgentRunner {
  return Object.freeze({
    async start(input) {
      const title = dailyBriefSessionTitle({ date: input.date, locale: input.locale, ...(input.topic ? { topic: input.topic } : {}) })
      const session = await deps.port.ensure({ editionKey: input.editionKey, editionDate: input.date, locale: input.locale, title, agentId: deps.agentId, ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}) })
      const result = await deps.port.send(session.sessionId, { agentId: deps.agentId, sessionId: session.sessionId, text: input.prompt, displayText: input.displayText ?? `生成 ${input.date} 每日简报编辑层：从候选中决定展示项，并写导语、why 与焦点情景。` })
      return { ...session, assistantText: result.assistantMessage.searchableText }
    },
    async continue(sessionId, text) {
      const result = await deps.port.send(sessionId, { agentId: deps.agentId, sessionId, text })
      return result.assistantMessage.searchableText
    },
    finish: (editionKey, state) => deps.port.state(editionKey, state)
  })
}
