import { useMemo } from 'react'

import { AgentTextProvider } from './agentTextProvider'
import type { AgentContextRendererRegistry } from './agentContextRenderers'
import type { AgentComposedMessage } from './agentMessageSendFlow'
import { useAgentChatSurfaceData } from './agentChatSurfaceData'
import AgentSessionMessages from './components/AgentSessionMessages'
import AgentSessionInputbar from './components/AgentSessionInputbar'

export type AgentChatSurfaceProps = {
  agentId: string
  sessionId: string
  className?: string
  /**
   * Appends the mounting surface's locked context (an analysis identity, an event reference) to
   * the text the reader typed. Runs at send time, so a domain may still read live facts.
   */
  composeText?: (text: string) => AgentComposedMessage | Promise<AgentComposedMessage>
  /** Host-owned context card renderers; unknown kinds use the neutral platform card. */
  contextRenderers?: AgentContextRendererRegistry
  /** The host blocks composition while its own selection is still resolving. */
  disabled?: boolean
  /** Host copy for an empty conversation (a vertical surface owns its own wording). */
  emptyState?: React.ReactNode
}

/**
 * One conversation surface, shared by every place that hosts an agent: the agent page today and
 * the vertical-domain panels built on top of it.
 *
 * It deliberately renders the *same* message list and composer the agent page renders, not a
 * reduced copy, so streaming, tool cards, approvals, attachments, quick panels and the model
 * picker cannot drift between the full page and an embedded panel. The only thing a host supplies
 * is which agent/session to show and the text it appends to what the reader typed.
 */
export function AgentChatSurface({ agentId, sessionId, className, composeText, contextRenderers, disabled = false, emptyState }: AgentChatSurfaceProps): React.ReactElement | null {
  const data = useAgentChatSurfaceData()
  const agent = useMemo(() => data.state?.agents.find((candidate) => candidate.id === agentId) ?? null, [agentId, data.state])
  const session = useMemo(() => data.state?.sessions.find((candidate) => candidate.id === sessionId) ?? null, [data.state, sessionId])
  const messages = data.state?.messagesBySessionId[sessionId] ?? []
  const isStreaming =
    data.runtime.sessions[sessionId]?.turnState === 'running' || data.runtime.sessions[sessionId]?.turnState === 'queued'

  if (data.status === 'loading' && !agent) {
    return <div className={joinClassNames('agent-chat-surface', 'is-loading', className)} aria-busy="true" />
  }
  if (!agent || !session) return null

  const chatSettings = data.settings?.chat ?? null

  return (
    <AgentTextProvider language={data.settings?.language ?? 'zh-CN'}>
      <section
        className={joinClassNames('agent-chat-surface', className)}
        aria-label={agent.name}>
        <AgentSessionMessages
          activeAgent={agent}
          activeSession={session}
          messages={[...messages]}
          runtimeSnapshot={data.runtime}
          hasOlder={false}
          onLoadOlder={() => undefined}
          chatSettings={chatSettings}
          onStateChange={data.updateState}
          onRuntimeSnapshotChange={data.applyRuntime}
          {...(contextRenderers ? { contextRenderers } : {})}
          {...(emptyState ? { emptyState } : {})}
        />
        <AgentSessionInputbar
          agent={agent}
          session={session}
          providers={data.providers}
          pinnedModelIds={data.pinnedModelIds}
          defaultAgentModelId={data.settings?.modelDefaults.agentModelId}
          isStreaming={isStreaming}
          chatSettings={chatSettings}
          onStateChange={data.updateState}
          draftStorageKey={`agent-session-draft:${session.id}`}
          disabled={disabled}
          {...(composeText ? { composeText } : {})}
        />
      </section>
    </AgentTextProvider>
  )
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ')
}
