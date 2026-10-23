import { describe, expect, it } from 'vitest'

import type { SafeModelProvider } from '@platform/ai/providers/modelProviderTypes'

import { createConnectionCheckApiKeyOptions, selectDefaultConnectionCheckModelId } from './modelProviderConnectionCheck'

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
  models: [
    {
      id: 'embedding-model',
      name: 'Embedding Model',
      capabilities: { chat: false, vision: false, embedding: true, tools: false }
    },
    {
      id: 'chat-model',
      name: 'Chat Model',
      capabilities: { chat: true, vision: false, embedding: false, tools: true }
    }
  ],
  defaultChatModelId: 'chat-model',
  hasApiKey: true,
  apiKeyPreview: 'sk-s**********aved'
}

describe('model provider connection check view model', () => {
  it('turns a comma separated draft API key into selectable raw key options', () => {
    expect(createConnectionCheckApiKeyOptions(provider, ' sk-first-live , sk-second-token ')).toEqual([
      { id: 'draft-0', label: 'sk-f**********live', apiKey: 'sk-first-live' },
      { id: 'draft-1', label: 'sk-s**********oken', apiKey: 'sk-second-token' }
    ])
  })

  it('falls back to the saved masked API key without exposing the raw secret to the renderer', () => {
    expect(createConnectionCheckApiKeyOptions(provider, '')).toEqual([
      { id: 'saved', label: 'sk-s**********aved' }
    ])
  })

  it('selects the default chat model and ignores non-chat models', () => {
    expect(selectDefaultConnectionCheckModelId(provider)).toBe('chat-model')
    expect(selectDefaultConnectionCheckModelId({ ...provider, defaultChatModelId: 'embedding-model' })).toBe('chat-model')
    expect(selectDefaultConnectionCheckModelId({ ...provider, models: [] })).toBe('')
  })
})
