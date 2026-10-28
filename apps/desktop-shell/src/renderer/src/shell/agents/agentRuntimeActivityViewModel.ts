import type { AgentRuntimeSessionChunk, AgentSessionRuntimeSnapshot, AgentSessionToolApproval } from '@platform/ai/agent-platform/runtime/runtimeTypes'

import type { AgentText } from './agentText'
import { serializeApprovalInput } from './agentRuntimeApprovalInput'
import {
  compactJoin,
  resolveRuntimeControlTitle,
  stringifyToolRequest,
  summarizeRuntimeValue
} from './agentRuntimeActivityFormat'
import { resolveToolDisplayName, summarizeToolCallInput } from './agentToolCallSummary'

export type AgentRuntimeActivityStatus = 'pending' | 'running' | 'done' | 'error' | 'denied'

export type AgentRuntimeActivityCard = {
  key: string
  kind: 'approval' | 'tool' | 'reasoning' | 'assistant-text' | 'control'
  title: string
  status: AgentRuntimeActivityStatus
  subtitle: string
  detail: string | null
  approvalId: string | null
  toolCallId: string | null
  approvalInputText?: string | null
  /** The product write being approved, rendered as field labels and values. */
  approvalFields?: ReadonlyArray<Readonly<{ label: string; value: string }>>
  /** Says these are request parameters, not the values that will take effect. */
  approvalNotice?: string
  /** Full request payload behind the row summary, shown in its own fold. */
  requestDetail?: string | null
}

type BuildAgentRuntimeActivityCardsInput = {
  sessionId: string
  chunksBySessionId: AgentSessionRuntimeSnapshot['chunksBySessionId']
  toolApprovals: AgentSessionToolApproval[]
  toolApprovalHistory?: AgentSessionRuntimeSnapshot['toolApprovalHistory']
  text: AgentText['runtimeActivity']
}

type ToolCardDraft = AgentRuntimeActivityCard & { inputText: string; toolSummary: string | null }

/** The product write tools whose request parameters the approval card can label. */
const LABELLED_APPROVAL_CAPABILITIES = new Set([
  'configure_intelligence_source',
  'operate_intelligence_source',
  'operate_macro_calendar',
  'configure_translation',
  'configure_cross_asset_interface'
])
const APPROVAL_VALUE_LIMIT = 160

export function buildAgentRuntimeActivityCards(input: BuildAgentRuntimeActivityCardsInput): AgentRuntimeActivityCard[] {
  const chunks = input.chunksBySessionId[input.sessionId] ?? []
  const cards = new Map<string, AgentRuntimeActivityCard | ToolCardDraft>()
  const approvalInputByToolCallId = new Map<string, { text: string; input: unknown }>()

  for (const chunk of chunks) {
    if (chunk.sessionId !== input.sessionId) continue
    if (chunk.type === 'tool-input-available') {
      const approvalInput = serializeApprovalInput(chunk.input)
      if (approvalInput) {
        approvalInputByToolCallId.set(chunk.toolCallId, { text: approvalInput, input: chunk.input })
      }
    }
    applyChunk(cards, chunk, input.text)
  }

  for (const approval of input.toolApprovals) {
    if (approval.sessionId !== input.sessionId) continue
    cards.set(
      `approval:${approval.approvalId}`,
      createApprovalCard(
        approval,
        input.text,
        approvalInputByToolCallId.get(approval.toolCallId)?.text ?? null
      )
    )
  }

  for (const approval of input.toolApprovalHistory ?? []) {
    if (approval.sessionId !== input.sessionId || cards.has(`approval:${approval.approvalId}`)) continue
    cards.set(`approval:${approval.approvalId}`, {
      key: `approval:${approval.approvalId}`,
      kind: 'approval',
      title: approval.toolName,
      status: approval.decision === 'allow' ? 'done' : 'denied',
      subtitle: approval.decision === 'allow' ? input.text.approvalAllowed : input.text.approvalDenied,
      detail:
        approval.decision === 'allow'
          ? Object.prototype.hasOwnProperty.call(approval, 'updatedInput')
            ? summarizeRuntimeValue(approval.updatedInput)
            : input.text.resolvedAt(approval.resolvedAt)
          : compactJoin([approval.message, input.text.resolvedAt(approval.resolvedAt)], '\n'),
      approvalId: null,
      toolCallId: approval.toolCallId
    })
  }

  attachApprovalInputs(cards, approvalInputByToolCallId, input.text)
  return [...cards.values()].map(stripDraftFields)
}

