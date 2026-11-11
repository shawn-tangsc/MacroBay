import { describe, expect, it, vi } from 'vitest'

import { LarkDeliveryTransport } from './LarkDeliveryTransport'

/**
 * 助手产出的是 markdown，飞书文本消息不渲染它：`**`、`#`、行首 `-` 会原样出现在读者手机上。
 * 投递层必须把控制符号转成纯文本，且**正文一字不丢**（不是截断、不是整段删）。
 */
const assistantReply = [
  '## 今日解读',
  '- **解读行情事件**：某条新闻对 BTC 的影响路径',
  '- **梳理多空证据**：区分**已确认事实**与推测',
  '__加粗__ 与普通文字混排'
].join('\n')

function harness() {
  const sendText = vi.fn(async (_conversation: unknown, _text: string) => ({ ok: true as const }))
  const transport = new LarkDeliveryTransport()
  transport.setClient('channel-1', { sendText } as never, {
    isCurrent: () => true,
    signal: new AbortController().signal
  })
  return { transport, sendText }
}

describe('lark delivery text', () => {
  it('sends no markdown control symbols and keeps every word', async () => {
    const { transport, sendText } = harness()
    await expect(transport.send({
      channelId: 'channel-1',
      providerConversationKey: 'lark:conversation:chat:oc_1',
      text: assistantReply,
      idempotencyKey: 'k1'
    })).resolves.toEqual({ kind: 'delivered' })

    const sent = String(sendText.mock.calls[0]?.[1] ?? '')
    expect(sent).not.toContain('**')
    expect(sent).not.toContain('__')
    expect(sent).not.toMatch(/^#/mu)
    expect(sent).not.toMatch(/^\s*-\s/u)

    // 一字不丢：把原文的标记去掉后，内容必须还在。
    for (const fragment of ['今日解读', '解读行情事件', '某条新闻对 BTC 的影响路径', '梳理多空证据',
      '区分已确认事实与推测', '加粗', '与普通文字混排']) {
      expect(sent).toContain(fragment)
    }
  })
})
