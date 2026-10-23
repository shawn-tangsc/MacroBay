import { Button, Input, Popconfirm } from 'antd'
import { Copy, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'

import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type { PlatformText } from '../../i18n/platformText'
import { agentText } from '../agents/agentText'
import type { RenderedAssistantMessage } from './assistantMessageRendering'
import { formatAssistantMessageTimestamp } from './assistantMessageTimestamp'
import { AssistantSiblingNavigator } from './AssistantSiblingNavigator'
import {
  extractAssistantSearchableText,
  isAssistantImageGenerationPart,
  isAssistantImageMessagePart
} from '@platform/ai/assistant-platform/schemas/messageSchemas'
import { isAssistantWebSearchMessagePart } from '@platform/ai/web-search/assistant/assistantWebSearchMessageParts'
import ChatMarkdownText from '../chat/ChatMarkdownText'
import { platformText } from '../../i18n/platformText'
import { describeImageGenerationFailure } from './imageGeneration/imageGenerationModel'
import { MessageImageCard } from './messages/MessageImageCard'
import { MessageWebSearchCard } from './messages/MessageWebSearchCard'
import { copyTextToClipboard } from '../clipboard'

type AssistantMessageRowProps = {
  labels: PlatformText['assistants']
  language?: AppLanguage
  message: RenderedAssistantMessage
  siblings: readonly import('@platform/ai/assistant-platform/schemas/messageSchemas').AssistantMessageEntity[]
  parentUserMessageId?: string
  confirmDelete: boolean
  readOnly?: boolean
  isTopicStreaming?: boolean
  onSelectSibling: (messageId: string) => void
  onDelete: (messageId: string) => void
  onRegenerate: (userMessageId: string) => void
  onEditResend: (messageId: string, text: string) => void
}

export function AssistantMessageRow({
  labels,
  language = 'en-US',
  message,
  siblings,
  parentUserMessageId,
  confirmDelete,
  readOnly = false,
  isTopicStreaming = false,
  onSelectSibling,
  onDelete,
  onRegenerate,
  onEditResend
}: AssistantMessageRowProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false)
  const [editDraft, setEditDraft] = useState(message.text)
  const showsModelMeta = Boolean(message.modelName)
  const timestamp = formatAssistantMessageTimestamp(message.createdAt, language)
  const isInterruption = message.parts.some((part) => part.type === 'interruption')
  const imageParts = message.parts.filter(isAssistantImageMessagePart)
  const imageGeneratingPart = message.parts.find(isAssistantImageGenerationPart)
  const imageFailureText = resolveImageFailureText(message.parts, language)
  const providerFailureText = imageFailureText ?? resolveProviderFailureText(message.parts, language)
  const imageGeneratingText = imageGeneratingPart
    ? imageGeneratingPart.operation === 'edit'
      ? labels.imageEditGenerating
      : labels.imageGenerating
    : null
  const messageBody = isInterruption
    ? labels.generationStopped
    : providerFailureText ?? imageGeneratingText ?? (message.text || labels.pendingMessage)
  // 图片消息的正文只显示失败原因或真实文本（编辑时的 prompt），绝不用「等待回复」兜底。
  const showsTextBody = imageParts.length > 0
    ? Boolean(providerFailureText) || Boolean(message.text.trim())
    : Boolean(messageBody.trim())
  const copyText = isInterruption || providerFailureText ? '' : message.text
  const canCopy = !readOnly &&
    message.role !== 'system' &&
    !message.isLiveOverlay &&
    Boolean(copyText.trim()) &&
    (!isTopicStreaming || message.status !== 'pending')
  const canModifyTree = !readOnly && message.role !== 'system' && !isTopicStreaming
  // 图片消息不参与「重新生成 / 编辑重发」：它没有可重放的文本上下文，误点会把图片弄丢。
  const isImageMessage = imageParts.length > 0

  const actions = canCopy || canModifyTree ? (
    <div className="assistant-message-actions">
      {canCopy ? (
        <Button
          type="text"
          size="small"
          icon={<Copy size={13} />}
          aria-label={labels.copyMessage}
          title={labels.copyMessage}
          onClick={() => void copyTextToClipboard(copyText)}
        />
      ) : null}
      {message.role === 'user' && canModifyTree && !isImageMessage ? (
        <Button
          type="text"
          size="small"
          icon={<Pencil size={13} />}
          aria-label={labels.editMessage}
          title={labels.editMessage}
          onClick={() => {
            setEditDraft(message.text)
            setIsEditing(true)
          }}
        />
      ) : null}
      {message.role === 'assistant' && parentUserMessageId && canModifyTree && !isImageMessage ? (
        <Button
          type="text"
          size="small"
          icon={<RefreshCw size={13} />}
          aria-label={labels.regenerate}
          title={labels.regenerate}
          onClick={() => onRegenerate(parentUserMessageId)}
        />
      ) : null}
      {canModifyTree && confirmDelete ? (
        <Popconfirm
          title={labels.deleteMessage}
          onConfirm={() => onDelete(message.id)}>
          <Button
            type="text"
            size="small"
            icon={<Trash2 size={13} />}
            aria-label={labels.deleteMessage}
            title={labels.deleteMessage}
          />
        </Popconfirm>
      ) : canModifyTree ? (
        <Button
          type="text"
          size="small"
          icon={<Trash2 size={13} />}
          aria-label={labels.deleteMessage}
          title={labels.deleteMessage}
          onClick={() => onDelete(message.id)}
        />
      ) : null}
    </div>
  ) : null

  return (
    <div className={`assistant-message-row assistant-message-row-${message.role}`}>
      <article
        className={`agent-chat-bubble assistant-message assistant-message-${message.role} assistant-message-${message.status} ${
          message.isLiveOverlay ? 'assistant-message-live' : ''
        } ${showsModelMeta ? 'assistant-message-with-model-meta' : ''}`}
        data-role={message.role}>
        {showsModelMeta ? (
          <header className="assistant-message-header">
            <small>{message.modelName}</small>
          </header>
        ) : null}
        {actions}

        {message.siblingBuckets.length > 0 ? (
          <AssistantSiblingNavigator
            labels={labels}
            siblings={siblings}
            activeSiblingId={message.activeSiblingId}
            onSelect={onSelectSibling}
          />
        ) : null}

        {isEditing ? (
          <div className="assistant-message-edit">
            <Input.TextArea value={editDraft} autoSize={{ minRows: 2, maxRows: 8 }} onChange={(e) => setEditDraft(e.target.value)} />
            <div className="assistant-message-edit-actions">
              <Button size="small" onClick={() => setIsEditing(false)}>
                {labels.cancel}
              </Button>
              <Button
                size="small"
                type="primary"
                onClick={() => {
                  onEditResend(message.id, editDraft.trim())
                  setIsEditing(false)
                }}>
                {labels.resendEdited}
              </Button>
            </div>
          </div>
        ) : message.siblingBuckets.length > 1 ? (
          <div className="assistant-model-cohort">
            {message.siblingBuckets.map((bucket) => {
              const bucketMessage =
                bucket.messages.find((item) => item.id === message.activeSiblingId) ??
                bucket.messages[bucket.messages.length - 1]
              if (!bucketMessage) return null
              return (
                <div key={bucket.modelId} className="assistant-model-bubble">
                  <header>
                    <small>{bucketMessage.modelSnapshot?.name ?? bucket.modelId}</small>
                  </header>
                  <ChatMarkdownText
                    text={
                      bucketMessage.data.parts.some((part) => part.type === 'interruption')
                        ? labels.generationStopped
                        : (
                            resolveProviderFailureText(bucketMessage.data.parts, language)
                            ?? (extractAssistantSearchableText(bucketMessage.data) || labels.pendingMessage)
                          )
                    }
                    className="assistant-markdown"
                    language={language}
                  />
                </div>
              )
            })}
          </div>
        ) : (
          <>
            {message.parts.filter(isAssistantWebSearchMessagePart).map((part, index) => (
              <MessageWebSearchCard key={`${message.id}:web-search:${index}`} labels={labels} part={part} />
            ))}
            {imageParts.length > 0 ? (
              <MessageImageCard
                labels={labels}
                images={imageParts}
                createdAt={Date.parse(message.createdAt) || Date.now()}
              />
            ) : null}
            {showsTextBody ? (
              <ChatMarkdownText
                text={messageBody}
                className="assistant-markdown"
                language={language}
              />
            ) : null}
          </>
        )}
      </article>
      {timestamp ? <time className="assistant-message-timestamp" dateTime={message.createdAt}>{timestamp}</time> : null}
    </div>
  )
}

