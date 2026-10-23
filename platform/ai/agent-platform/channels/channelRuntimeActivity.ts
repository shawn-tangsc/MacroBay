import type {
  AgentRuntimeControlChunk,
  AgentRuntimeProductToolCallFinishChunk,
  AgentRuntimeProductToolCallStartChunk,
  AgentRuntimeReasoningDeltaChunk,
  AgentRuntimeReasoningEndChunk,
  AgentRuntimeReasoningStartChunk,
  AgentRuntimeSessionChunk,
  AgentRuntimeToolInputAvailableChunk,
  AgentRuntimeToolInputDeltaChunk,
  AgentRuntimeToolInputStartChunk,
  AgentRuntimeToolOutputAvailableChunk,
  AgentRuntimeToolOutputDeniedChunk,
  AgentRuntimeToolOutputErrorChunk
} from '../runtime/runtimeTypes'
import type { ChannelFlushedBatch } from './ChannelMessageRuntimeService'

export type AgentChannelRuntimeActivityKind = 'reasoning' | 'tool' | 'control' | 'product-tool'

export type AgentChannelRuntimeActivityStatus = 'running' | 'completed' | 'error' | 'denied'

export type AgentChannelRuntimeActivityPhase =
  | 'reasoning-started'
  | 'reasoning-streaming'
  | 'reasoning-completed'
  | 'tool-input-started'
  | 'tool-input-streaming'
  | 'tool-input-available'
  | 'tool-output-available'
  | 'tool-output-error'
  | 'tool-output-denied'
  | 'control'
  | 'product-tool-started'
  | 'product-tool-completed'
  | 'product-tool-failed'
  | 'product-tool-timeout'
  | 'product-tool-denied'
  | 'product-tool-cancelled'

export type AgentChannelRuntimeActivityUpdate = {
  key: string
  kind: AgentChannelRuntimeActivityKind
  phase: AgentChannelRuntimeActivityPhase
  status: AgentChannelRuntimeActivityStatus
  title: string
  detail: string | null
  redacted: boolean
}

type ChannelRuntimeActivityTracker = {
  reasoningTextByKey: Map<string, string>
  toolInputByToolCallId: Map<string, string>
  toolTitleByToolCallId: Map<string, string>
}

const summaryLimit = 500

export function createChannelRuntimeActivityTracker(): ChannelRuntimeActivityTracker {
  return {
    reasoningTextByKey: new Map<string, string>(),
    toolInputByToolCallId: new Map<string, string>(),
    toolTitleByToolCallId: new Map<string, string>()
  }
}

export function isChannelRuntimeActivityChunk(chunk: AgentRuntimeSessionChunk): boolean {
  switch (chunk.type) {
    case 'reasoning-start':
    case 'reasoning-delta':
    case 'reasoning-end':
    case 'tool-input-start':
    case 'tool-input-delta':
    case 'tool-input-available':
    case 'tool-output-available':
    case 'tool-output-error':
    case 'tool-output-denied':
    case 'runtime-control':
    case 'product-tool-call-start':
    case 'product-tool-call-finish':
      return true
    default:
      return false
  }
}

export function mapChannelRuntimeActivityChunk(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeSessionChunk,
  tracker: ChannelRuntimeActivityTracker,
  activeRunId: string
): AgentChannelRuntimeActivityUpdate | null {
  switch (chunk.type) {
    case 'reasoning-start':
      return mapReasoningStart(chunk, tracker, activeRunId)
    case 'reasoning-delta':
      return mapReasoningDelta(batch, chunk, tracker, activeRunId)
    case 'reasoning-end':
      return mapReasoningEnd(batch, chunk, tracker, activeRunId)
    case 'tool-input-start':
      return mapToolInputStart(chunk, tracker)
    case 'tool-input-delta':
      return mapToolInputDelta(batch, chunk, tracker)
    case 'tool-input-available':
      return mapToolInputAvailable(batch, chunk, tracker)
    case 'tool-output-available':
      return mapToolOutputAvailable(batch, chunk, tracker)
    case 'tool-output-error':
      return mapToolOutputError(batch, chunk, tracker)
    case 'tool-output-denied':
      return mapToolOutputDenied(batch, chunk, tracker)
    case 'runtime-control':
      return mapRuntimeControl(batch, chunk, activeRunId)
    case 'product-tool-call-start':
      return mapProductToolStart(batch, chunk)
    case 'product-tool-call-finish':
      return mapProductToolFinish(batch, chunk)
    default:
      return null
  }
}

