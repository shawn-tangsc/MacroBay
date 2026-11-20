import { buildChatCompletionsUrl } from '../providers/providerEndpoints'
import type { StructuredModelMessage, TransportErrorKind } from './structuredModelInvocationTypes'
import { classifyTransportError } from './transportErrorKind'

export type ChatCompletionRequest = {
  baseUrl: string
  apiKey: string
  modelId: string
  messages: StructuredModelMessage[]
  temperature?: number
  jsonMode?: boolean
  /** 出网通道，必传；由组合根注入 `platformFetch`。 */
  fetch: typeof fetch
  abortSignal?: AbortSignal
}

export type ChatCompletionResult =
  | { ok: true; content: string }
  | {
      ok: false
      errorCode: 'rate-limited' | 'provider-error'
      /** 收到响应时带的状态码；没收到响应时没有它，改由 `transportErrorKind` 说明。 */
      status?: number
      /** 没收到响应时底层错误的归类（DNS / 拒绝 / 重置 / TLS / 超时 / 中止 / 未知）。 */
      transportErrorKind?: TransportErrorKind
    }

export async function requestOpenAiCompatibleChatCompletion(
  input: ChatCompletionRequest
): Promise<ChatCompletionResult> {
  try {
    const response = await input.fetch(buildChatCompletionsUrl(input.baseUrl), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: input.modelId,
        messages: input.messages,
        temperature: input.temperature ?? 0.1,
        response_format: input.jsonMode === false ? undefined : { type: 'json_object' }
      }),
      signal: input.abortSignal
    })

    if (!response.ok) {
      if (response.status === 429) {
        return { ok: false, errorCode: 'rate-limited', status: response.status }
      }
      return { ok: false, errorCode: 'provider-error', status: response.status }
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>
    }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      return { ok: false, errorCode: 'provider-error' }
    }

    return { ok: true, content: content.trim() }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    // 没收到任何响应：把底层错误归进闭集，交给上层按事实判 `connect-failed` / `gateway-timeout`。
    return { ok: false, errorCode: 'provider-error', transportErrorKind: classifyTransportError(error) }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
