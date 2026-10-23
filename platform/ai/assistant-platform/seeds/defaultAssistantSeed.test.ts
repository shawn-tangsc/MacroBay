import { describe, expect, it } from 'vitest'

import {
  buildDefaultAssistantLocalizationPatch,
  createDefaultAssistantSeed
} from './defaultAssistantSeed'

describe('createDefaultAssistantSeed', () => {
  it('localizes the built-in assistant copy for Chinese workspaces', () => {
    const seed = createDefaultAssistantSeed({ language: 'zh-CN' })

    expect(seed.name).toBe('默认助手')
    expect(seed.prompt).toContain('乐于助人')
    expect(seed.description).toContain('普通聊天')
  })

  it('produces a localization patch for persisted built-in default assistants from another language', () => {
    const englishSeed = createDefaultAssistantSeed({ language: 'en-US' })

    expect(buildDefaultAssistantLocalizationPatch(englishSeed, 'zh-CN')).toEqual({
      name: '默认助手',
      prompt: '你是一个乐于助人的助手。',
      description: '平台默认普通聊天助手。'
    })
  })

  it('does not overwrite user-customized default assistant copy', () => {
    const customized = {
      ...createDefaultAssistantSeed({ language: 'en-US' }),
      prompt: 'Custom system prompt.'
    }

    expect(buildDefaultAssistantLocalizationPatch(customized, 'zh-CN')).toBeNull()
  })
})
