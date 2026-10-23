import { Input } from 'antd'
import { Search } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import type { ChatSettings } from '@platform/settings/schema/appSettings'
import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { AssistantTopicEntity } from '@platform/ai/assistant-platform/schemas/topicSchemas'
import type { AssistantTopicStreamSnapshot } from '@platform/ai/assistant-platform/schemas/streamSchemas'
import type { PlatformText } from '../../i18n/platformText'
import { mergeAssistantStreamOverlay, type AssistantBranchEntry } from './assistantMessageRendering'
import { scrollAssistantMessageListAfterRender, updateAssistantMessageListStickiness } from './assistantMessageScroll'
import { AssistantMessageRow } from './AssistantMessageRow'
import { AssistantInputbar } from './AssistantInputbar'
import { AssistantImagePendingRow } from './imageGeneration/AssistantImagePendingRow'
import type {
  AssistantImageGenerationView,
  PendingImageEntry
} from './imageGeneration/imageGenerationModel'
import type { AssistantImageMessagePart } from '@platform/ai/assistant-platform/schemas/messageSchemas'
import type { AssistantInputbarToolId } from './inputbar/assistantInputbarRegistry'

type AssistantChatPaneProps = {
  labels: PlatformText['assistants']
  language?: AppLanguage
  topic: AssistantTopicEntity | null
  messages: AssistantBranchEntry[]
  streamSnapshot: AssistantTopicStreamSnapshot | null
  draft: string
  isSending: boolean
  assistantSelected: boolean
  composerEnabled: boolean
  modelReady: boolean
  statusMessage: string | null
  confirmDeleteMessage: boolean
  chatSettings: Pick<ChatSettings, 'fontSize' | 'messageStyle' | 'narrowMode'> | null
  onDraftChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  onToolAction: (toolId: AssistantInputbarToolId) => void
  onOpenSettings: () => void
  onSelectSibling: (messageId: string) => void
  onDeleteMessage: (messageId: string) => void
  onRegenerate: (userMessageId: string) => void
  onEditResend: (messageId: string, text: string) => void
  onSearch: (query: string) => void
  imageGeneration: AssistantImageGenerationView
  pendingImage: PendingImageEntry | null
  sessionImages: readonly AssistantImageMessagePart[]
  mentionedModels: readonly import('./assistantMentionedModels').AssistantMentionedModel[]
  modelOptions: readonly import('./assistantMentionedModels').AssistantMentionedModel[]
  onToggleMentionedModel: (value: string) => void
  onClearMentionedModels: () => void
}

export function AssistantChatPane({
  labels,
  language = 'en-US',
  topic,
  messages,
  streamSnapshot,
  draft,
  isSending,
  assistantSelected,
  composerEnabled,
  modelReady,
  statusMessage,
  confirmDeleteMessage,
  chatSettings,
  onDraftChange,
  onSend,
  onStop,
  onToolAction,
  onOpenSettings,
  onSelectSibling,
  onDeleteMessage,
  onRegenerate,
  onEditResend,
  onSearch,
  imageGeneration,
  pendingImage,
  sessionImages,
  mentionedModels,
  modelOptions,
  onToggleMentionedModel,
  onClearMentionedModels
}: AssistantChatPaneProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('')
  const messageListRef = useRef<HTMLDivElement | null>(null)
  const scrollStickinessRef = useRef({ shouldStickToBottom: true })
  const isStreaming = streamSnapshot?.status === 'streaming' || streamSnapshot?.status === 'pending'
  const renderedMessages = useMemo(
    () => mergeAssistantStreamOverlay(messages, streamSnapshot),
    [messages, streamSnapshot]
  )
  const emptyStateLabel = !assistantSelected
    ? labels.noAssistant
    : topic
      ? labels.emptyChat
      : labels.startConversation

  useEffect(() => {
    setSearchQuery('')
  }, [topic?.id])

  useLayoutEffect(() => {
    scrollStickinessRef.current.shouldStickToBottom = true
  }, [topic?.id])

  useLayoutEffect(() => {
    const messageList = messageListRef.current
    if (!messageList) return
    scrollAssistantMessageListAfterRender(messageList, scrollStickinessRef.current)
  }, [renderedMessages, pendingImage, topic?.id])

  return (
    <section className="agent-chat-pane assistant-chat-pane">
      <div className="agent-chat-header assistant-chat-header">
        <div className="assistant-chat-header-copy">
          <strong>{topic?.name || emptyStateLabel}</strong>
        </div>
        <div className="assistant-chat-header-actions">
          {isStreaming ? <span className="status-line">{labels.streaming}</span> : null}
          {topic ? (
            <Input
              className="assistant-topic-search"
              size="small"
              prefix={<Search size={14} />}
              placeholder={labels.searchTopic}
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                onSearch(event.target.value)
              }}
            />
          ) : null}
        </div>
      </div>

      <div
        ref={messageListRef}
        className={[
          'assistant-message-list',
          chatSettings?.messageStyle === 'bubble' ? 'bubble' : '',
          chatSettings?.narrowMode ? 'narrow' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        style={{ '--chat-message-font-size': `${chatSettings?.fontSize ?? 14}px` } as React.CSSProperties}
        onScroll={(event) => {
          updateAssistantMessageListStickiness(event.currentTarget, scrollStickinessRef.current)
        }}>
        {renderedMessages.length === 0 ? <p className="empty-state assistant-empty-state">{emptyStateLabel}</p> : null}
        {renderedMessages.map((message, index) => {
          const entry = messages[index]
          const siblings = entry?.siblingsGroup ?? (entry ? [entry.message] : [])
          return (
            <AssistantMessageRow
              key={message.id}
              labels={labels}
              language={language}
              message={message}
              siblings={siblings}
              parentUserMessageId={entry?.message.parentId ?? undefined}
              confirmDelete={confirmDeleteMessage}
              isTopicStreaming={isStreaming}
              onSelectSibling={onSelectSibling}
              onDelete={onDeleteMessage}
              onRegenerate={onRegenerate}
              onEditResend={onEditResend}
            />
          )
        })}
        <AssistantImagePendingRow labels={labels} entry={pendingImage} />
      </div>

      <AssistantInputbar
        labels={labels}
        draft={draft}
        isSending={isSending}
        isStreaming={isStreaming}
        modelReady={modelReady}
        assistantSelected={assistantSelected}
        composerEnabled={composerEnabled}
        topicSelected={Boolean(topic)}
        statusMessage={statusMessage}
        onDraftChange={onDraftChange}
        onSend={onSend}
        onStop={onStop}
        onToolAction={onToolAction}
        onOpenSettings={onOpenSettings}
        mentionedModels={mentionedModels}
        imageGeneration={imageGeneration}
        sessionImages={sessionImages}
        modelOptions={modelOptions}
        onToggleMentionedModel={onToggleMentionedModel}
        onClearMentionedModels={onClearMentionedModels}
      />
    </section>
  )
}
