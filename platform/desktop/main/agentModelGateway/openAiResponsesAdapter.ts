import { buildResponsesUrl } from '../../../ai/providers/providerEndpoints'
import {
  extractSystemText,
  parseAnthropicMessagesRequest,
  type AnthropicContentBlock,
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

export type OpenAiResponsesAdapterInput = {
  upstreamBaseUrl: string
  upstreamApiKey: string
  body: string
  fetch: typeof fetch
  abortSignal?: AbortSignal
  timeoutMs?: number
}

export type OpenAiResponsesAdapterResult = {
  status: number
  headers: Record<string, string>
  body: string
}

export function mapAnthropicRequestToOpenAiResponses(request: AnthropicMessagesRequest): Record<string, unknown> {
  const input: Array<Record<string, unknown>> = []
  const systemText = extractSystemText(request.system)
  if (systemText) {
    input.push({
      role: 'system',
      content: [{ type: 'input_text', text: systemText }]
    })
  }

  for (const message of request.messages) {
    input.push(...mapAnthropicMessageToResponsesInput(message))
  }

  const payload: Record<string, unknown> = {
    model: request.model,
    input,
    max_output_tokens: request.max_tokens,
    stream: Boolean(request.stream)
  }

  if (typeof request.temperature === 'number') payload.temperature = request.temperature
  if (typeof request.top_p === 'number') payload.top_p = request.top_p
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    payload.tools = request.tools.map(mapAnthropicToolToResponses)
  }

  return payload
}

