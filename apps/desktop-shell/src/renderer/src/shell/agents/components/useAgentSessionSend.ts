import type { RefObject } from 'react'
import { useState } from 'react'

import type { AgentEntity } from '@platform/ai/agent-platform/schemas/agentSchemas'
import type { AgentSessionEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import type { AgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { sendAgentSessionMessage, type AgentComposedMessage } from '../agentMessageSendFlow'
import { buildAgentMessageText, type AgentAttachedFile } from '../agentMessageInput'
import type { AgentMentionedModel } from '../agentMentionedModels'
import { resizeTextarea } from './agentInputbarHelpers'

type UseAgentSessionSendInput = {
  agent: AgentEntity
  session: AgentSessionEntity
  draft: string
  files: AgentAttachedFile[]
  mentionedModels: AgentMentionedModel[]
  maxTextareaHeight: number
  textareaRef: RefObject<HTMLTextAreaElement | null>
  draftRef: RefObject<string>
  setDraft: (draft: string) => void
  setFiles: (updater: AgentAttachedFile[] | ((current: AgentAttachedFile[]) => AgentAttachedFile[])) => void
  onStateChange: (updater: (state: AgentStoreState) => AgentStoreState) => void
  /**
   * A vertical surface appends its own locked context (an analysis identity, an event reference)
   * to the text the reader typed. It runs at send time, so the domain may still read live facts.
   */
  composeText?: (text: string) => AgentComposedMessage | Promise<AgentComposedMessage>
}

export function useAgentSessionSend(input: UseAgentSessionSendInput): {
  send: () => Promise<void>
  sendError: string | null
} {
  const [sendError, setSendError] = useState<string | null>(null)

  async function send(): Promise<void> {
    const baseText = buildAgentMessageText(input.draft, input.files)
    if (!baseText) return
    const composed = input.composeText ? await input.composeText(baseText) : baseText
    const text = typeof composed === 'string' ? composed : composed.text
    if (!text) return
    const displayText = typeof composed === 'string' ? undefined : composed.displayText
    const context = typeof composed === 'string' ? undefined : composed.context

    const runId = `agent-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const submittedDraft = input.draft
    const submittedFiles = input.files
    await sendAgentSessionMessage({
      platform: window.platform,
      request: {
        agentId: input.agent.id,
        sessionId: input.session.id,
        text,
        ...(displayText ? { displayText } : {}),
        ...(context ? { context } : {}),
        mentionedModels: input.mentionedModels.map((model) => ({
          id: model.value,
          label: model.label,
          providerName: model.providerName
        })),
        runId
      },
      clearDraft: () => input.setDraft(''),
      restoreDraft: () => {
        input.draftRef.current = submittedDraft
        input.setDraft(submittedDraft)
      },
      clearFiles: () => input.setFiles([]),
      restoreFiles: () => input.setFiles(submittedFiles),
      resetTextarea: () => {
        if (input.textareaRef.current) input.textareaRef.current.style.height = 'auto'
      },
      onStateChange: input.onStateChange,
      onError: (message) => {
        setSendError(message)
        if (!message) return
        requestAnimationFrame(() => {
          if (input.textareaRef.current) resizeTextarea(input.textareaRef.current, input.maxTextareaHeight)
          input.textareaRef.current?.focus()
        })
      }
    })
  }

  return { send, sendError }
}
