import type { CreateAgentSessionDto } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { analysisWorkspacePolicy, type AnalysisFollowUpInput } from '../../../contracts/analysisWorkspaceContracts'

type SessionRef = { id: string; agentId: string | null; description?: string }
export type AnalysisSessionDependencies = Readonly<{
  getAgentState?: () => Promise<{ sessions: readonly SessionRef[] }>
  createAgentSession?: (input: CreateAgentSessionDto) => Promise<SessionRef>
}>

export function createAnalysisFollowUpSession(deps: AnalysisSessionDependencies) {
  // 只保存正在创建的请求；完成后释放，持久化会话仍由平台管理。
  const pending = new Map<string, Promise<string>>()
  return async (input: AnalysisFollowUpInput): Promise<string> => {
    if (input.agentId !== analysisWorkspacePolicy.agentId || !deps.getAgentState || !deps.createAgentSession) {
      throw new Error(analysisWorkspacePolicy.errors.unavailable)
    }
    const description = `${analysisWorkspacePolicy.sessionBindingPrefix}${input.eventGroupId}`
    const resolve = async () => {
      const { sessions } = await deps.getAgentState!()
      const existing = sessions.find(session => session.agentId === input.agentId && session.description === description)
      if (input.existingSessionId && existing?.id !== input.existingSessionId) throw new Error(analysisWorkspacePolicy.errors.unavailable)
      if (existing) return existing.id
      const session = await deps.createAgentSession!({ agentId: input.agentId, name: input.eventGroupId, description, workspace: { type: 'system' } })
      return session.id
    }
    const active = pending.get(description)
    if (active) {
      const id = await active
      if (input.existingSessionId && input.existingSessionId !== id) throw new Error(analysisWorkspacePolicy.errors.unavailable)
      return id
    }
    const result = resolve()
    pending.set(description, result)
    try { return await result } finally { pending.delete(description) }
  }
}
