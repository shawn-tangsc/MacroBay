import { describe, expect, it } from 'vitest'

import { resolveModelListShape } from './modelListShapes'
import { normalizeRemoteModels } from './remoteModelNormalize'

const chatEndpoints = [{ protocol: 'chat-completions' as const, baseUrl: 'https://example.com' }]

describe('价格展示精度（按厂商形状声明，不按 providerId 判断）', () => {
  it('OpenRouter 声明 4 位，0.049 不会被抹成 0', () => {
    const model = normalizeRemoteModels(
      [{ id: 'deepseek/deepseek-v4.1-flash', pricing: { prompt: '0.000000049', completion: '0.000000375' } }],
      resolveModelListShape({ id: 'openrouter', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions' }
    )[0]!
    expect(model.pricing).toMatchObject({ promptPerMillion: 0.049, completionPerMillion: 0.375, displayPrecision: 4 })
  })

  it('没有声明的厂商保持缺省（不写 displayPrecision）', () => {
    const model = normalizeRemoteModels(
      [{ id: 'gpt-4o', pricing: { prompt: '2.5', completion: '10' } }],
      resolveModelListShape({ id: 'openai', endpoints: chatEndpoints }),
      { providerDefaultProtocol: 'chat-completions' }
    )[0]!
    expect(model.pricing?.displayPrecision).toBeUndefined()
    expect(model.pricing).toMatchObject({ promptPerMillion: 2.5, completionPerMillion: 10 })
  })
})
