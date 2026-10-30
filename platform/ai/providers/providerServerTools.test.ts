import { describe, expect, it } from 'vitest'

import {
  ANTHROPIC_SERVER_WEB_TOOL_NAMES,
  isAnthropicServerWebToolName,
  isOfficialAnthropicMessagesBase,
  supportsAnthropicServerWebSearch
} from './providerServerTools'

function provider(id: string, messagesBaseUrl?: string) {
  return {
    id,
    endpoints: [
      ...(messagesBaseUrl ? [{ protocol: 'messages' as const, baseUrl: messagesBaseUrl }] : []),
      { protocol: 'chat-completions' as const, baseUrl: 'https://relay.example.com/v1' }
    ]
  }
}

describe('Anthropic server-side web search capability', () => {
  it('accepts the official Anthropic preset on the first-party endpoint', () => {
    expect(supportsAnthropicServerWebSearch(provider('anthropic', 'https://api.anthropic.com'))).toBe(true)
    expect(supportsAnthropicServerWebSearch(provider('anthropic', 'https://api.anthropic.com/v1'))).toBe(true)
  })

  it('rejects a third-party Anthropic-compatible relay that declares messages support', () => {
    expect(supportsAnthropicServerWebSearch(provider('tokenrhythm', 'https://tokenrhythm.studio'))).toBe(false)
  })

  it('fails closed when the official preset was pointed at another host', () => {
    expect(supportsAnthropicServerWebSearch(provider('anthropic', 'https://anthropic.proxy.test'))).toBe(false)
    expect(supportsAnthropicServerWebSearch(provider('anthropic', 'https://api.anthropic.com.evil.test'))).toBe(false)
  })

  it('fails closed for custom providers even on the official host', () => {
    expect(supportsAnthropicServerWebSearch(provider('my-anthropic-proxy', 'https://api.anthropic.com'))).toBe(false)
  })

  it('fails closed without a messages endpoint', () => {
    expect(supportsAnthropicServerWebSearch(provider('anthropic'))).toBe(false)
  })

  it('requires https and a bare official path', () => {
    expect(isOfficialAnthropicMessagesBase('http://api.anthropic.com')).toBe(false)
    expect(isOfficialAnthropicMessagesBase('https://api.anthropic.com:8443')).toBe(false)
    expect(isOfficialAnthropicMessagesBase('https://api.anthropic.com/proxy')).toBe(false)
    expect(isOfficialAnthropicMessagesBase('https://api.anthropic.com/v1')).toBe(true)
    expect(isOfficialAnthropicMessagesBase(undefined)).toBe(false)
  })

  it('names exactly the two gated Claude Code built-in tools', () => {
    expect(ANTHROPIC_SERVER_WEB_TOOL_NAMES).toEqual(['WebSearch', 'WebFetch'])
    expect(isAnthropicServerWebToolName('WebSearch')).toBe(true)
    expect(isAnthropicServerWebToolName('WebFetch')).toBe(true)
    expect(isAnthropicServerWebToolName('Read')).toBe(false)
    expect(isAnthropicServerWebToolName('web_search')).toBe(false)
  })
})
