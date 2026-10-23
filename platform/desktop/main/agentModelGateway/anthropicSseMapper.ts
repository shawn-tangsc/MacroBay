import type { AnthropicMessagesResponse, AnthropicSseFrame, AnthropicUsage } from './anthropicMessagesTypes'

export function formatAnthropicSseFrame(frame: AnthropicSseFrame): string {
  return `event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`
}

export function formatAnthropicSseFrames(frames: readonly AnthropicSseFrame[]): string {
  return frames.map(formatAnthropicSseFrame).join('')
}

export function buildAnthropicMessageStartFrame(input: {
  id: string
  model: string
  usage?: AnthropicUsage
}): AnthropicSseFrame {
  return {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: input.id,
        type: 'message',
        role: 'assistant',
        model: input.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: input.usage?.input_tokens ?? 0,
          output_tokens: input.usage?.output_tokens ?? 0
        }
      }
    }
  }
}

export function buildAnthropicTextBlockStartFrame(index: number): AnthropicSseFrame {
  return {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index,
      content_block: {
        type: 'text',
        text: ''
      }
    }
  }
}

export function buildAnthropicTextDeltaFrame(index: number, text: string): AnthropicSseFrame {
  return {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index,
      delta: {
        type: 'text_delta',
        text
      }
    }
  }
}

export function buildAnthropicToolUseBlockStartFrame(input: {
  index: number
  id: string
  name: string
}): AnthropicSseFrame {
  return {
    event: 'content_block_start',
    data: {
      type: 'content_block_start',
      index: input.index,
      content_block: {
        type: 'tool_use',
        id: input.id,
        name: input.name,
        input: {}
      }
    }
  }
}

export function buildAnthropicToolInputDeltaFrame(index: number, partialJson: string): AnthropicSseFrame {
  return {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index,
      delta: {
        type: 'input_json_delta',
        partial_json: partialJson
      }
    }
  }
}

export function buildAnthropicContentBlockStopFrame(index: number): AnthropicSseFrame {
  return {
    event: 'content_block_stop',
    data: {
      type: 'content_block_stop',
      index
    }
  }
}

export function buildAnthropicMessageDeltaFrame(input: {
  stopReason?: string | null
  usage?: AnthropicUsage
}): AnthropicSseFrame {
  return {
    event: 'message_delta',
    data: {
      type: 'message_delta',
      delta: {
        stop_reason: input.stopReason ?? null,
        stop_sequence: null
      },
      usage: {
        output_tokens: input.usage?.output_tokens ?? 0
      }
    }
  }
}

export function buildAnthropicMessageStopFrame(): AnthropicSseFrame {
  return {
    event: 'message_stop',
    data: {
      type: 'message_stop'
    }
  }
}

export function buildAnthropicErrorFrame(message: string, type = 'api_error'): AnthropicSseFrame {
  return {
    event: 'error',
    data: {
      type: 'error',
      error: {
        type,
        message
      }
    }
  }
}

export function buildAnthropicNonStreamResponse(input: {
  id: string
  model: string
  content: AnthropicMessagesResponse['content']
  stopReason: string | null
  usage?: AnthropicUsage
}): AnthropicMessagesResponse {
  return {
    id: input.id,
    type: 'message',
    role: 'assistant',
    model: input.model,
    content: input.content,
    stop_reason: input.stopReason,
    stop_sequence: null,
    usage: {
      input_tokens: input.usage?.input_tokens ?? 0,
      output_tokens: input.usage?.output_tokens ?? 0
    }
  }
}

export function mapOpenAiFinishReason(finishReason: string | null | undefined): string | null {
  switch (finishReason) {
    case 'stop':
      return 'end_turn'
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
    case 'function_call':
      return 'tool_use'
    case 'content_filter':
      return 'end_turn'
    default:
      return finishReason ?? null
  }
}
