import type { DailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'
import { dailyBriefSessionTitle } from './dailyBriefEditorSessionNaming'
import type { DailyBriefSessionState } from './dailyBriefSessionLinks'

export type DailyBriefAgentRunner = Readonly<{
  start: (input: Readonly<{ editionKey: string; date: string; locale: 'zh-CN' | 'en-US'; prompt: string; topic?: string }>) => Promise<{ sessionId: string; created: boolean; assistantText: string }>
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
      const session = await deps.port.ensure({ editionKey: input.editionKey, editionDate: input.date, locale: input.locale, title, agentId: deps.agentId })
      const result = await deps.port.send(session.sessionId, { agentId: deps.agentId, sessionId: session.sessionId, text: input.prompt, displayText: title })
      return { ...session, assistantText: result.assistantMessage.searchableText }
    },
    async continue(sessionId, text) {
      const result = await deps.port.send(sessionId, { agentId: deps.agentId, sessionId, text })
      return result.assistantMessage.searchableText
    },
    finish: (editionKey, state) => deps.port.state(editionKey, state)
  })
}
