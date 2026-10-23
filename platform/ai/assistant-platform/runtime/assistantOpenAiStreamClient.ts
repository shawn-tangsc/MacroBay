import { buildChatCompletionsUrl } from '../../providers/providerEndpoints'
import type { AssistantMessageStats } from '../schemas/messageSchemas'
import type { AssistantMessagePart } from '../schemas/messageSchemas'
import { AssistantInvocationFailureError } from './assistantInvocationFailureEvidence'

export type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  tool_calls?: AssistantToolCallWire[]
}

export type ChatCompletionTool = {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: unknown
  }
}

export type AssistantToolCall = {
  id: string
  name: string
  argumentsJson: string
}

export type AssistantToolExecutionResult = {
  ok: boolean
  content: string
  messagePart?: AssistantMessagePart
}

type AssistantToolCallWire = {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

type ChatCompletionUsage = {
  total_tokens?: unknown
  prompt_tokens?: unknown
  completion_tokens?: unknown
}

type ChatCompletionStreamChunk = {
  id?: unknown
  choices?: Array<{
    delta?: { content?: unknown; tool_calls?: unknown }
    message?: { content?: unknown; tool_calls?: unknown }
    text?: unknown
  }>
  usage?: ChatCompletionUsage
}

export type AssistantStreamResult = {
  text: string
  stats: AssistantMessageStats | null
  messageParts?: AssistantMessagePart[]
}

export async function streamOpenAiCompatibleChatCompletion(input: {
  baseUrl: string
  apiKey: string
  providerId?: string
  modelId: string
  messages: ChatCompletionMessage[]
  temperature?: number
  signal?: AbortSignal
  fetch?: typeof fetch
  onDelta?: (partialText: string) => Promise<void> | void
  tools?: ChatCompletionTool[]
  executeTool?: (call: AssistantToolCall) => Promise<AssistantToolExecutionResult>
  maxToolCalls?: number
}): Promise<AssistantStreamResult> {
  const messages = [...input.messages]
  const toolParts: AssistantMessagePart[] = []
  let executedToolCalls = 0

  while (true) {
    const result = await requestChatCompletion({ ...input, messages })
    if (!result.toolCalls.length) {
      return {
        text: result.text,
        stats: result.stats,
        messageParts: toolParts
      }
    }

    if (!input.executeTool || !input.tools?.length) {
      throw new Error('Model requested tools, but no tool executor is configured.')
    }
    executedToolCalls += result.toolCalls.length
    const maxToolCalls = input.maxToolCalls ?? 6
    if (executedToolCalls > maxToolCalls) {
      throw new Error('Assistant tool call limit exceeded.')
    }

    messages.push({
      role: 'assistant',
      content: result.text,
      tool_calls: result.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: {
          name: call.name,
          arguments: call.argumentsJson
        }
      }))
    })
    for (const call of result.toolCalls) {
      const toolResult = await input.executeTool(call)
      if (toolResult.messagePart) toolParts.push(toolResult.messagePart)
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: toolResult.content
      })
    }
  }
}

async function requestChatCompletion(input: {
  baseUrl: string
  apiKey: string
  providerId?: string
  modelId: string
  messages: ChatCompletionMessage[]
  temperature?: number
  signal?: AbortSignal
  fetch?: typeof fetch
  onDelta?: (partialText: string) => Promise<void> | void
  tools?: ChatCompletionTool[]
}): Promise<AssistantStreamResult & { toolCalls: AssistantToolCall[] }> {
  const response = await (input.fetch ?? fetch)(buildChatCompletionsUrl(input.baseUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      'content-type': 'application/json'
    },
    signal: input.signal,
    body: JSON.stringify({
      model: input.modelId,
      messages: input.messages,
      temperature: input.temperature ?? 0.2,
      stream: !input.tools?.length,
      ...(input.tools?.length ? { tools: input.tools, tool_choice: 'auto' } : {})
    })
  })

  if (!response.ok) {
    const providerFailure = await readProviderFailure(response)
    throw new AssistantInvocationFailureError('provider-request-failed', {
      phase: 'response',
      summary: providerFailure.summary,
      ...(input.providerId ? { providerId: input.providerId } : {}),
      modelId: input.modelId,
      httpStatus: response.status,
      ...(providerFailure.body ? { body: providerFailure.body } : {})
    })
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const payload = (await response.json()) as ChatCompletionStreamChunk
    const text = extractAssistantText(payload)
    return { text, stats: normalizeUsage(payload.usage), toolCalls: extractToolCalls(payload) }
  }

  return {
    ...(await readStreamingChatCompletion(response, input.onDelta)),
    toolCalls: []
  }
}