function applyChunk(
  cards: Map<string, AgentRuntimeActivityCard | ToolCardDraft>,
  chunk: AgentRuntimeSessionChunk,
  text: AgentText['runtimeActivity']
): void {
  switch (chunk.type) {
    case 'tool-approval-request':
      cards.set(
        `approval:${chunk.approvalId}`,
        createApprovalCard(
          {
            approvalId: chunk.approvalId,
            toolCallId: chunk.toolCallId,
            toolName: chunk.providerMetadata.claudeAgent.toolName
          },
          text,
          null
        )
      )
      return
    case 'tool-approval-resolved':
      cards.set(`approval:${chunk.approvalId}`, {
        key: `approval:${chunk.approvalId}`,
        kind: 'approval',
        title: chunk.toolName,
        status: chunk.decision === 'allow' ? 'done' : 'denied',
        subtitle: chunk.decision === 'allow' ? text.approvalAllowed : text.approvalDenied,
        detail:
          chunk.decision === 'allow'
            ? Object.prototype.hasOwnProperty.call(chunk, 'updatedInput')
              ? summarizeRuntimeValue(chunk.updatedInput)
              : null
            : chunk.message ?? null,
        approvalId: null,
        toolCallId: chunk.toolCallId
      })
      return
    case 'tool-input-start': {
      const draft = getToolDraft(cards, chunk.toolCallId, chunk.toolName, text)
      draft.title = resolveToolDisplayName(chunk.toolName)
      draft.status = 'running'
      draft.subtitle = text.toolInputStarted
      return
    }
    case 'tool-input-delta': {
      const draft = getToolDraft(cards, chunk.toolCallId, chunk.toolCallId, text)
      draft.status = 'running'
      draft.subtitle = text.toolInputStreaming
      draft.inputText += chunk.inputTextDelta
      return
    }
    case 'tool-input-available': {
      const draft = getToolDraft(cards, chunk.toolCallId, chunk.toolName, text)
      draft.title = resolveToolDisplayName(chunk.toolName)
      draft.status = 'running'
      draft.toolSummary = summarizeToolCallInput(chunk.toolName, chunk.input)
      draft.subtitle = draft.toolSummary ?? text.toolInputAvailable
      draft.requestDetail = stringifyToolRequest(chunk.input)
      return
    }
    case 'tool-output-available': {
      const draft = getToolDraft(cards, chunk.toolCallId, chunk.toolCallId, text)
      draft.status = 'done'
      draft.subtitle = text.toolCompleted
      draft.detail = summarizeRuntimeValue(chunk.output)
      return
    }
    case 'tool-output-error': {
      const draft = getToolDraft(cards, chunk.toolCallId, chunk.toolCallId, text)
      draft.status = 'error'
      draft.subtitle = text.toolFailed
      draft.detail = chunk.errorText
      return
    }
    case 'tool-output-denied': {
      const draft = getToolDraft(cards, chunk.toolCallId, chunk.toolCallId, text)
      draft.status = 'denied'
      draft.subtitle = text.toolDenied
      draft.detail = chunk.message
      return
    }
    case 'reasoning-start':
      cards.set(`reasoning:${chunk.runId}:${chunk.partId}`, {
        key: `reasoning:${chunk.runId}:${chunk.partId}`,
        kind: 'reasoning',
        title: text.reasoningTitle,
        status: 'running',
        subtitle: text.reasoningInProgress,
        detail: null,
        approvalId: null,
        toolCallId: null
      })
      return
    case 'reasoning-delta': {
      const key = `reasoning:${chunk.runId}:${chunk.partId}`
      const current = cards.get(key)
      cards.set(key, {
        key,
        kind: 'reasoning',
        title: text.reasoningTitle,
        status: 'running',
        subtitle: text.reasoningInProgress,
        detail: `${current?.detail ?? ''}${chunk.delta}`,
        approvalId: null,
        toolCallId: null
      })
      return
    }
    case 'reasoning-end': {
      const key = `reasoning:${chunk.runId}:${chunk.partId}`
      const current = cards.get(key)
      cards.set(key, {
        key,
        kind: 'reasoning',
        title: text.reasoningTitle,
        status: 'done',
        subtitle: text.reasoningCompleted,
        detail: current?.detail ?? null,
        approvalId: null,
        toolCallId: null
      })
      return
    }
    case 'assistant-text-update':
      cards.set(`assistant-text:${chunk.runId}`, {
        key: `assistant-text:${chunk.runId}`,
        kind: 'assistant-text',
        title: text.liveResponseTitle,
        status: 'running',
        subtitle: text.streamingText,
        detail: summarizeRuntimeValue(chunk.text),
        approvalId: null,
        toolCallId: null
      })
      return
    case 'runtime-control':
      // A control event without a message is an internal marker (task_started and friends): a row
      // that says nothing but the SDK slug is noise, so it never reaches the trace.
      if (!chunk.message || isQuietRuntimeControlSubtype(chunk.subtype)) return
      cards.set(`control:${chunk.runId}:${chunk.subtype}`, {
        key: `control:${chunk.runId}:${chunk.subtype}`,
        kind: 'control',
        title: resolveRuntimeControlTitle(chunk.subtype, text),
        status: 'done',
        subtitle: text.runtimeControlEvent,
        detail: chunk.message,
        approvalId: null,
        toolCallId: null
      })
      return
    case 'product-tool-call-start': {
      cards.set(`product-tool:${chunk.toolCallId}`, {
        key: `product-tool:${chunk.toolCallId}`,
        kind: 'tool',
        title: resolveToolDisplayName(chunk.toolName),
        status: 'running',
        subtitle: chunk.asOf ? text.asOf(chunk.asOf) : text.productToolRunning,
        detail: null,
        approvalId: null,
        toolCallId: chunk.toolCallId
      })
      return
    }
    case 'product-tool-call-finish': {
      const current = cards.get(`product-tool:${chunk.toolCallId}`)
      const failed = chunk.status !== 'completed' && chunk.status !== 'denied'
      cards.set(`product-tool:${chunk.toolCallId}`, {
        key: `product-tool:${chunk.toolCallId}`,
        kind: 'tool',
        title: current?.title ?? resolveToolDisplayName(chunk.toolName),
        status: chunk.status === 'completed' ? 'done' : chunk.status === 'denied' ? 'denied' : 'error',
        subtitle: current?.subtitle ?? (failed ? text.productToolFailed : text.productToolCompleted),
        detail:
          chunk.errorCode ??
          (chunk.durationMs != null ? text.duration(chunk.durationMs) : current?.detail ?? null),
        approvalId: null,
        toolCallId: chunk.toolCallId
      })
      return
    }
    default:
      return
  }
}

