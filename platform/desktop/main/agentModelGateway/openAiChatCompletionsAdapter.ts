import { buildChatCompletionsUrl } from '../../../ai/providers/providerEndpoints'
import {
  extractSystemText,
  parseAnthropicMessagesRequest,
  type AnthropicContentBlock,
  type AnthropicImageBlock,
  type AnthropicMessagesRequest,
  type AnthropicToolDefinition
} from './anthropicMessagesTypes'
import {
  buildAnthropicContentBlockStopFrame,
  buildAnthropicErrorFrame,
  buildAnthropicMessageDeltaFrame,
  buildAnthropicMessageStartFrame,
  buildAnthropicMessageStopFrame,
  buildAnthropicNonStreamResponse,
  buildAnthropicTextBlockStartFrame,
  buildAnthropicTextDeltaFrame,
  buildAnthropicToolInputDeltaFrame,
  buildAnthropicToolUseBlockStartFrame,
  formatAnthropicSseFrames,
  mapOpenAiFinishReason
} from './anthropicSseMapper'
import {
  classifyGatewayHttpStatus,
  classifyGatewayTransportError,
  toSafeGatewayErrorBody
} from './gatewayErrorClassifier'
import { createGatewayAbortTimeout } from './gatewayAbortAndTimeout'

export type OpenAiChatCompletionsAdapterInput = {
  upstreamBaseUrl: string
  upstreamApiKey: string
  body: string
  fetch: typeof fetch
  abortSignal?: AbortSignal
  timeoutMs?: number
}

export type OpenAiChatCompletionsAdapterResult = {
  status: number
  headers: Record<string, string>
  body: string
}

type OpenAiChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content?: string | Array<Record<string, unknown>> | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
  name?: string
}

export function mapAnthropicRequestToOpenAiChatCompletions(
  request: AnthropicMessagesRequest
): Record<string, unknown> {
  const messages: OpenAiChatMessage[] = []
  const systemText = extractSystemText(request.system)
  if (systemText) {
    messages.push({ role: 'system', content: systemText })
  }

  for (const message of request.messages) {
    messages.push(...mapAnthropicMessageToOpenAiChat(message))
  }

  const payload: Record<string, unknown> = {
    model: request.model,
    messages,
    max_tokens: request.max_tokens,
    stream: Boolean(request.stream)
  }

  if (typeof request.temperature === 'number') payload.temperature = request.temperature
  if (typeof request.top_p === 'number') payload.top_p = request.top_p
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    payload.tools = request.tools.map(mapAnthropicToolToOpenAi)
  }
  if (request.tool_choice !== undefined) {
    payload.tool_choice = mapAnthropicToolChoice(request.tool_choice)
  }

  return payload
}