function mapReasoningStart(
  chunk: AgentRuntimeReasoningStartChunk,
  tracker: ChannelRuntimeActivityTracker,
  activeRunId: string
): AgentChannelRuntimeActivityUpdate | null {
  if (chunk.runId !== activeRunId) return null
  const key = buildReasoningKey(chunk.runId, chunk.partId)
  tracker.reasoningTextByKey.set(key, '')
  return {
    key,
    kind: 'reasoning',
    phase: 'reasoning-started',
    status: 'running',
    title: 'reasoning',
    detail: null,
    redacted: false
  }
}

function mapReasoningDelta(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeReasoningDeltaChunk,
  tracker: ChannelRuntimeActivityTracker,
  activeRunId: string
): AgentChannelRuntimeActivityUpdate | null {
  if (chunk.runId !== activeRunId) return null
  const key = buildReasoningKey(chunk.runId, chunk.partId)
  tracker.reasoningTextByKey.set(key, `${tracker.reasoningTextByKey.get(key) ?? ''}${chunk.delta}`)
  const detail = sanitizeActivityText(batch, tracker.reasoningTextByKey.get(key) ?? '')
  return {
    key,
    kind: 'reasoning',
    phase: 'reasoning-streaming',
    status: 'running',
    title: 'reasoning',
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapReasoningEnd(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeReasoningEndChunk,
  tracker: ChannelRuntimeActivityTracker,
  activeRunId: string
): AgentChannelRuntimeActivityUpdate | null {
  if (chunk.runId !== activeRunId) return null
  const key = buildReasoningKey(chunk.runId, chunk.partId)
  const detail = sanitizeActivityText(batch, tracker.reasoningTextByKey.get(key) ?? '')
  return {
    key,
    kind: 'reasoning',
    phase: 'reasoning-completed',
    status: 'completed',
    title: 'reasoning',
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapToolInputStart(
  chunk: AgentRuntimeToolInputStartChunk,
  tracker: ChannelRuntimeActivityTracker
): AgentChannelRuntimeActivityUpdate {
  tracker.toolTitleByToolCallId.set(chunk.toolCallId, chunk.toolName)
  return {
    key: buildToolKey(chunk.toolCallId),
    kind: 'tool',
    phase: 'tool-input-started',
    status: 'running',
    title: chunk.toolName,
    detail: null,
    redacted: false
  }
}

function mapToolInputDelta(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeToolInputDeltaChunk,
  tracker: ChannelRuntimeActivityTracker
): AgentChannelRuntimeActivityUpdate {
  tracker.toolInputByToolCallId.set(
    chunk.toolCallId,
    `${tracker.toolInputByToolCallId.get(chunk.toolCallId) ?? ''}${chunk.inputTextDelta}`
  )
  const detail = sanitizeActivityText(batch, tracker.toolInputByToolCallId.get(chunk.toolCallId) ?? '')
  return {
    key: buildToolKey(chunk.toolCallId),
    kind: 'tool',
    phase: 'tool-input-streaming',
    status: 'running',
    title: tracker.toolTitleByToolCallId.get(chunk.toolCallId) ?? chunk.toolCallId,
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapToolInputAvailable(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeToolInputAvailableChunk,
  tracker: ChannelRuntimeActivityTracker
): AgentChannelRuntimeActivityUpdate {
  tracker.toolTitleByToolCallId.set(chunk.toolCallId, chunk.toolName)
  const detail = summarizeActivityValue(batch, chunk.input)
  return {
    key: buildToolKey(chunk.toolCallId),
    kind: 'tool',
    phase: 'tool-input-available',
    status: 'running',
    title: chunk.toolName,
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapToolOutputAvailable(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeToolOutputAvailableChunk,
  tracker: ChannelRuntimeActivityTracker
): AgentChannelRuntimeActivityUpdate {
  const detail = summarizeActivityValue(batch, chunk.output)
  return {
    key: buildToolKey(chunk.toolCallId),
    kind: 'tool',
    phase: 'tool-output-available',
    status: 'completed',
    title: tracker.toolTitleByToolCallId.get(chunk.toolCallId) ?? chunk.toolCallId,
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapToolOutputError(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeToolOutputErrorChunk,
  tracker: ChannelRuntimeActivityTracker
): AgentChannelRuntimeActivityUpdate {
  const detail = sanitizeActivityText(batch, chunk.errorText)
  return {
    key: buildToolKey(chunk.toolCallId),
    kind: 'tool',
    phase: 'tool-output-error',
    status: 'error',
    title: tracker.toolTitleByToolCallId.get(chunk.toolCallId) ?? chunk.toolCallId,
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapToolOutputDenied(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeToolOutputDeniedChunk,
  tracker: ChannelRuntimeActivityTracker
): AgentChannelRuntimeActivityUpdate {
  const detail = sanitizeActivityText(batch, chunk.message)
  return {
    key: buildToolKey(chunk.toolCallId),
    kind: 'tool',
    phase: 'tool-output-denied',
    status: 'denied',
    title: tracker.toolTitleByToolCallId.get(chunk.toolCallId) ?? chunk.toolCallId,
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapRuntimeControl(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeControlChunk,
  activeRunId: string
): AgentChannelRuntimeActivityUpdate | null {
  if (chunk.runId !== activeRunId) return null
  const detail = sanitizeActivityText(batch, chunk.message ?? '')
  return {
    key: `control:${chunk.runId}:${chunk.subtype}`,
    kind: 'control',
    phase: 'control',
    status: 'completed',
    title: chunk.subtype,
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapProductToolStart(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeProductToolCallStartChunk
): AgentChannelRuntimeActivityUpdate {
  const detail = sanitizeActivityText(batch, chunk.asOf ?? '')
  return {
    key: buildProductToolKey(chunk.toolCallId),
    kind: 'product-tool',
    phase: 'product-tool-started',
    status: 'running',
    title: chunk.toolName,
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapProductToolFinish(
  batch: ChannelFlushedBatch,
  chunk: AgentRuntimeProductToolCallFinishChunk
): AgentChannelRuntimeActivityUpdate {
  const detail = sanitizeActivityText(
    batch,
    [chunk.outputHash ? `outputHash=${chunk.outputHash}` : null, chunk.errorCode ? `errorCode=${chunk.errorCode}` : null, typeof chunk.durationMs === 'number' ? `durationMs=${chunk.durationMs}` : null]
      .filter((value): value is string => Boolean(value))
      .join(' ')
  )

  return {
    key: buildProductToolKey(chunk.toolCallId),
    kind: 'product-tool',
    phase: mapProductToolPhase(chunk.status),
    status: mapProductToolStatus(chunk.status),
    title: chunk.toolName,
    detail: detail.text,
    redacted: detail.redacted
  }
}

function mapProductToolPhase(status: AgentRuntimeProductToolCallFinishChunk['status']): AgentChannelRuntimeActivityPhase {
  switch (status) {
    case 'completed':
      return 'product-tool-completed'
    case 'timeout':
      return 'product-tool-timeout'
    case 'denied':
      return 'product-tool-denied'
    case 'cancelled':
      return 'product-tool-cancelled'
    default:
      return 'product-tool-failed'
  }
}

function mapProductToolStatus(status: AgentRuntimeProductToolCallFinishChunk['status']): AgentChannelRuntimeActivityStatus {
  if (status === 'completed') return 'completed'
  if (status === 'denied') return 'denied'
  return 'error'
}

function summarizeActivityValue(
  batch: ChannelFlushedBatch,
  value: unknown
): { text: string | null; redacted: boolean } {
  if (value === null || value === undefined) {
    return { text: null, redacted: false }
  }
  if (typeof value === 'string') {
    return sanitizeActivityText(batch, value)
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return sanitizeActivityText(batch, String(value))
  }

  try {
    return sanitizeActivityText(batch, JSON.stringify(value))
  } catch {
    return sanitizeActivityText(batch, String(value))
  }
}

function sanitizeActivityText(
  batch: ChannelFlushedBatch,
  value: string
): { text: string | null; redacted: boolean } {
  const sanitized = batch.sanitizeOutput(value)
  const normalized = sanitized.text.trim()
  if (!normalized) {
    return {
      text: null,
      redacted: sanitized.redacted
    }
  }
  return {
    text: truncateActivityText(normalized),
    redacted: sanitized.redacted
  }
}

function truncateActivityText(value: string): string {
  if (value.length <= summaryLimit) return value
  return `${value.slice(0, summaryLimit)}...`
}

function buildReasoningKey(runId: string, partId: string): string {
  return `reasoning:${runId}:${partId}`
}

function buildToolKey(toolCallId: string): string {
  return `tool:${toolCallId}`
}

function buildProductToolKey(toolCallId: string): string {
  return `product-tool:${toolCallId}`
}
