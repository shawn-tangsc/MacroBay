import { describe, expect, it } from 'vitest'

import {
  buildAnthropicMessageStartFrame,
  buildAnthropicTextDeltaFrame,
  formatAnthropicSseFrame,
  formatAnthropicSseFrames,
  mapOpenAiFinishReason
} from './anthropicSseMapper'

describe('anthropicSseMapper', () => {
  it('formats Anthropic-compatible SSE frames', () => {
    const frames = [
      buildAnthropicMessageStartFrame({ id: 'msg_1', model: 'deepseek-chat' }),
      buildAnthropicTextDeltaFrame(0, 'hi')
    ]

    const body = formatAnthropicSseFrames(frames)
    expect(body).toContain('event: message_start\n')
    expect(body).toContain('event: content_block_delta\n')
    expect(formatAnthropicSseFrame(frames[1]!)).toContain('"text":"hi"')
  })

  it('maps OpenAI finish reasons to Anthropic stop reasons', () => {
    expect(mapOpenAiFinishReason('stop')).toBe('end_turn')
    expect(mapOpenAiFinishReason('length')).toBe('max_tokens')
    expect(mapOpenAiFinishReason('tool_calls')).toBe('tool_use')
  })
})
