import type { AssistantMessagePart } from './messageSchemas'

export const assistantStreamStatuses = [
  'pending',
  'streaming',
  'done',
  'aborted',
  'awaiting-approval',
  'error'
] as const

export type AssistantStreamStatus = (typeof assistantStreamStatuses)[number]

export type AssistantStreamExecution = {
  executionId: string
  anchorMessageId?: string
}

export type AssistantTopicStreamSnapshot = {
  topicId: string
  status: AssistantStreamStatus
  activeExecutions: AssistantStreamExecution[]
  awaitingApprovalAnchors: AssistantStreamExecution[]
  lastCompletedAt?: number
  updatedAt: string
}

export type AssistantStreamOpenRequest = {
  topicId: string
  assistantId?: string
  mentionedModelIds?: string[]
} & (
  | {
      trigger: 'submit-message'
      contextMode?: 'thread' | 'latest-user-only'
      parentAnchorId?: string | null
      userMessageParts: AssistantMessagePart[]
    }
  | {
      trigger: 'regenerate-message'
      parentAnchorId: string
    }
  | {
      trigger: 'resend-user-message'
      userMessageId: string
    }
)

export type AssistantStreamOpenResponse = {
  mode: 'started' | 'injected' | 'blocked'
  executionIds?: string[]
  userMessageId?: string
  placeholderIds?: string[]
  message?: string
}

export type AssistantStreamChunkPayload = {
  topicId: string
  executionId?: string
  chunk: {
    type: string
  } & Record<string, unknown>
}

export type AssistantStreamDonePayload = {
  topicId: string
  executionId?: string
  status: 'success' | 'paused'
  isTopicDone?: boolean
}

export type AssistantStreamErrorPayload = {
  topicId: string
  executionId?: string
  isTopicDone?: boolean
  error: {
    message: string
    code?: string
  }
}

export type AssistantToolApprovalDecision = {
  executionId: string
  behavior: 'allow' | 'deny'
  message?: string
}
