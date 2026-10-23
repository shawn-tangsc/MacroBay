import { Button, Tooltip } from 'antd'
import { Copy, RefreshCw, Trash2 } from 'lucide-react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { ChatSettings } from '@platform/settings/schema/appSettings'
import { AgentChatBubble } from '@platform/ui/agent-chat'

import { copyAgentMessageText, resendAgentMessage } from '../agentMessageActions'
import { deleteSessionMessage } from '../agentStateActions'
import type { AgentMessageGroup } from '@platform/ui/agent-chat'
import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { AgentContextRendererRegistry } from '../agentContextRenderers'
import type { AgentRuntimeActivityCard } from '../agentRuntimeActivityViewModel'
import { buildAgentMessageFileArtifacts } from '../agentMessageFileArtifacts'
import { buildAgentRuntimeMessagePartBlocks } from '../agentRuntimeMessageParts'
import type { AgentText } from '../agentTextTypes'
import { deleteSessionMessageViaApi } from '../agentSessionDataApi'
import AgentMessageFileArtifacts from './AgentMessageFileArtifacts'
import AgentRuntimeMessagePartBlocks from './AgentRuntimeMessagePartBlocks'
import AgentRuntimeActivityPanel from './AgentRuntimeActivityPanel'

type AgentSessionMessageGroupProps = {
  group: AgentMessageGroup
  activeAgent: AgentEntity
  activeSessionId: string
  activeSessionWorkspacePath: string | null
  chatSettings: ChatSettings | null
  text: Pick<AgentText, 'messages' | 'runtimeActivity' | 'runtimeText' | 'input'>
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  onGroupElementRef: (groupId: string, element: HTMLElement | null) => void
  onMessageElementRef: (messageId: string, element: HTMLDivElement | null) => void
  /** Shared phase copy for the in-flight assistant placeholder. */
  pendingStatusText?: string
  /** Host-owned renderers for message contexts (analysis node, calendar event, ...). */
  contextRenderers?: AgentContextRendererRegistry
  /** Live runtime trace for the in-flight (or last) assistant turn. */
  runtimeActivity?: {
    cards: AgentRuntimeActivityCard[]
    onRuntimeSnapshotChange: (snapshot: AgentSessionRuntimeSnapshot) => void
    elapsedMs?: number
    running?: boolean
    failure?: { message: string; code?: string | null } | null
  }
}

export default function AgentSessionMessageGroup({
  group,
  activeAgent,
  activeSessionId,
  activeSessionWorkspacePath,
  chatSettings,
  text,
  onStateChange,
  onGroupElementRef,
  onMessageElementRef,
  pendingStatusText,
  contextRenderers,
  runtimeActivity
}: AgentSessionMessageGroupProps): React.ReactElement {
  const groupStatus = group.messages.at(-1)?.status ?? 'success'

  return (
    <article
      ref={(element) => {
        onGroupElementRef(group.id, element)
      }}
      className={group.role === 'user' ? 'agent-message user' : 'agent-message'}>
      <AgentChatBubble
        role={group.role}
        className="agent-message-bubble"
        statusLabel={groupStatus === 'success' ? null : text.messages.status[groupStatus]}>
        {runtimeActivity ? <AgentRuntimeActivityPanel {...runtimeActivity} /> : null}
        {group.messages.map((message) => (
          <AgentSessionMessageUnit
            key={message.id}
            message={message}
            groupRole={group.role}
            activeAgentId={activeAgent.id}
            activeSessionId={activeSessionId}
            activeSessionWorkspacePath={activeSessionWorkspacePath}
            chatSettings={chatSettings}
            text={text}
            pendingStatusText={pendingStatusText}
            contextRenderers={contextRenderers}
            onStateChange={onStateChange}
            onMessageElementRef={onMessageElementRef}
          />
        ))}
      </AgentChatBubble>
    </article>
  )
}

type AgentSessionMessageUnitProps = {
  message: AgentSessionMessageEntity
  groupRole: AgentMessageGroup['role']
  activeAgentId: string
  activeSessionId: string
  activeSessionWorkspacePath: string | null
  chatSettings: ChatSettings | null
  text: Pick<AgentText, 'messages' | 'runtimeActivity' | 'runtimeText' | 'input'>
  pendingStatusText?: string
  contextRenderers?: AgentContextRendererRegistry
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  onMessageElementRef: (messageId: string, element: HTMLDivElement | null) => void
}

function AgentSessionMessageUnit({
  message,
  groupRole,
  activeAgentId,
  activeSessionId,
  activeSessionWorkspacePath,
  chatSettings,
  text,
  pendingStatusText,
  contextRenderers,
  onStateChange,
  onMessageElementRef
}: AgentSessionMessageUnitProps): React.ReactElement {
  const runtimeTextOverride =
    message.status === 'pending' && pendingStatusText ? pendingStatusText : undefined

  return (
    <div
      ref={(element) => {
        onMessageElementRef(message.id, element)
      }}
      className="agent-message-unit">
      <AgentRuntimeMessagePartBlocks
        blocks={buildAgentRuntimeMessagePartBlocks(
          message.data.parts,
          {
            messages: text.messages,
            runtimeActivity: text.runtimeActivity,
            runtimeText: text.runtimeText,
            input: text.input
          },
          runtimeTextOverride ? { runtimeTextOverride } : {}
        )}
        {...(contextRenderers ? { contextRenderers } : {})}
        text={{
          executionGroupTitle: text.runtimeActivity.executionGroupTitle,
          groupSummary: text.runtimeActivity.groupSummary,
          open: text.runtimeActivity.open,
          reasoningGroupTitle: text.runtimeActivity.reasoningGroupTitle,
          input: text.runtimeActivity.input,
          output: text.runtimeActivity.output
        }}
      />
      {groupRole === 'assistant' ? (
        <AgentMessageFileArtifacts
          summary={buildAgentMessageFileArtifacts(message.data.parts, {
            workspacePath: activeSessionWorkspacePath
          })}
          text={text.runtimeActivity.fileArtifacts}
        />
      ) : null}
      <div className="agent-message-actions">
        <Tooltip title={text.messages.copy}>
          <Button
            type="text"
            size="small"
            icon={<Copy size={13} />}
            aria-label={text.messages.copyAria}
            onClick={() => void copyAgentMessageText(message.searchableText)}
          />
        </Tooltip>
        {groupRole === 'user' ? (
          <Tooltip title={text.messages.resend}>
            <Button
              type="text"
              size="small"
              icon={<RefreshCw size={13} />}
              aria-label={text.messages.resendAria}
              onClick={() =>
                void resendAgentMessage(activeAgentId, activeSessionId, message.searchableText, onStateChange)
              }
            />
          </Tooltip>
        ) : null}
        <Tooltip title={text.messages.delete}>
          <Button
            type="text"
            size="small"
            danger
            icon={<Trash2 size={13} />}
            aria-label={text.messages.deleteAria}
            onClick={() => {
              if (chatSettings?.confirmDeleteMessage !== false && !window.confirm(text.messages.confirmDeleteMessage))
                return
              void deleteSessionMessageViaApi(window.platform, message.sessionId, message.id).catch(() => {
                onStateChange((current) => deleteSessionMessage(current, message.sessionId, message.id))
              })
            }}
          />
        </Tooltip>
      </div>
    </div>
  )
}
