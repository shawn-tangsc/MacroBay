import { buildMessagesUrl } from '../providers/providerEndpoints'
import { ChatProtocolFailureError, readChatProviderFailure } from './chatProtocolFailure'
import type {
  ChatProtocolClientInput,
  ChatProtocolMessage,
  ChatProtocolResult,
  ChatProtocolStats
} from './chatProtocolTypes'

/**
 * PLAT-69：Anthropic Messages（`POST /v1/messages`）适配器 —— 非流式。
 *
 * - 鉴权：`x-api-key` + `anthropic-version: 2023-06-01`（**不是** Bearer）；
 * - body：`{model, max_tokens, system?, messages:[{role:'user'|'assistant', content}]}`，
 *   system 消息合并到顶层 `system`，tool 消息在这条链路上不发送；
 * - 响应：`content[]` 里 `type:'text'` 的块拼成正文，忽略 thinking/tool_use 等块；
 * - 流式与工具调用暂不做（与 responses / gemini 两条链路同一限制）。
 */
export type MessagesChatRequest = ChatProtocolClientInput & {
  /** 上限；Anthropic 必填，默认 4096。 */
  maxTokens?: number
}

export const DEFAULT_MESSAGES_MAX_TOKENS = 4096
export const ANTHROPIC_VERSION = '2023-06-01'

type MessagesUsage = {
  input_tokens?: unknown
  output_tokens?: unknown
}

type MessagesPayload = {
  content?: unknown
  usage?: MessagesUsage
}

export async function requestMessagesChatCompletion(input: MessagesChatRequest): Promise<ChatProtocolResult> {
  const response = await (input.fetch ?? fetch)(buildMessagesUrl(input.baseUrl), {
    method: 'POST',
    headers: {
      'x-api-key': input.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json'
    },
    signal: input.signal,
    body: JSON.stringify(buildMessagesBody(input))
  })

  if (!response.ok) {
    const failure = await readChatProviderFailure(response)
    throw new ChatProtocolFailureError({
      phase: 'response',
      summary: failure.summary,
      httpStatus: response.status,
      ...(failure.body ? { body: failure.body } : {})
    })
  }

  const payload = (await response.json().catch(() => null)) as MessagesPayload | null
  const text = readMessagesText(payload)
  await input.onDelta?.(text)
  return { text, stats: normalizeMessagesUsage(payload?.usage) }
}

export function buildMessagesBody(input: {
  modelId: string
  messages: ChatProtocolMessage[]
  temperature?: number
  maxTokens?: number
}): Record<string, unknown> {
  const systemTexts: string[] = []
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = []
  for (const message of input.messages) {
    if (message.role === 'tool') continue
    if (message.role === 'system') {
      if (message.content.trim()) systemTexts.push(message.content.trim())
      continue
    }
    messages.push({ role: message.role, content: message.content })
  }
  return {
    model: input.modelId,
    max_tokens: input.maxTokens ?? DEFAULT_MESSAGES_MAX_TOKENS,
    ...(systemTexts.length ? { system: systemTexts.join('\n\n') } : {}),
    messages,
    ...(input.temperature === undefined ? {} : { temperature: input.temperature })
  }
}

export function readMessagesText(payload: MessagesPayload | null): string {
  const blocks = Array.isArray(payload?.content) ? payload.content : []
  const text = blocks
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return []
      const record = block as { type?: unknown; text?: unknown }
      return record.type === 'text' && typeof record.text === 'string' ? [record.text] : []
    })
    .join('')
    .trim()
  if (!text) throw new Error('Model response did not include assistant text.')
  return text
}

function normalizeMessagesUsage(usage?: MessagesUsage): ChatProtocolStats | null {
  if (!usage) return null
  const promptTokens = toNumber(usage.input_tokens)
  const completionTokens = toNumber(usage.output_tokens)
  const totalTokens = promptTokens === undefined || completionTokens === undefined
    ? undefined
    : promptTokens + completionTokens
  return { promptTokens, completionTokens, totalTokens }
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
