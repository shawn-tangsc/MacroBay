import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

export type AgentSearchResult =
  | {
      type: 'agent'
      agentId: string
      title: string
      subtitle: string
      excerpt: string
    }
  | {
      type: 'session'
      sessionId: string
      title: string
      subtitle: string
      excerpt: string
    }

export function buildAgentSearchResults(
  state: AgentStoreState,
  keyword: string,
  copy: { agentLabel: string; unboundAgent: string; noDescription: string }
): AgentSearchResult[] {
  const trimmed = keyword.trim().toLowerCase()
  const agentResults = buildAgentResults(state, trimmed, copy)
  const sessionResults = buildSessionResults(state, trimmed, copy)
  return [...agentResults, ...sessionResults].slice(0, trimmed ? 24 : 12)
}

function buildAgentResults(
  state: AgentStoreState,
  keyword: string,
  copy: { agentLabel: string; noDescription: string }
): AgentSearchResult[] {
  return state.agents
    .filter((agent) => {
      if (!keyword) return true
      return `${agent.name} ${agent.description ?? ''} ${agent.instructions ?? ''}`.toLowerCase().includes(keyword)
    })
    .map((agent) => ({
      type: 'agent' as const,
      agentId: agent.id,
      title: agent.name,
      subtitle: copy.agentLabel,
      excerpt: agent.description || agent.instructions || copy.noDescription
    }))
}

function buildSessionResults(
  state: AgentStoreState,
  keyword: string,
  copy: { unboundAgent: string }
): AgentSearchResult[] {
  return state.sessions
    .map((session) => {
      const agent = state.agents.find((item) => item.id === session.agentId)
      const messages = state.messagesBySessionId[session.id] ?? []
      const matchedMessage = keyword ? messages.find((message) => message.searchableText.toLowerCase().includes(keyword)) : null
      const haystack = `${session.name} ${session.description ?? ''} ${agent?.name ?? ''} ${agent?.description ?? ''}`.toLowerCase()
      if (keyword && !haystack.includes(keyword) && !matchedMessage) return null
      return {
        type: 'session' as const,
        sessionId: session.id,
        title: session.name,
        subtitle: agent?.name ?? copy.unboundAgent,
        excerpt: matchedMessage?.searchableText || session.description || agent?.description || session.workspace.name
      }
    })
    .filter((item): item is Extract<AgentSearchResult, { type: 'session' }> => item !== null)
}
