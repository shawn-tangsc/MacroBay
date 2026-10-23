import type { AgentSessionMessageEntity } from '@platform/ai/agent-platform/schemas/sessionSchemas'
import { runtimeTextKeys } from '@platform/ai/agent-platform/runtime/runtimeText'

import type { AgentText } from './agentText'
import {
  buildToolResultDetails,
  selectToolResultDetailValue,
  summarizeMessagePartValue
} from './agentRuntimeMessagePartDetails'
import type {
  AgentRuntimeMessagePartBlock,
  AgentRuntimeMessagePartRuntime
} from './agentRuntimeMessagePartTypes'
import {
  buildAgentRuntimeCommandCard,
  isAgentRuntimeCommandResultPart
} from './agentRuntimeCommandViewModel'
import { buildAgentRuntimeResultPreviewCards } from './agentRuntimeResultPreview'
import { resolveAgentMessagePartText } from './resolveAgentRuntimeText'
import { resolveToolDisplayName, summarizeToolCallInput } from './agentToolCallSummary'

export type {
  AgentRuntimeMessagePartBlock,
  AgentRuntimeMessagePartDetail,
  AgentRuntimeMessagePartDetailItem
} from './agentRuntimeMessagePartTypes'

type BuildAgentRuntimeMessagePartBlocksText = Pick<
  AgentText,
  'messages' | 'runtimeActivity' | 'runtimeText' | 'input'
>

type AgentMessagePart = AgentSessionMessageEntity['data']['parts'][number]

export function buildAgentRuntimeMessagePartBlocks(
  parts: AgentMessagePart[],
  text: BuildAgentRuntimeMessagePartBlocksText,
  options: { runtimeTextOverride?: string } = {}
): AgentRuntimeMessagePartBlock[] {
  const hasCommandResult = parts.some((part) => isAgentRuntimeCommandResultPart(part))
  const toolBlockByCallId = new Map<string, AgentRuntimeMessagePartRuntime>()
  const blocks = parts.flatMap((part, index) => {
    if (hasCommandResult && part.type === 'text') return []
    return buildPartBlock(part, index, text, options, toolBlockByCallId)
  })
  return sortAgentRuntimeMessagePartBlocks(blocks)
}

function sortAgentRuntimeMessagePartBlocks(blocks: AgentRuntimeMessagePartBlock[]): AgentRuntimeMessagePartBlock[] {
  return [...blocks].sort((left, right) => blockDisplayPriority(left) - blockDisplayPriority(right))
}

function blockDisplayPriority(block: AgentRuntimeMessagePartBlock): number {
  if (block.kind === 'runtime') return 0
  if (block.kind === 'command') return 1
  return 2
}

