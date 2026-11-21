import { describe, expect, it } from 'vitest'

import { channelAttachmentTurnText } from './channelAttachmentTurnText'

const image = (overrides: Partial<{ kind: 'image' | 'file'; stableRef: string; name: string | null; mimeType: string; sizeBytes: number | null }> = {}) => ({
  kind: 'image' as const,
  stableRef: 'qq:file:stable-1',
  name: null,
  mimeType: 'image/png',
  sizeBytes: 1024,
  ...overrides
})

/**
 * 「只带图、没有配文」那一句（0.4.5 缺陷）：助手那一轮不能是空的，而且要说清收到了什么、
 * 带上可核对的稳定引用。两条语言各一套，读者看得懂哪句都行，但**不许只有一句「收到」而没有引用**。
 */
describe('the turn text for an attachment-only channel message', () => {
  it('says an image arrived with no text, and carries the stable reference', () => {
    const zh = channelAttachmentTurnText('zh-CN', [image()])
    expect(zh.split('\n')[0]).toBe('收到一张图片，没有文字。')
    expect(zh).toContain('qq:file:stable-1')

    const en = channelAttachmentTurnText('en-US', [image()])
    expect(en.split('\n')[0]).toBe('An image arrived, with no text.')
    expect(en).toContain('qq:file:stable-1')
  })

  it('counts several attachments and names a file by its own name when it has one', () => {
    const zh = channelAttachmentTurnText('zh-CN', [
      image(),
      image({ kind: 'file', stableRef: 'qq:file:doc-9', name: '报表.pdf', mimeType: 'application/pdf', sizeBytes: null })
    ])
    expect(zh.split('\n')[0]).toBe('收到 2 个附件，没有文字。')
    expect(zh).toContain('报表.pdf')
    expect(zh).toContain('qq:file:doc-9')
  })

  it('never returns an empty line-up for an empty list (the caller keeps its own behaviour there)', () => {
    expect(channelAttachmentTurnText('zh-CN', [])).toBe('')
  })
})