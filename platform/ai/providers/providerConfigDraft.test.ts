import { describe, expect, it } from 'vitest'

import type { SafeModelProvider } from './modelProviderTypes'
import {
  buildProviderInputFromDraft,
  isProviderDraftConnectionReady,
  isProviderDraftConnectionTestable
} from './providerConfigDraft'

const provider: SafeModelProvider = {
  id: 'silicon',
  name: 'Silicon',
  endpoints: [
    { protocol: 'chat-completions', baseUrl: 'https://api.siliconflow.cn' },
    { protocol: 'messages', baseUrl: 'https://api.siliconflow.cn' }
  ],
  enabled: true,
  baseUrl: 'https://api.siliconflow.cn',

  isSystem: true,
  websites: undefined,
  models: [],
  defaultChatModelId: undefined,
  hasApiKey: false,
  apiKeyPreview: ''
}

describe('provider config drafts', () => {
  it('treats the current API key draft as connection-ready before it has been persisted', () => {
    expect(isProviderDraftConnectionReady(provider, { enabled: true, apiKey: ' sk-live ' })).toBe(true)
  })

  it('falls back to a saved API key when the draft is empty', () => {
    expect(isProviderDraftConnectionReady({ ...provider, hasApiKey: true }, { enabled: true, apiKey: '' })).toBe(true)
  })

  it('allows a disabled provider draft to be tested without treating it as runtime-ready', () => {
    expect(isProviderDraftConnectionTestable(provider, { enabled: false, apiKey: 'fixture-draft-key-1234567890' })).toBe(true)
    expect(isProviderDraftConnectionReady(provider, { enabled: false, apiKey: 'fixture-draft-key-1234567890' })).toBe(false)
  })

  it('keeps API key undefined when the draft is empty so existing saved secrets are preserved', () => {
    expect(buildProviderInputFromDraft(provider, { enabled: true, apiKey: '' })).toMatchObject({
      id: 'silicon',
      enabled: true,
      apiKey: undefined
    })
  })

  it('does not save the masked API key preview as if it were a real secret', () => {
    expect(
      buildProviderInputFromDraft(
        { ...provider, hasApiKey: true, apiKeyPreview: 'sk-l**********test' },
        { enabled: true, apiKey: 'sk-l**********test' }
      )
    ).toMatchObject({
      id: 'silicon',
      enabled: true,
      apiKey: undefined
    })
  })

  it('includes the trimmed API key draft when saving or checking the provider', () => {
    expect(buildProviderInputFromDraft(provider, { enabled: true, apiKey: ' sk-live ' })).toMatchObject({
      id: 'silicon',
      enabled: true,
      apiKey: 'sk-live'
    })
  })
})