function buildPartBlock(
  part: AgentMessagePart,
  index: number,
  text: BuildAgentRuntimeMessagePartBlocksText,
  options: { runtimeTextOverride?: string },
  toolBlockByCallId: Map<string, AgentRuntimeMessagePartRuntime>
): AgentRuntimeMessagePartBlock[] {
  if (part.type === 'runtime-text') {
    const override =
      part.key === runtimeTextKeys.connecting && options.runtimeTextOverride?.trim()
        ? options.runtimeTextOverride
        : null
    const resolved = override ?? resolveAgentMessagePartText(part, text)
    return resolved ? [{ key: `runtime-text:${index}`, kind: 'text', text: resolved }] : []
  }

  if (part.type === 'agent-context' && typeof part.label === 'string') {
    return [{
      key: `agent-context:${index}`,
      kind: 'context',
      part: {
        type: 'agent-context',
        kind: typeof part.kind === 'string' && part.kind ? part.kind : 'context',
        label: part.label,
        ...(typeof part.detail === 'string' ? { detail: part.detail } : {}),
        ...(part.payload && typeof part.payload === 'object' ? { payload: part.payload as Record<string, unknown> } : {})
      }
    }]
  }

  if (isAgentRuntimeCommandResultPart(part)) {
    const card = buildAgentRuntimeCommandCard(part.command, part.result, {
      context: text.input.runtimeCommandContextTitle,
      cost: text.input.runtimeCommandCostTitle,
      todos: text.input.runtimeCommandTodosTitle
    })
    return [
      {
        key: `runtime-command:${part.command}:${index}`,
        kind: 'command',
        command: card.command,
        title: card.title,
        summary: card.summary,
        rows: card.rows
      }
    ]
  }

  if (part.type === 'text' && typeof part.text === 'string') {
    const legacy = parseLegacyAnalysisReference(part.text, text.runtimeActivity.contextReference ?? 'Context')
    if (legacy) {
      return [
        {
          key: `agent-context:legacy:${index}`,
          kind: 'context',
          part: {
            type: 'agent-context',
            kind: 'legacy-analysis-reference',
            label: legacy.label,
            ...(legacy.detail ? { detail: legacy.detail } : {}),
            payload: legacy.payload
          }
        },
        ...(legacy.text ? [{ key: `text:${index}`, kind: 'text' as const, text: legacy.text }] : [])
      ]
    }
    return part.text ? [{ key: `text:${index}`, kind: 'text', text: part.text }] : []
  }

  if (part.type === 'agent-mentioned-models') return []

  if (isClaudeSdkReasoningPart(part)) {
    const detail = part.text.trim()
    if (!detail) return []
    return [
      {
        key: `claude-reasoning:${part.partId ?? index}:${index}`,
        kind: 'runtime',
        runtimeKind: 'reasoning',
        title: text.runtimeActivity.reasoningProcessed,
        subtitle: text.runtimeActivity.reasoningCompleted,
        status: 'done',
        detail
      }
    ]
  }

  if (isClaudeSdkToolCallPart(part)) {
    const toolCallId = typeof part.toolCallId === 'string' && part.toolCallId ? part.toolCallId : String(index)
    const toolName = typeof part.toolName === 'string' && part.toolName ? part.toolName : toolCallId
    const requestDetail = summarizeMessagePartValue(part.input, text.messages.nonTextContent)
    const block: AgentRuntimeMessagePartRuntime = {
      key: `claude-tool:${toolCallId}:${index}`,
      kind: 'runtime',
      runtimeKind: 'tool-call',
      title: resolveToolDisplayName(toolName),
      subtitle:
        summarizeToolCallInput(toolName, part.input) ?? text.runtimeActivity.toolInputAvailable,
      status: 'running',
      detail: null,
      ...(requestDetail ? { requestDetail } : {})
    }
    toolBlockByCallId.set(toolCallId, block)
    return [block]
  }

  if (isClaudeSdkToolResultPart(part)) {
    const toolCallId = typeof part.toolCallId === 'string' && part.toolCallId ? part.toolCallId : String(index)
    const isError = part.isError === true
    const resultCards = buildAgentRuntimeResultPreviewCards({
      isError,
      errorText: part.errorText,
      output: part.output,
      content: part.content,
      structuredContent: part.structuredContent,
      labels: {
        text: text.runtimeActivity.resultPreviewText,
        json: text.runtimeActivity.resultPreviewJson,
        image: text.runtimeActivity.resultPreviewImage,
        resource: text.runtimeActivity.resultPreviewResource,
        table: text.runtimeActivity.resultPreviewTable,
        error: text.runtimeActivity.resultPreviewError
      },
      fallback: text.messages.nonTextContent
    })
    const detail = summarizeMessagePartValue(
      isError ? part.errorText : selectToolResultDetailValue(part),
      text.messages.nonTextContent
    )
    const details = !isError
      ? (buildToolResultDetails(part, {
          structuredContent: text.runtimeActivity.structuredContent,
          content: text.runtimeActivity.content,
          output: text.runtimeActivity.output,
          fallback: text.messages.nonTextContent
        }) ?? [])
      : []

    // One call is one row: the result closes the row it belongs to instead of adding a second
    // "Tool completed" line that says nothing. Only an orphaned result stands on its own.
    const toolBlock = toolBlockByCallId.get(toolCallId)
    if (toolBlock) {
      toolBlock.status = isError ? 'error' : 'done'
      toolBlock.detail = detail
      if (details.length > 0) toolBlock.details = details
      if (resultCards.length > 0) toolBlock.resultCards = resultCards
      return []
    }

    return [
      {
        key: `claude-tool-result:${toolCallId}:${index}`,
        kind: 'runtime',
        runtimeKind: 'tool-result',
        title: toolCallId,
        subtitle: isError ? text.runtimeActivity.toolFailed : text.runtimeActivity.toolCompleted,
        status: isError ? 'error' : 'done',
        detail,
        ...(details.length > 0 ? { details } : {}),
        ...(resultCards.length > 0 ? { resultCards } : {})
      }
    ]
  }

  if (isClaudeSdkRuntimeControlPart(part)) {
    const subtype = typeof part.subtype === 'string' && part.subtype ? part.subtype : String(index)
    const detail = typeof part.message === 'string' && part.message.trim() ? part.message.trim() : null
    // A message-less control part only carries an SDK slug; that is not something to show.
    if (!detail) return []
    const labels = text.runtimeActivity.runtimeControlLabels
    return [
      {
        key: `claude-runtime-control:${subtype}:${index}`,
        kind: 'runtime',
        runtimeKind: 'control',
        title: Object.prototype.hasOwnProperty.call(labels, subtype) ? labels[subtype]! : subtype,
        subtitle: text.runtimeActivity.runtimeControlEvent,
        status: 'done',
        detail
      }
    ]
  }

  return [
    {
      key: `fallback:${index}`,
      kind: 'text',
      text: text.messages.nonTextContent
    }
  ]
}

