import { describe, expect, it } from 'vitest'

import { createSystemProviderPresets } from './providerPresets'
import { normalizeProviderState } from './providerStore'

/** PLAT-62：老数据里 wan/image 模型可能还是 chat=true，加载时应按 id 纠正。 */
function legacyState(models: unknown[]): unknown {
  return {
    providers: [{
      id: 'legacy-provider',
      name: 'Legacy',
      protocol: 'openai',
      enabled: true,
      baseUrl: 'https://example.test',
      models
    }]
  }
}

describe('PLAT-62 legacy capability normalization', () => {
  it('re-infers non-chat ids when the user never edited capabilities', () => {
    const state = normalizeProviderState(legacyState([
      { id: 'wan2.7-image', name: 'Wan Image', capabilities: { chat: true } },
      { id: 'wan2.7-i2v', name: 'Wan I2V', capabilities: { chat: true } },
      { id: 'hpappy-horse-1.0-t2v', name: 'Horse T2V', capabilities: { chat: true } }
    ]))

    expect(state.providers[0].name).toBe('Legacy')
    expect(createSystemProviderPresets().find((provider) => provider.id === 'silicon')?.name).toBe('Silicon')
    const models = state.providers[0].models
    expect(models[0].capabilities).toMatchObject({ chat: false, imageGeneration: true })
    expect(models[1].capabilities).toMatchObject({ chat: false, videoGeneration: true })
    expect(models[2].capabilities).toMatchObject({ chat: false, videoGeneration: true })
  })

  it('does not overwrite capabilities the user edited', () => {
    const state = normalizeProviderState(legacyState([
      {
        id: 'wan2.7-image',
        name: 'Wan Image',
        capabilities: { chat: true, capabilitiesEdited: true }
      }
    ]))

    expect(state.providers[0].models[0].capabilities.chat).toBe(true)
  })
})
