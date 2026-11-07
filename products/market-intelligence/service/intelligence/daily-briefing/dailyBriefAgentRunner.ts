import type { AgentChatContextReference } from '@platform/ai/agent-platform/runtime/agentChatRuntime'
import type { AgentRuntimeToolInvocation } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { DailyBriefEditorSessionPort } from './dailyBriefEditorSessionPort'
import { dailyBriefSessionCopy, dailyBriefSessionCopyText, dailyBriefSessionTitle } from './dailyBriefEditorSessionNaming'
import type { DailyBriefSessionState } from './dailyBriefSessionLinks'

export type DailyBriefAgentRunner = Readonly<{
  /**
   * `onSession` reports the session as soon as it exists — before the first turn resolves — so a
   * generation that times out mid-turn still knows which runtime session to abandon.
   */
  start: (input: Readonly<{ date: string; periodId: string; locale: 'zh-CN' | 'en-US'; prompt: string; topic?: string; context?: AgentChatContextReference; displayText?: string; allowedTools?: readonly string[]; signal?: AbortSignal; onSession?: (sessionId: string) => void }>) => Promise<{ sessionId: string; created: boolean; assistantText: string; toolInvocations: readonly AgentRuntimeToolInvocation[]; stopped?: boolean }>
  continue: (sessionId: string, text: string, displayText?: string, signal?: AbortSignal) => Promise<{ assistantText: string; toolInvocations: readonly AgentRuntimeToolInvocation[]; stopped?: boolean }>
  finish: (sessionId: string, state: DailyBriefSessionState) => Promise<void>
}>

export function createDailyBriefAgentRunner(deps: Readonly<{
  port: DailyBriefEditorSessionPort
  agentId: string
}>): DailyBriefAgentRunner {
  return Object.freeze({
    async start(input) {
      const title = dailyBriefSessionTitle({ date: input.date, locale: input.locale, ...(input.topic ? { topic: input.topic } : {}) })
      const session = await deps.port.ensure({ editionDate: input.date, periodId: input.periodId, locale: input.locale, title, agentId: deps.agentId, ...(input.allowedTools ? { allowedTools: input.allowedTools } : {}) })
      input.onSession?.(session.sessionId)
      cancelOnAbort(deps.port, input.signal, session.sessionId)
      const result = await deps.port.send(session.sessionId, { agentId: deps.agentId, sessionId: session.sessionId, text: input.prompt, displayText: input.displayText ?? dailyBriefSessionCopyText(dailyBriefSessionCopy(input.locale).startTask, { date: input.date }) })
      return { ...session, assistantText: result.assistantMessage.searchableText, toolInvocations: result.toolInvocations ?? [], ...stoppedOf(result) }
    },
    async continue(sessionId, text, displayText, signal) {
      cancelOnAbort(deps.port, signal, sessionId)
      const result = await deps.port.send(sessionId, { agentId: deps.agentId, sessionId, text, ...(displayText ? { displayText } : {}) })
      return { assistantText: result.assistantMessage.searchableText, toolInvocations: result.toolInvocations ?? [], ...stoppedOf(result) }
    },
    finish: (sessionId, state) => deps.port.state(sessionId, state)
  })
}

/** 一次被停下的回合不是「写完了但写得不好」：调用方必须能区分，否则会把停当成坏输出。 */
function stoppedOf(result: Readonly<{ assistantMessage: Readonly<{ status: string }> }>): Readonly<{ stopped?: boolean }> {
  return result.assistantMessage.status === 'success' ? {} : { stopped: true }
}

/**
 * Stops this session once the generation's deadline aborts. The runtime already turns that into a
 * `paused` turn result, so the caller still receives an answer instead of an error; the turn loop
 * is what refuses to open the next round.
 */
function cancelOnAbort(port: DailyBriefEditorSessionPort, signal: AbortSignal | undefined, sessionId: string): void {
  if (!signal) return
  // A runtime that already stopped answers this with an error or a false result; that is not a
  // generation failure, and the voided promise must not become an unhandled rejection.
  const cancel = () => { void port.cancel(sessionId).catch(() => undefined) }
  if (signal.aborted) { cancel(); return }
  signal.addEventListener('abort', cancel, { once: true })
}
