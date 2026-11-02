import { Button } from 'antd'
import { Copy, RefreshCw, Trash2 } from 'lucide-react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'
import type { ChatSettings } from '@platform/settings/schema/appSettings'
import { AgentChatBubble } from '@platform/ui/agent-chat'
import { useShellTimeZone } from '@platform/ui/shell/ShellTimeZoneContext'
import { IconButton } from '@platform/ui/components/icon-button'
import { useConfirm } from '@platform/ui/components/confirm'
import { Tooltip } from '@platform/ui/components/tooltip'

import { copyAgentMessageText, resendAgentMessage } from '../agentMessageActions'
import { deleteSessionMessage } from '../agentStateActions'
import type { AgentMessageGroup } from '@platform/ui/agent-chat'
import type { AgentSessionRuntimeSnapshot } from '@platform/ai/agent-platform/runtime/runtimeTypes'
import type { AgentContextRendererRegistry } from '../agentContextRenderers'
import type { AgentRuntimeActivityCard } from '../agentRuntimeActivityViewModel'
import { formatAgentElapsed } from '../agentElapsedText'
import { buildAgentMessageFileArtifacts } from '../agentMessageFileArtifacts'
import { buildAgentRuntimeMessagePartBlocks } from '../agentRuntimeMessageParts'
import type { AgentText } from '../agentTextTypes'
import { useAgentLanguage } from '../agentTextProvider'
import { deleteSessionMessageViaApi } from '../agentSessionDataApi'
import { resolveAgentTextKey, resolveAgentTooltipText, type AgentTooltipKey } from '../agentTooltipText'
import AgentMessageFileArtifacts from './AgentMessageFileArtifacts'
import AgentRuntimeMessagePartBlocks from './AgentRuntimeMessagePartBlocks'
import AgentRuntimeActivityPanel from './AgentRuntimeActivityPanel'

type AgentSessionMessageGroupProps = {
  group: AgentMessageGroup
  activeAgent: AgentEntity
  activeSessionId: string
  activeSessionWorkspacePath: string | null
  chatSettings: ChatSettings | null
  text: Pick<AgentText, 'messages' | 'runtimeActivity' | 'runtimeText' | 'input' | 'common'>
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
  text: Pick<AgentText, 'messages' | 'runtimeActivity' | 'runtimeText' | 'input' | 'common'>
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
  const language = useAgentLanguage()
  const confirm = useConfirm()
  // 键取自闭合联合：写错一处编译就红，不靠评审发现。
  const tooltipKeys = {
    copy: 'messages.copy',
    resend: 'messages.resend',
    delete: 'messages.delete'
  } as const satisfies Record<string, AgentTooltipKey>
  const resolveText = (key: AgentTooltipKey): string => resolveAgentTooltipText(text, key)
  const resolveAnyText = (key: string): string => resolveAgentTextKey(text, key)
  const runtimeTextOverride =
    message.status === 'pending' && pendingStatusText ? pendingStatusText : undefined
  const replyElapsedMs = assistantReplyElapsedMs(message)

  const timeZone = useShellTimeZone()
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
          runtimeTextOverride ? { runtimeTextOverride, timeZone } : { timeZone }
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
      {replyElapsedMs !== undefined ? (
        <div className="agent-message-meta agent-message-elapsed">
          {text.runtimeActivity.completedIn(formatAgentElapsed(replyElapsedMs, language))}
        </div>
      ) : null}
      <div className="agent-message-actions">
        <IconButton
          ariaLabelKey="messages.copyAria"
          icon={Copy}
          onSelect={() => void copyAgentMessageText(message.searchableText)}
          resolveText={resolveAnyText}
          size="md"
          tooltipKey={tooltipKeys.copy}
        />
        {groupRole === 'user' ? (
          <IconButton
            ariaLabelKey="messages.resendAria"
            icon={RefreshCw}
            onSelect={() =>
              void resendAgentMessage(activeAgentId, activeSessionId, message.searchableText, onStateChange)
            }
            resolveText={resolveAnyText}
            size="md"
            tooltipKey={tooltipKeys.resend}
          />
        ) : null}
        {/* Stays an antd Button: IconButton has no danger tone, and this is the destructive action. */}
        <Tooltip labelKey={tooltipKeys.delete} resolveText={resolveText}>
          <Button
            type="text"
            size="small"
            danger
            icon={<Trash2 size={13} />}
            aria-label={text.messages.deleteAria}
            onClick={() => {
              const remove = (): void => {
                void deleteSessionMessageViaApi(window.platform, message.sessionId, message.id).catch(() => {
                  onStateChange((current) => deleteSessionMessage(current, message.sessionId, message.id))
                })
              }
              // 设置里关掉确认时直接删；默认仍先问一次，且由 Provider 渲染。
              if (chatSettings?.confirmDeleteMessage === false) {
                remove()
                return
              }
              confirm({
                title: text.messages.delete,
                description: text.messages.confirmDeleteMessage,
                confirmLabel: text.messages.delete,
                cancelLabel: text.common.cancel,
                tone: 'danger',
                onConfirm: remove
              })
            }}
          />
        </Tooltip>
      </div>
    </div>
  )
}

const REPLY_DURATION_MIN_MS = 1_000

/**
 * A finished assistant message carries its turn's wall clock in its own timestamps, so the reply
 * duration survives reopening the app without a schema field. Sub-second or unparseable spans are
 * noise, and a pending message is still running.
 */
function assistantReplyElapsedMs(
  message: Pick<AgentSessionMessageEntity, 'role' | 'status' | 'createdAt' | 'updatedAt'>
): number | undefined {
  if (message.role !== 'assistant') return undefined
  if (message.status !== 'success' && message.status !== 'paused' && message.status !== 'error') {
    return undefined
  }
  const createdAt = Date.parse(message.createdAt)
  const updatedAt = Date.parse(message.updatedAt)
  if (!Number.isFinite(createdAt) || !Number.isFinite(updatedAt)) return undefined
  const elapsedMs = updatedAt - createdAt
  return elapsedMs >= REPLY_DURATION_MIN_MS ? elapsedMs : undefined
}