export async function forwardOpenAiChatCompletions(
  input: OpenAiChatCompletionsAdapterInput
): Promise<OpenAiChatCompletionsAdapterResult> {
  let request: AnthropicMessagesRequest
  try {
    request = parseAnthropicMessagesRequest(input.body)
  } catch (error) {
    return jsonError(400, {
      kind: 'protocol',
      message: error instanceof Error ? error.message : 'Invalid Anthropic Messages request.'
    })
  }

  const abortHandle = createGatewayAbortTimeout({
    timeoutMs: input.timeoutMs,
    parentSignal: input.abortSignal
  })

  try {
    const upstreamPayload = mapAnthropicRequestToOpenAiChatCompletions(request)
    const response = await input.fetch(buildChatCompletionsUrl(input.upstreamBaseUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${input.upstreamApiKey}`
      },
      body: JSON.stringify(upstreamPayload),
      signal: abortHandle.signal
    })

    if (!response.ok) {
      const bodyText = await safeReadText(response)
      const classified = classifyGatewayHttpStatus(response.status, {
        location: 'upstream',
        bodyText
      })
      return {
        status: classified.status,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify(toSafeGatewayErrorBody(classified))
      }
    }

    if (request.stream) {
      const sseBody = await convertOpenAiChatStreamToAnthropicSse(response, request.model)
      return {
        status: 200,
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive'
        },
        body: sseBody
      }
    }

    const upstreamJson = (await response.json()) as OpenAiChatCompletionResponse
    const anthropic = convertOpenAiChatCompletionToAnthropic(upstreamJson, request.model)
    return {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(anthropic)
    }
  } catch (error) {
    const classified = classifyGatewayTransportError(error)
    return {
      status: classified.status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(toSafeGatewayErrorBody(classified))
    }
  } finally {
    abortHandle.clear()
  }
}

type OpenAiChatCompletionResponse = {
  id?: string
  model?: string
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
  }
}

export function convertOpenAiChatCompletionToAnthropic(
  response: OpenAiChatCompletionResponse,
  fallbackModel: string
) {
  const choice = response.choices?.[0]
  const content: AnthropicContentBlock[] = []
  const text = extractOpenAiMessageText(choice?.message?.content)
  if (text) {
    content.push({ type: 'text', text })
  }

  for (const toolCall of choice?.message?.tool_calls ?? []) {
    if (!toolCall.id || !toolCall.function?.name) {
      throw new Error('OpenAI tool call is missing id or function name.')
    }
    content.push({
      type: 'tool_use',
      id: toolCall.id,
      name: toolCall.function.name,
      input: safeParseJson(toolCall.function.arguments ?? '{}')
    })
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  return buildAnthropicNonStreamResponse({
    id: response.id ?? `msg_${Date.now().toString(36)}`,
    model: response.model ?? fallbackModel,
    content,
    stopReason: mapOpenAiFinishReason(choice?.finish_reason),
    usage: {
      input_tokens: response.usage?.prompt_tokens ?? 0,
      output_tokens: response.usage?.completion_tokens ?? 0
    }
  })
}

async function convertOpenAiChatStreamToAnthropicSse(response: Response, model: string): Promise<string> {
  const reader = response.body?.getReader()
  if (!reader) {
    return formatAnthropicSseFrames([buildAnthropicErrorFrame('Upstream stream body was empty.', 'protocol')])
  }

  const decoder = new TextDecoder()
  let buffer = ''
  let messageId = `msg_${Date.now().toString(36)}`
  let started = false
  let textStarted = false
  let textIndex = 0
  let nextBlockIndex = 0
  const toolIndexes = new Map<number, number>()
  let finishReason: string | null = null
  const frames: ReturnType<typeof buildAnthropicMessageStartFrame>[] = []

  const ensureMessageStart = () => {
    if (started) return
    frames.push(buildAnthropicMessageStartFrame({ id: messageId, model }))
    started = true
  }

  const ensureTextStart = () => {
    ensureMessageStart()
    if (textStarted) return
    textIndex = nextBlockIndex
    nextBlockIndex += 1
    frames.push(buildAnthropicTextBlockStartFrame(textIndex))
    textStarted = true
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''

      for (const line of parts) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const data = trimmed.slice(5).trim()
        if (!data) continue
        if (data === '[DONE]') {
          if (textStarted) frames.push(buildAnthropicContentBlockStopFrame(textIndex))
          for (const index of toolIndexes.values()) {
            frames.push(buildAnthropicContentBlockStopFrame(index))
          }
          frames.push(
            buildAnthropicMessageDeltaFrame({ stopReason: mapOpenAiFinishReason(finishReason) }),
            buildAnthropicMessageStopFrame()
          )
          return formatAnthropicSseFrames(frames)
        }

        let chunk: OpenAiChatStreamChunk
        try {
          chunk = JSON.parse(data) as OpenAiChatStreamChunk
        } catch {
          continue
        }

        if (chunk.id) messageId = chunk.id
        const delta = chunk.choices?.[0]?.delta
        if (chunk.choices?.[0]?.finish_reason) {
          finishReason = chunk.choices[0].finish_reason
        }

        if (typeof delta?.content === 'string' && delta.content.length > 0) {
          ensureTextStart()
          frames.push(buildAnthropicTextDeltaFrame(textIndex, delta.content))
        }

        for (const toolCall of delta?.tool_calls ?? []) {
          ensureMessageStart()
          const openAiIndex = typeof toolCall.index === 'number' ? toolCall.index : 0
          let anthropicIndex = toolIndexes.get(openAiIndex)
          if (anthropicIndex === undefined) {
            if (!toolCall.id || !toolCall.function?.name) {
              frames.push(
                buildAnthropicErrorFrame(
                  'OpenAI tool-call stream is missing id/name and cannot be mapped safely.',
                  'protocol'
                )
              )
              return formatAnthropicSseFrames(frames)
            }
            anthropicIndex = nextBlockIndex
            nextBlockIndex += 1
            toolIndexes.set(openAiIndex, anthropicIndex)
            frames.push(
              buildAnthropicToolUseBlockStartFrame({
                index: anthropicIndex,
                id: toolCall.id,
                name: toolCall.function.name
              })
            )
          }
          if (typeof toolCall.function?.arguments === 'string' && toolCall.function.arguments) {
            frames.push(buildAnthropicToolInputDeltaFrame(anthropicIndex, toolCall.function.arguments))
          }
        }
      }
    }

    if (!started) {
      return formatAnthropicSseFrames([buildAnthropicErrorFrame('Upstream stream ended without data.', 'protocol')])
    }
    if (textStarted) frames.push(buildAnthropicContentBlockStopFrame(textIndex))
    for (const index of toolIndexes.values()) {
      frames.push(buildAnthropicContentBlockStopFrame(index))
    }
    frames.push(
      buildAnthropicMessageDeltaFrame({ stopReason: mapOpenAiFinishReason(finishReason) }),
      buildAnthropicMessageStopFrame()
    )
    return formatAnthropicSseFrames(frames)
  } catch (error) {
    const classified = classifyGatewayTransportError(error)
    ensureMessageStart()
    frames.push(buildAnthropicErrorFrame(classified.message, classified.kind))
    return formatAnthropicSseFrames(frames)
  }
}

type OpenAiChatStreamChunk = {
  id?: string
  choices?: Array<{
    delta?: {
      content?: string | null
      tool_calls?: Array<{
        index?: number
        id?: string
        type?: string
        function?: { name?: string; arguments?: string }
      }>
    }
    finish_reason?: string | null
  }>
}

function mapAnthropicMessageToOpenAiChat(message: AnthropicMessagesRequest['messages'][number]): OpenAiChatMessage[] {
  if (typeof message.content === 'string') {
    return [{ role: message.role, content: message.content }]
  }

  const textParts: string[] = []
  const contentParts: Array<Record<string, unknown>> = []
  const toolCalls: NonNullable<OpenAiChatMessage['tool_calls']> = []
  const toolResults: OpenAiChatMessage[] = []

  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text)
      contentParts.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image' && isAnthropicImageSource(block.source)) {
      if (block.source.type === 'url' && block.source.url) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: block.source.url }
        })
      } else if (block.source.type === 'base64' && block.source.data && block.source.media_type) {
        contentParts.push({
          type: 'image_url',
          image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` }
        })
      }
      continue
    }
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input ?? {})
        }
      })
      continue
    }
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      toolResults.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
      })
    }
  }

  const mapped: OpenAiChatMessage[] = []
  if (message.role === 'assistant' && toolCalls.length > 0) {
    mapped.push({
      role: 'assistant',
      content: textParts.join('\n') || null,
      tool_calls: toolCalls
    })
  } else if (contentParts.length > 1 || contentParts.some((part) => part.type === 'image_url')) {
    mapped.push({ role: message.role, content: contentParts })
  } else {
    mapped.push({ role: message.role, content: textParts.join('\n') })
  }
  mapped.push(...toolResults)
  return mapped
}

function mapAnthropicToolToOpenAi(tool: AnthropicToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description ?? '',
      parameters: tool.input_schema ?? { type: 'object', properties: {} }
    }
  }
}

function mapAnthropicToolChoice(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== 'object') return toolChoice
  const value = toolChoice as { type?: string; name?: string }
  if (value.type === 'auto') return 'auto'
  if (value.type === 'any') return 'required'
  if (value.type === 'tool' && value.name) {
    return { type: 'function', function: { name: value.name } }
  }
  return toolChoice
}

function extractOpenAiMessageText(
  content: string | Array<{ type?: string; text?: string }> | null | undefined
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text!)
    .join('')
}

function isAnthropicImageSource(value: unknown): value is AnthropicImageBlock['source'] {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<AnthropicImageBlock['source']>
  return source.type === 'url' || source.type === 'base64'
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text()
  } catch {
    return ''
  }
}

function jsonError(status: number, error: { kind: string; message: string }): OpenAiChatCompletionsAdapterResult {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      type: 'error',
      error
    })
  }
}
