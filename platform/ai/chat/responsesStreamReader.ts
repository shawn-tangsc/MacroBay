import { ChatProtocolFailureError } from './chatProtocolFailure'
import type { ChatProtocolStats, ChatProtocolToolCall } from './chatProtocolTypes'
import { readResponsesFunctionCalls } from './responsesToolLoop'

/**
 * B 包：`POST /v1/responses` 的 SSE 读取器。
 *
 * 只认四个事件（其余忽略，保持与供应商新增事件解耦）：
 * - `response.output_text.delta` ⇒ 累加文本并回调**累积**文本（助手 emitChunk 期望累积值）；
 * - `response.output_item.done` ⇒ `function_call` item 记下来，交给工具循环；
 * - `response.completed` ⇒ 取 `response.usage` 并结束读取；
 * - `error` / `response.failed` ⇒ 中性 `ChatProtocolFailureError`（摘要不含凭据）。
 */
export type ResponsesUsage = {
  input_tokens?: unknown
  output_tokens?: unknown
  total_tokens?: unknown
}

export type ResponsesTurn = {
  /** 本轮文本；只有在拿到函数调用时允许为空串。 */
  text: string
  stats: ChatProtocolStats | null
  functionCalls: ChatProtocolToolCall[]
}

export const RESPONSES_STREAM_WITHOUT_BODY = 'Model stream did not include a response body.'
export const RESPONSES_WITHOUT_ASSISTANT_TEXT = 'Model response did not include assistant text.'
const FALLBACK_STREAM_FAILURE_SUMMARY = 'Model stream reported an error.'

type ResponsesStreamEvent = {
  type?: unknown
  delta?: unknown
  item?: unknown
  error?: { message?: unknown }
  response?: { usage?: ResponsesUsage; error?: { message?: unknown } }
}

export async function readResponsesStream(
  response: Response,
  options: { onDelta?: (partialText: string) => Promise<void> | void; signal?: AbortSignal } = {}
): Promise<ResponsesTurn> {
  if (!response.body) throw new Error(RESPONSES_STREAM_WITHOUT_BODY)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage: ResponsesUsage | undefined
  const functionCalls: ChatProtocolToolCall[] = []

  // abort 必须能打断读取循环：取消 reader 让挂起的 read() 立即返回，再在循环里抛 AbortError。
  const cancelReading = (): void => {
    void reader.cancel().catch(() => undefined)
  }
  options.signal?.addEventListener('abort', cancelReading)

  try {
    let completed = false
    while (!completed) {
      const { done, value } = await reader.read()
      if (value) buffer += decoder.decode(value, { stream: !done })

      const events = extractSseEvents(buffer)
      buffer = events.remainder
      for (const raw of events.items) {
        if (options.signal?.aborted) throw createAbortError()
        const event = parseStreamEvent(raw)
        if (!event) continue
        if (event.type === 'error') throw createStreamFailure(summaryOf(event.error?.message))
        if (event.type === 'response.failed') {
          throw createStreamFailure(summaryOf(event.response?.error?.message))
        }
        if (event.type === 'response.output_text.delta') {
          if (typeof event.delta !== 'string' || !event.delta) continue
          text += event.delta
          await options.onDelta?.(text)
          continue
        }
        if (event.type === 'response.output_item.done') {
          functionCalls.push(...readResponsesFunctionCalls([event.item]))
          continue
        }
        if (event.type === 'response.completed') {
          usage = event.response?.usage
          completed = true
        }
      }

      if (options.signal?.aborted) throw createAbortError()
      if (done) break
    }
    if (completed) cancelReading()
  } catch (error) {
    cancelReading()
    throw error
  } finally {
    options.signal?.removeEventListener('abort', cancelReading)
  }

  if (!text.trim() && !functionCalls.length) throw new Error(RESPONSES_WITHOUT_ASSISTANT_TEXT)
  return { text: text.trim(), stats: normalizeResponsesUsage(usage), functionCalls }
}

export function normalizeResponsesUsage(usage?: ResponsesUsage): ChatProtocolStats | null {
  if (!usage) return null
  return {
    promptTokens: toNumber(usage.input_tokens),
    completionTokens: toNumber(usage.output_tokens),
    totalTokens: toNumber(usage.total_tokens)
  }
}

function createStreamFailure(summary: string): ChatProtocolFailureError {
  return new ChatProtocolFailureError({ phase: 'response', summary })
}

function summaryOf(message: unknown): string {
  return typeof message === 'string' && message.trim() ? message.trim() : FALLBACK_STREAM_FAILURE_SUMMARY
}

function createAbortError(): Error {
  const error = new Error('The response stream was aborted.')
  error.name = 'AbortError'
  return error
}

function parseStreamEvent(raw: string): ResponsesStreamEvent | null {
  if (!raw || raw === '[DONE]') return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as ResponsesStreamEvent
  } catch {
    return null
  }
}

function extractSseEvents(buffer: string): { items: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n')
  const parts = normalized.split('\n\n')
  const remainder = parts.pop() ?? ''
  const items = parts
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trim())
        .join('\n')
    )
    .filter(Boolean)
  return { items, remainder }
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