function isQuietRuntimeControlSubtype(subtype: string): boolean {
  return subtype === 'thinking_tokens' || subtype === 'compact_boundary'
}

function createApprovalCard(
  approval: Pick<AgentSessionToolApproval, 'approvalId' | 'toolCallId' | 'toolName'>,
  text: AgentText['runtimeActivity'],
  approvalInputText: string | null
): AgentRuntimeActivityCard {
  return {
    key: `approval:${approval.approvalId}`,
    kind: 'approval',
    title: approval.toolName,
    status: 'pending',
    subtitle: text.waitingForToolApproval,
    detail: text.toolCall(approval.toolCallId),
    approvalId: approval.approvalId,
    toolCallId: approval.toolCallId,
    ...(approvalInputText ? { approvalInputText } : {})
  }
}

function getToolDraft(
  cards: Map<string, AgentRuntimeActivityCard | ToolCardDraft>,
  toolCallId: string,
  fallbackTitle: string,
  text: AgentText['runtimeActivity']
): ToolCardDraft {
  const key = `tool:${toolCallId}`
  const current = cards.get(key)
  if (current?.kind === 'tool') {
    const draft: ToolCardDraft = {
      ...current,
      inputText: 'inputText' in current ? current.inputText : '',
      toolSummary: 'toolSummary' in current ? current.toolSummary : null
    }
    cards.set(key, draft)
    return draft
  }

  const draft: ToolCardDraft = {
    key,
    kind: 'tool',
    title: fallbackTitle,
    status: 'running',
    subtitle: text.toolRunning,
    detail: null,
    approvalId: null,
    toolCallId,
    inputText: '',
    toolSummary: null
  }
  cards.set(key, draft)
  return draft
}

