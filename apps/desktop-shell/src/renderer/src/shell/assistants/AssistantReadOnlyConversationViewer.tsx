import { useEffect, useState } from 'react'

import type { PlatformText } from '../../i18n/platformText'
import type { AssistantBranchEntry } from './assistantMessageRendering'
import { mergeAssistantStreamOverlay } from './assistantMessageRendering'
import { AssistantMessageRow } from './AssistantMessageRow'
import { createAssistantTextData } from '@platform/ai/assistant-platform/schemas/messageSchemas'

export type AssistantConversationAnchor = {
  assistantId: string
  topicId: string
  userMessageId: string
  assistantMessageId: string
}

export function AssistantReadOnlyConversationViewer(props: {
  labels: PlatformText['assistants']
  unavailableText: string
  anchor?: AssistantConversationAnchor
  assistantText?: string
}): React.ReactElement {
  const [messages, setMessages] = useState<AssistantBranchEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    setMessages(null)
    if (!isAnchor(props.anchor)) return
    void readAnchoredMessages(props.anchor, props.assistantText).then((next) => {
      if (!cancelled) setMessages(next)
    })
    return () => {
      cancelled = true
    }
  }, [props.anchor?.assistantId, props.anchor?.assistantMessageId, props.anchor?.topicId, props.anchor?.userMessageId, props.assistantText])

  if (!messages) return <p className="assistant-read-only-conversation-viewer" data-conversation-state="unavailable">{props.unavailableText}</p>
  const rendered = mergeAssistantStreamOverlay(messages, null)
  return (
    <section className="assistant-read-only-conversation-viewer" data-conversation-state="ready">
      {rendered.map((message, index) => (
        <AssistantMessageRow
          key={message.id}
          labels={props.labels}
          message={message}
          siblings={[]}
          confirmDelete={false}
          readOnly
          onSelectSibling={() => undefined}
          onDelete={() => undefined}
          onRegenerate={() => undefined}
          onEditResend={() => undefined}
        />
      ))}
    </section>
  )
}

async function readAnchoredMessages(anchor: AssistantConversationAnchor, assistantText?: string): Promise<AssistantBranchEntry[] | null> {
  try {
    const topicResult = await window.platform.assistants.listTopics({ assistantId: anchor.assistantId }) as {
      topics?: Array<{ id: string; assistantId?: string }>
    }
    const topic = topicResult.topics?.find((candidate) => candidate.id === anchor.topicId)
    if (!topic || topic.assistantId !== anchor.assistantId) return null
    const messageResult = await window.platform.assistants.listTopicMessages(anchor.topicId) as { messages?: AssistantBranchEntry[] }
    const messages = messageResult.messages ?? []
    const user = messages.find((entry) => entry.message.id === anchor.userMessageId)?.message
    const assistant = messages.find((entry) => entry.message.id === anchor.assistantMessageId)?.message
    if (!user || !assistant || user.topicId !== anchor.topicId || assistant.topicId !== anchor.topicId) return null
    if (user.role !== 'user' || assistant.role !== 'assistant' || assistant.parentId !== user.id) return null
    return [
      ...(isInternalProgrammaticRequest(user) ? [] : [{ message: user }]),
      { message: safeAssistantMessage(assistant, assistantText) }
    ]
  } catch {
    return null
  }
}

function safeAssistantMessage(
  message: AssistantBranchEntry['message'],
  assistantText: string | undefined
): AssistantBranchEntry['message'] {
  if (!assistantText?.trim()) return message
  return {
    ...message,
    data: createAssistantTextData(assistantText),
    searchableText: assistantText
  }
}

function isInternalProgrammaticRequest(message: AssistantBranchEntry['message']): boolean {
  const text = message.data.parts
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
  return text.includes('\nINPUT:\n') && text.includes('\nOUTPUT_SCHEMA:\n')
}

function isAnchor(value: AssistantConversationAnchor | undefined): value is AssistantConversationAnchor {
  return Boolean(value && [value.assistantId, value.topicId, value.userMessageId, value.assistantMessageId].every((item) => item.trim().length > 0))
}