async function readStreamingChatCompletion(
  response: Response,
  onDelta?: (partialText: string) => Promise<void> | void
): Promise<AssistantStreamResult> {
  if (!response.body) throw new Error('Model stream did not include a response body.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage: ChatCompletionUsage | undefined

  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })

    const events = extractSseEvents(buffer)
    buffer = events.remainder
    for (const event of events.items) {
      if (event === '[DONE]') continue
      const chunk = parseStreamChunk(event)
      if (!chunk) continue
      if (chunk.usage) usage = chunk.usage
      const delta = extractDeltaText(chunk)
      if (!delta) continue
      text += delta
      await onDelta?.(text)
    }

    if (done) break
  }

  if (!text.trim()) throw new Error('Model response did not include assistant text.')
  return { text: text.trim(), stats: normalizeUsage(usage) }
}

async function readProviderFailure(response: Response): Promise<{ summary: string; body?: string }> {
  const body = await response.text()
  try {
    const payload = JSON.parse(body) as { error?: { message?: unknown } }
    const summary = typeof payload.error?.message === 'string' ? payload.error.message.trim() : ''
    return { summary: summary || `HTTP ${response.status}`, ...(body.trim() ? { body } : {}) }
  } catch {
    return { summary: `HTTP ${response.status}`, ...(body.trim() ? { body } : {}) }
  }
}

function extractAssistantText(payload: ChatCompletionStreamChunk): string {
  const firstChoice = payload.choices?.[0]
  const messageContent = firstChoice?.message?.content
  if (typeof messageContent === 'string' && messageContent.trim()) return messageContent.trim()
  if (Array.isArray(firstChoice?.message?.tool_calls)) return ''
  if (typeof firstChoice?.text === 'string' && firstChoice.text.trim()) return firstChoice.text.trim()
  throw new Error('Model response did not include assistant text.')
}

function extractToolCalls(payload: ChatCompletionStreamChunk): AssistantToolCall[] {
  const rawToolCalls = payload.choices?.[0]?.message?.tool_calls
  if (!Array.isArray(rawToolCalls)) return []
  return rawToolCalls.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return []
    const candidate = raw as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }
    if (typeof candidate.id !== 'string') return []
    if (typeof candidate.function?.name !== 'string') return []
    return [
      {
        id: candidate.id,
        name: candidate.function.name,
        argumentsJson:
          typeof candidate.function.arguments === 'string' ? candidate.function.arguments : JSON.stringify(candidate.function.arguments ?? {})
      }
    ]
  })
}

function extractDeltaText(payload: ChatCompletionStreamChunk): string {
  const firstChoice = payload.choices?.[0]
  const deltaContent = firstChoice?.delta?.content
  if (typeof deltaContent === 'string') return deltaContent
  const messageContent = firstChoice?.message?.content
  if (typeof messageContent === 'string') return messageContent
  if (typeof firstChoice?.text === 'string') return firstChoice.text
  return ''
}

function parseStreamChunk(raw: string): ChatCompletionStreamChunk | null {
  try {
    return JSON.parse(raw) as ChatCompletionStreamChunk
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

function normalizeUsage(usage?: ChatCompletionUsage): AssistantMessageStats | null {
  if (!usage) return null
  return {
    totalTokens: toNumber(usage.total_tokens),
    promptTokens: toNumber(usage.prompt_tokens),
    completionTokens: toNumber(usage.completion_tokens)
  }
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
