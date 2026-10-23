import { buildGeminiGenerateUrl } from '../providers/providerEndpoints'
import { ChatProtocolFailureError, readChatProviderFailure } from './chatProtocolFailure'
import type {
  ChatProtocolClientInput,
  ChatProtocolMessage,
  ChatProtocolResult,
  ChatProtocolStats
} from './chatProtocolTypes'

/**
 * T5：Gemini 原生（`:generateContent`）适配器 —— 非流式。
 *
 * - 鉴权：`x-goog-api-key`（**不是** Bearer）；
 * - 基址：`/v1`·`/v1beta` 后缀剥掉后固定拼 `/v1beta/models/<model>:generateContent`；
 * - 模型 id：`models/xxx` 前缀剥掉，避免 `models/models/xxx`；
 * - `system` 消息合并进 `systemInstruction`，assistant ⇒ `model`；
 * - `thinkingConfig` 等高级参数先不做（按任务口径）。
 */
export type GeminiChatRequest = ChatProtocolClientInput

type GeminiUsage = {
  promptTokenCount?: unknown
  candidatesTokenCount?: unknown
  totalTokenCount?: unknown
}

type GeminiPayload = {
  candidates?: unknown
  promptFeedback?: { blockReason?: unknown }
  usageMetadata?: GeminiUsage
}

type GeminiContent = { role: 'user' | 'model'; parts: Array<{ text: string }> }

export async function requestGeminiChatCompletion(input: GeminiChatRequest): Promise<ChatProtocolResult> {
  const response = await (input.fetch ?? fetch)(buildGeminiGenerateUrl(input.baseUrl, input.modelId), {
    method: 'POST',
    headers: {
      'x-goog-api-key': input.apiKey,
      'content-type': 'application/json'
    },
    signal: input.signal,
    body: JSON.stringify(buildGeminiBody(input.messages, input.temperature))
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

  const payload = (await response.json().catch(() => null)) as GeminiPayload | null
  const text = readGeminiText(payload)
  await input.onDelta?.(text)
  return { text, stats: normalizeGeminiUsage(payload?.usageMetadata) }
}

export function buildGeminiBody(
  messages: ChatProtocolMessage[],
  temperature?: number
): Record<string, unknown> {
  const systemTexts: string[] = []
  const contents: GeminiContent[] = []
  for (const message of messages) {
    if (message.role === 'tool') continue
    if (message.role === 'system') {
      if (message.content.trim()) systemTexts.push(message.content.trim())
      continue
    }
    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content }]
    })
  }
  return {
    contents,
    ...(systemTexts.length ? { systemInstruction: { parts: [{ text: systemTexts.join('\n\n') }] } } : {}),
    generationConfig: { temperature: temperature ?? 0.2 }
  }
}

export function readGeminiText(payload: GeminiPayload | null): string {
  if (!payload) throw new Error('Model response did not include assistant text.')
  const blockReason = payload.promptFeedback?.blockReason
  if (typeof blockReason === 'string' && blockReason.trim()) {
    throw new Error(`Model response was blocked: ${blockReason.trim()}`)
  }
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  const first = (candidates[0] ?? null) as { content?: { parts?: unknown } } | null
  const parts = Array.isArray(first?.content?.parts) ? first.content.parts : []
  const text = parts
    .flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const record = part as { text?: unknown }
      return typeof record.text === 'string' ? [record.text] : []
    })
    .join('')
    .trim()
  if (!text) throw new Error('Model response did not include assistant text.')
  return text
}

function normalizeGeminiUsage(usage?: GeminiUsage): ChatProtocolStats | null {
  if (!usage) return null
  return {
    promptTokens: toNumber(usage.promptTokenCount),
    completionTokens: toNumber(usage.candidatesTokenCount),
    totalTokens: toNumber(usage.totalTokenCount)
  }
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}
