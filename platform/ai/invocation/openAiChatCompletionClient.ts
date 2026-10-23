import { buildChatCompletionsUrl } from '../providers/providerEndpoints'
import type { StructuredModelMessage } from './structuredModelInvocationTypes'

export type ChatCompletionRequest = {
  baseUrl: string
  apiKey: string
  modelId: string
  messages: StructuredModelMessage[]
  temperature?: number
  jsonMode?: boolean
  fetch?: typeof fetch
  abortSignal?: AbortSignal
}

export type ChatCompletionResult =
  | { ok: true; content: string }
  | { ok: false; errorCode: 'rate-limited' | 'provider-error'; status?: number }

export async function requestOpenAiCompatibleChatCompletion(
  input: ChatCompletionRequest
): Promise<ChatCompletionResult> {
  try {
    const response = await (input.fetch ?? fetch)(buildChatCompletionsUrl(input.baseUrl), {
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
    return { ok: false, errorCode: 'provider-error' }
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
