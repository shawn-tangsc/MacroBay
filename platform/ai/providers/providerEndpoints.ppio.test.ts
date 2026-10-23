import { describe, expect, it } from 'vitest'

import { createSystemProviderPresets } from './providerPresets'
import { buildChatCompletionsUrl, buildMessagesUrl, buildResponsesUrl } from './providerEndpoints'

/**
 * PPIO 的 base 前缀里已经带 `/v3/`，版本段探测会认为"已有版本"而不再补 `/v1`。
 * 三个派生地址必须逐字钉住，否则很容易派生出 `/v3/anthropic/messages` 这种错地址。
 */
describe('PPIO endpoint URLs', () => {
  it('derives the three protocol URLs exactly', () => {
    const preset = createSystemProviderPresets().find((entry) => entry.id === 'ppio')!
    const baseOf = (protocol: string): string =>
      preset.endpoints.find((endpoint) => endpoint.protocol === protocol)!.baseUrl
    expect(buildChatCompletionsUrl(baseOf('chat-completions'))).toBe('https://api.ppio.com/openai/v1/chat/completions')
    expect(buildResponsesUrl(baseOf('responses'))).toBe('https://api.ppio.com/openai/v1/responses')
    expect(buildMessagesUrl(baseOf('messages'))).toBe('https://api.ppio.com/anthropic/v1/messages')
  })
})