function isClaudeSdkReasoningPart(part: AgentMessagePart): part is AgentMessagePart & { text: string; partId?: string } {
  return part.type === 'claude-sdk-reasoning' && typeof part.text === 'string'
}

function isClaudeSdkToolCallPart(part: AgentMessagePart): part is AgentMessagePart & {
  toolCallId?: string
  toolName?: string
  input?: unknown
} {
  return part.type === 'claude-sdk-tool-call'
}

function isClaudeSdkToolResultPart(part: AgentMessagePart): part is AgentMessagePart & {
  toolCallId?: string
  output?: unknown
  content?: unknown
  structuredContent?: unknown
  errorText?: unknown
  isError?: unknown
} {
  return part.type === 'claude-sdk-tool-result'
}

function isClaudeSdkRuntimeControlPart(part: AgentMessagePart): part is AgentMessagePart & {
  subtype?: string
  message?: unknown
} {
  return part.type === 'claude-sdk-runtime-control'
}

/**
 * Messages written before the context card existed carry the raw run identity at the end of the
 * user text. Renderer-only cleanup: split it out, never show the ids again, and keep the stored
 * text untouched so the model prompt and search behavior stay as they were.
 */
function parseLegacyAnalysisReference(
  value: string,
  label: string
): { text: string; label: string; detail?: string; payload: Record<string, unknown> } | null {
  const match = value.match(
    /\n\n\[eventGroupId=([^;\]]+); analysisRunId=([^;\]]+); summaryId=([^;\]]+); asOf=([^\]]+)\]$/
  )
  if (!match) return null
  const date = new Date(match[4])
  const pad = (value: number) => String(value).padStart(2, '0')
  const detail = Number.isNaN(date.getTime())
    ? undefined
    : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return {
    text: value.slice(0, match.index).trimEnd(),
    label,
    ...(detail ? { detail } : {}),
    payload: {
      eventGroupId: match[1],
      analysisRunId: match[2],
      summaryId: match[3],
      asOf: match[4]
    }
  }
}
