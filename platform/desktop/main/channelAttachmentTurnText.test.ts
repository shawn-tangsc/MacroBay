import { describe, expect, it } from 'vitest'

import { channelAttachmentOnlyTurn } from './channelAttachmentTurnText'

const image = (overrides: Partial<{ kind: 'image' | 'file'; stableRef: string; name: string | null; mimeType: string; sizeBytes: number | null }> = {}) => ({
  kind: 'image' as const,
  stableRef: 'qq:file:stable-1',
  name: null,
  mimeType: 'image/png',
  sizeBytes: 1024,
  ...overrides
})

/**
 * 「只带图、没有配文」那一轮（0.4.5 缺陷）：气泡与模型拿到的东西**必须分开**。
 *
 * - 气泡里只描述发生了什么：`收到 1 张图片，没有文字。`——不许替读者表态（那会读成读者在说
 *   「我看不到内容」），所以能力边界一个词都不许出现在这一句里；
 * - 模型拿到的 `text` 里才有引用与那条约束：只有引用、没有画面时只确认收到、不许描述或猜测画面。
 *
 * 数字形式是刻意的：单条「收到 1 张图片」与多条「收到 3 个附件」同一个句式。
 */
describe('the turn an attachment-only channel message produces', () => {
  it('keeps the reader bubble to what happened, with no capability claim in it', () => {
    const zh = channelAttachmentOnlyTurn('zh-CN', [image()])
    expect(zh.displayText).toBe('收到 1 张图片，没有文字。')
    // 气泡里不许出现这些词：它们等于让读者替我们表态。
    for (const claim of ['看不到', '读不到', '这一版', '附件引用']) {
      expect(zh.displayText).not.toContain(claim)
    }
    expect(zh.displayText).not.toContain('qq:file:')
    expect(channelAttachmentOnlyTurn('en-US', [image()]).displayText).toBe('Received 1 image, with no text.')
  })

  it('counts several attachments in the same numeric voice', () => {
    const zh = channelAttachmentOnlyTurn('zh-CN', [
      image(),
      image({ kind: 'file', stableRef: 'qq:file:doc-9', name: '报表.pdf', mimeType: 'application/pdf', sizeBytes: null })
    ])
    expect(zh.displayText).toBe('收到 2 个附件，没有文字。')
  })

  it('gives the model the references and the rule that forbid guessing the picture', () => {
    const zh = channelAttachmentOnlyTurn('zh-CN', [image()])
    expect(zh.text.startsWith(zh.displayText)).toBe(true)
    expect(zh.text).toContain('qq:file:stable-1')
    // 要求写在这里（进提示词，不是句式守卫）：只确认收到、说明读不到内容、不许描述或猜测画面。
    expect(zh.text).toContain('Acknowledge receipt')
    expect(zh.text).toContain('cannot be read')
    expect(zh.text).toContain('Do not describe or guess')
  })
})