function stripDraftFields(card: AgentRuntimeActivityCard | ToolCardDraft): AgentRuntimeActivityCard {
  const toolSummary = 'toolSummary' in card ? card.toolSummary : null
  return {
    key: card.key,
    kind: card.kind,
    title: card.title,
    status: card.status,
    subtitle: toolSummary ?? card.subtitle,
    detail: card.detail ? summarizeRuntimeValue(card.detail) : null,
    approvalId: card.approvalId,
    toolCallId: card.toolCallId,
    ...(card.approvalInputText ? { approvalInputText: card.approvalInputText } : {}),
    ...(card.approvalNotice ? { approvalNotice: card.approvalNotice } : {}),
    ...(card.approvalFields?.length ? { approvalFields: card.approvalFields } : {}),
    ...(card.requestDetail ? { requestDetail: card.requestDetail } : {})
  }
}

function attachApprovalInputs(
  cards: Map<string, AgentRuntimeActivityCard | ToolCardDraft>,
  approvalInputByToolCallId: Map<string, { text: string; input: unknown }>,
  text: AgentText['runtimeActivity']
): void {
  for (const [key, card] of cards.entries()) {
    if (card.kind !== 'approval' || !card.toolCallId) continue
    const approvalInput = approvalInputByToolCallId.get(card.toolCallId)
    if (!approvalInput) continue
    const structured = structuredApprovalInput(card.title, approvalInput.input, text)
    cards.set(key, {
      ...card,
      ...(card.approvalInputText ? {} : { approvalInputText: approvalInput.text }),
      ...(structured
        ? { approvalNotice: text.approvalRequestParamsNotice, approvalFields: structured }
        : {})
    })
  }
}

/**
 * Known product write capability -> its input as field/value rows. The values are what the model
 * asked for, never what the write produced; an unknown field keeps its raw key rather than
 * disappearing, and an unknown capability falls back to the existing summary.
 */
function structuredApprovalInput(
  toolName: string,
  input: unknown,
  text: AgentText['runtimeActivity']
): ReadonlyArray<Readonly<{ label: string; value: string }>> | null {
  if (!LABELLED_APPROVAL_CAPABILITIES.has(resolveToolDisplayName(toolName))) return null
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, value]) => value !== undefined
  )
  if (entries.length === 0) return null
  return entries.map(([field, value]) => ({
    label: text.approvalFieldLabels[field] ?? field,
    value: approvalValue(value)
  }))
}

function approvalValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return truncateApprovalValue(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    return truncateApprovalValue(value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', '))
  }
  try {
    return truncateApprovalValue(JSON.stringify(value))
  } catch {
    return '—'
  }
}

function truncateApprovalValue(value: string): string {
  const oneLine = value.replace(/\s+/g, ' ').trim()
  return oneLine.length > APPROVAL_VALUE_LIMIT
    ? `${oneLine.slice(0, APPROVAL_VALUE_LIMIT).trimEnd()}…`
    : oneLine
}
