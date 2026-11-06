import type { CreateAgentSessionDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { analysisWorkspacePolicy } from '../../../contracts/analysisWorkspaceContracts'

type SessionRef = { id: string; agentId: string | null; description?: string }

/**
 * One conversation per analysis run, so a reader can open the record of what was asked and answered.
 *
 * Built on the same injected port the follow-up conversation uses (`getAgentState` /
 * `createAgentSession` / `appendAgentSessionMessages`): one construction of "create a session" in the
 * product, not two. The agent is fixed — never "whatever is selected" — or the sidebar's automatic
 * group would be scattered across agents and never add up.
 *
 * Idempotent by `description`, so a restart or a re-run of the same run finds the existing session
 * instead of growing a second one. Only the run id goes into the conversation; the prompt and the
 * model's answer stay in `mi_analysis_io` and are read by that id, never copied here.
 */
export type AnalysisRunSessionDependencies = Readonly<{
  getAgentState?: () => Promise<{ sessions: readonly SessionRef[] }>
  createAgentSession?: (input: CreateAgentSessionDto) => Promise<SessionRef>
  appendAgentSessionMessages?: (input: Readonly<{ sessionId: string; messages: readonly unknown[] }>) => Promise<unknown>
}>

export const analysisRunSessionPolicy = Object.freeze({
  agentId: analysisWorkspacePolicy.agentId,
  descriptionPrefix: 'market-analysis-run:',
  origin: 'automation' as const,
  originGroup: 'market-analysis' as const
})

export function createAnalysisRunSession(deps: AnalysisRunSessionDependencies) {
  return async function ensureRunSession(input: Readonly<{
    runId: string
    /** The one-line summary the card shows; absent while the run has not produced one. */
    summary?: string
  }>): Promise<string | undefined> {
    if (!deps.getAgentState || !deps.createAgentSession) return undefined
    const description = `${analysisRunSessionPolicy.descriptionPrefix}${input.runId}`
    const { sessions } = await deps.getAgentState()
    const existing = sessions.find(session =>
      session.agentId === analysisRunSessionPolicy.agentId && session.description === description)
    if (existing) return existing.id
    const session = await deps.createAgentSession({
      agentId: analysisRunSessionPolicy.agentId,
      name: input.runId,
      description,
      workspace: { type: 'system' },
      origin: analysisRunSessionPolicy.origin,
      originGroup: analysisRunSessionPolicy.originGroup
    } as CreateAgentSessionDto)
    // Two messages: the context card (which run this is) and the summary. Never the prompt or the
    // model's raw answer — those live once, in the archive, and are read by this run id.
    if (deps.appendAgentSessionMessages) {
      const messages = [
        { role: 'system', content: `market-analysis-run:${input.runId}` },
        ...(input.summary ? [{ role: 'assistant', content: input.summary }] : [])
      ]
      try { await deps.appendAgentSessionMessages({ sessionId: session.id, messages }) } catch { /* 会话是记录的附加物 */ }
    }
    return session.id
  }
}