export async function forwardOpenAiResponses(
  input: OpenAiResponsesAdapterInput
): Promise<OpenAiResponsesAdapterResult> {
  let request: AnthropicMessagesRequest
  try {
    request = parseAnthropicMessagesRequest(input.body)
  } catch (error) {
    return {
      status: 400,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        type: 'error',
        error: {
          type: 'protocol',
          message: error instanceof Error ? error.message : 'Invalid Anthropic Messages request.'
        }
      })
    }
  }

  const abortHandle = createGatewayAbortTimeout({
    timeoutMs: input.timeoutMs,
    parentSignal: input.abortSignal
  })

  try {
    const upstreamPayload = mapAnthropicRequestToOpenAiResponses(request)
    const response = await input.fetch(buildResponsesUrl(input.upstreamBaseUrl), {
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
      const sseBody = await convertOpenAiResponsesStreamToAnthropicSse(response, request.model)
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

    const upstreamJson = (await response.json()) as OpenAiResponsesResult
    const anthropic = convertOpenAiResponsesToAnthropic(upstreamJson, request.model)
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

type OpenAiResponsesResult = {
  id?: string
  model?: string
  output?: Array<{
    type?: string
    id?: string
    name?: string
    arguments?: string
    content?: Array<{ type?: string; text?: string }>
  }>
  usage?: {
    input_tokens?: number
    output_tokens?: number
  }
  status?: string
  error?: { message?: string }
}

export function convertOpenAiResponsesToAnthropic(response: OpenAiResponsesResult, fallbackModel: string) {
  if (response.status === 'failed') {
    throw new Error(response.error?.message ?? 'OpenAI Responses request failed.')
  }

  const content: AnthropicContentBlock[] = []
  for (const item of response.output ?? []) {
    if (item.type === 'message' || item.type === 'output_text') {
      const text = (item.content ?? [])
        .filter((part) => part.type === 'output_text' || part.type === 'text')
        .map((part) => part.text ?? '')
        .join('')
      if (text) content.push({ type: 'text', text })
      continue
    }
    if (item.type === 'function_call') {
      if (!item.id || !item.name) {
        throw new Error('OpenAI Responses function_call is missing id or name.')
      }
      content.push({
        type: 'tool_use',
        id: item.id,
        name: item.name,
        input: safeParseJson(item.arguments ?? '{}')
      })
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  const hasToolUse = content.some((block) => block.type === 'tool_use')
  return buildAnthropicNonStreamResponse({
    id: response.id ?? `msg_${Date.now().toString(36)}`,
    model: response.model ?? fallbackModel,
    content,
    stopReason: hasToolUse ? 'tool_use' : 'end_turn',
    usage: {
      input_tokens: response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0
    }
  })
}

async function convertOpenAiResponsesStreamToAnthropicSse(response: Response, model: string): Promise<string> {
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
  const toolIndexes = new Map<string, number>()
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
        if (!data || data === '[DONE]') continue

        let event: OpenAiResponsesStreamEvent
        try {
          event = JSON.parse(data) as OpenAiResponsesStreamEvent
        } catch {
          continue
        }

        if (event.response?.id) messageId = event.response.id

        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          ensureTextStart()
          frames.push(buildAnthropicTextDeltaFrame(textIndex, event.delta))
          continue
        }

        if (event.type === 'response.output_item.added' && event.item) {
          ensureMessageStart()
          if (event.item.type === 'function_call') {
            if (!event.item.id || !event.item.name) {
              frames.push(
                buildAnthropicErrorFrame(
                  'OpenAI Responses function_call stream is missing id/name and cannot be mapped safely.',
                  'protocol'
                )
              )
              return formatAnthropicSseFrames(frames)
            }
            const index = nextBlockIndex
            nextBlockIndex += 1
            toolIndexes.set(event.item.id, index)
            frames.push(
              buildAnthropicToolUseBlockStartFrame({
                index,
                id: event.item.id,
                name: event.item.name
              })
            )
          }
          continue
        }

        if (
          event.type === 'response.function_call_arguments.delta' &&
          typeof event.delta === 'string' &&
          event.item_id
        ) {
          const index = toolIndexes.get(event.item_id)
          if (index === undefined) {
            frames.push(
              buildAnthropicErrorFrame(
                'OpenAI Responses tool argument delta arrived before tool start.',
                'protocol'
              )
            )
            return formatAnthropicSseFrames(frames)
          }
          frames.push(buildAnthropicToolInputDeltaFrame(index, event.delta))
          continue
        }

        if (event.type === 'response.completed') {
          finishReason = toolIndexes.size > 0 ? 'tool_calls' : 'stop'
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

        if (event.type === 'response.failed') {
          ensureMessageStart()
          frames.push(
            buildAnthropicErrorFrame(event.response?.error?.message ?? 'OpenAI Responses stream failed.', 'upstream')
          )
          return formatAnthropicSseFrames(frames)
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
      buildAnthropicMessageDeltaFrame({ stopReason: mapOpenAiFinishReason(finishReason ?? 'stop') }),
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

type OpenAiResponsesStreamEvent = {
  type?: string
  delta?: string
  item_id?: string
  item?: {
    type?: string
    id?: string
    name?: string
  }
  response?: {
    id?: string
    error?: { message?: string }
  }
}

function mapAnthropicMessageToResponsesInput(
  message: AnthropicMessagesRequest['messages'][number]
): Array<Record<string, unknown>> {
  if (typeof message.content === 'string') {
    return [
      {
        role: message.role,
        content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: message.content }]
      }
    ]
  }

  const content: Array<Record<string, unknown>> = []
  const functionCalls: Array<Record<string, unknown>> = []
  const functionOutputs: Array<Record<string, unknown>> = []

  for (const block of message.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      content.push({
        type: message.role === 'assistant' ? 'output_text' : 'input_text',
        text: block.text
      })
      continue
    }
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      functionCalls.push({
        type: 'function_call',
        id: block.id,
        call_id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.input ?? {})
      })
      continue
    }
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      functionOutputs.push({
        type: 'function_call_output',
        call_id: block.tool_use_id,
        output: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
      })
    }
  }

  const mapped: Array<Record<string, unknown>> = []
  if (content.length > 0) {
    mapped.push({ role: message.role, content })
  }
  mapped.push(...functionCalls, ...functionOutputs)
  return mapped
}

function mapAnthropicToolToResponses(tool: AnthropicToolDefinition): Record<string, unknown> {
  return {
    type: 'function',
    name: tool.name,
    description: tool.description ?? '',
    parameters: tool.input_schema ?? { type: 'object', properties: {} }
  }
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
