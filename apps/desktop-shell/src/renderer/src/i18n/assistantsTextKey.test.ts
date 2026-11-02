import { describe, expect, it } from 'vitest'

import { assistantsTextFor, resolveAssistantsText, type AssistantsTextPath } from './assistantsTextKey'

const zh = assistantsTextFor('zh-CN')
const en = assistantsTextFor('en-US')

describe('resolveAssistantsText', () => {
  it('resolves a path through the table instead of holding a second copy', () => {
    expect(resolveAssistantsText(zh, 'copyMessage')).toBe('复制消息')
    expect(resolveAssistantsText(zh, 'library.promptGenerate')).toBe('提示词生成稍后接入')
    expect(resolveAssistantsText(en, 'copyMessage')).toBe('Copy message')
  })

  it('returns an empty string for an unknown path, never the path itself', () => {
    const missing = 'nope.missing' as AssistantsTextPath
    expect(resolveAssistantsText(zh, missing)).toBe('')
    expect(resolveAssistantsText(zh, missing)).not.toContain('nope')
  })
})