/**
 * T2：图片消息的错误只存 `reasonCode`（+ 脱敏英文摘要），渲染层按当前语言翻成人话；
 * 认不出的码回落到上游摘要（已被主进程脱敏）。
 */
function resolveImageFailureText(
  parts: RenderedAssistantMessage['parts'],
  language: AppLanguage
): string | null {
  const failure = parts.find(
    (part) => part.type === 'error' && typeof (part as { reasonCode?: unknown }).reasonCode === 'string'
  ) as { reasonCode: string; message?: string } | undefined
  if (!failure) return null
  const text = describeImageGenerationFailure(failure.reasonCode, {
    image: platformText[language].assistants,
    reason: platformText[language].models
  })
  // 认不出的码：退回主进程已脱敏的上游摘要，比「未知原因」更有用。
  if (text === platformText[language].models.connectionCheckReasonUnknown && failure.message?.trim()) {
    return failure.message.trim()
  }
  return text || null
}

function resolveProviderFailureText(
  parts: RenderedAssistantMessage['parts'],
  language: AppLanguage
): string | null {
  const error = parts.find((part) => part.type === 'error')
  const code = error && 'code' in error && typeof error.code === 'string' ? error.code : null
  if (!code) return null
  return code === 'provider-configuration-required'
    ? agentText[language].runtimeText.providerConfigurationRequired
    : agentText[language].runtimeText.providerRequestFailed
}
