export type AnthropicTextBlock = {
  type: 'text'
  text: string
}

export type AnthropicImageBlock = {
  type: 'image'
  source: {
    type: 'base64' | 'url'
    media_type?: string
    data?: string
    url?: string
  }
}

export type AnthropicToolUseBlock = {
  type: 'tool_use'
  id: string
  name: string
  input: unknown
}

export type AnthropicToolResultBlock = {
  type: 'tool_result'
  tool_use_id: string
  content?: string | AnthropicContentBlock[]
  is_error?: boolean
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock
  | { type: string; [key: string]: unknown }

export type AnthropicMessage = {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export type AnthropicToolDefinition = {
  name: string
  description?: string
  input_schema?: Record<string, unknown>
}

export type AnthropicMessagesRequest = {
  model: string
  messages: AnthropicMessage[]
  max_tokens: number
  system?: string | AnthropicTextBlock[]
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: AnthropicToolDefinition[]
  tool_choice?: unknown
  [key: string]: unknown
}

export type AnthropicUsage = {
  input_tokens?: number
  output_tokens?: number
}

export type AnthropicMessagesResponse = {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: AnthropicContentBlock[]
  stop_reason: string | null
  stop_sequence: string | null
  usage: AnthropicUsage
}

export type AnthropicSseEventName =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'error'
  | 'ping'

export type AnthropicSseFrame = {
  event: AnthropicSseEventName
  data: unknown
}

export function parseAnthropicMessagesRequest(body: string): AnthropicMessagesRequest {
  const parsed = JSON.parse(body) as AnthropicMessagesRequest
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid Anthropic Messages request body.')
  }
  if (typeof parsed.model !== 'string' || !parsed.model.trim()) {
    throw new Error('Anthropic Messages request requires a model.')
  }
  if (!Array.isArray(parsed.messages)) {
    throw new Error('Anthropic Messages request requires messages.')
  }
  if (typeof parsed.max_tokens !== 'number') {
    throw new Error('Anthropic Messages request requires max_tokens.')
  }
  return parsed
}

export function extractSystemText(system: AnthropicMessagesRequest['system']): string | undefined {
  if (!system) return undefined
  if (typeof system === 'string') {
    const trimmed = system.trim()
    return trimmed || undefined
  }
  const text = system
    .filter((block): block is AnthropicTextBlock => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim()
  return text || undefined
}
