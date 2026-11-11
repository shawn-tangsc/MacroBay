import { describe, expect, it } from 'vitest'

import { normalizeDiscordEvent } from './DiscordUpdateNormalizer'
import { readDiscordMessageCreate, type DiscordMessageSeam } from './DiscordGatewayDispatch'

/**
 * 网关推来的 `MESSAGE_CREATE` 不是「已经整理好的事实」，它是 Discord 自己的形状：
 * `{ id, channel_id, guild_id, content, author: { id, bot }, mentions: [...], attachments: [...] }`。
 * 这一层只做一件事：把它压成 `normalizeDiscordEvent` 认识的那几个字段，**别的一概不往 C03 带**。
 *
 * 判据（协议依据：Discord Developers › Docs › Resources › Message › Message Object）：
 * - 去重键来自**事件本身**（`message.id`），不是「时间 + 内容」；
 * - 机器人自己发的消息（`author.bot === true`）不进来，否则它会回自己的话；
 * - 群/频道消息的会话键用 `channel_id`，私信用 `author.id`（私信没有 guild）；
 * - 附件只留 id / mime / 名字 / 大小，URL 一律丢掉。
 */

const TOKEN = 'discord-bot-token-secret'

describe('discord message_create mapping', () => {
  it('maps a guild message into the bounded seam, keyed by the message id itself', () => {
    const seam = readDiscordMessageCreate({
      id: '111',
      channel_id: '222',
      guild_id: '333',
      content: 'hello',
      author: { id: '444', bot: false },
      mentions: [{ id: '999' }]
    }, '999')

    expect(seam.kind).toBe('message')
    expect((seam as { seam: DiscordMessageSeam }).seam).toEqual({
      id: '111',
      author_id: '444',
      conversation_id: '222',
      kind: 'guild',
      content: 'hello',
      mentioned_bot: true
    } satisfies DiscordMessageSeam)
    // 供下一步去重：键来自 message.id，与内容、时间无关。
    expect(normalizeDiscordEvent((seam as { seam: DiscordMessageSeam }).seam)?.eventKey).toBe('discord:event:111')
  })

  it('keys a direct message by the author and always counts it as mentioned', () => {
    const read = readDiscordMessageCreate({ id: '111', channel_id: '222', content: 'hi', author: { id: '444' } }, '999')
    expect(read).toMatchObject({ kind: 'message', seam: { conversation_id: '444', kind: 'direct' } })
    expect(normalizeDiscordEvent((read as { seam: DiscordMessageSeam }).seam)).toMatchObject({
      conversationKey: 'discord:conversation:direct:444',
      mentionedBot: true
    })
  })

  it('keeps only the attachment facts and drops every provider URL', () => {
    const seam = readDiscordMessageCreate({
      id: '111',
      channel_id: '222',
      guild_id: '333',
      author: { id: '444' },
      content: '',
      attachments: [
        { id: 'att-1', content_type: 'image/png', size: 10, filename: 'a.png', url: 'https://cdn.discordapp.com/secret' },
        { id: 'att-2', content_type: 'application/pdf', size: 20, filename: 'b.pdf', url: 'https://cdn.discordapp.com/secret' }
      ]
    }, null)

    const fact = normalizeDiscordEvent((seam as { seam: DiscordMessageSeam }).seam)
    expect(fact?.attachments).toEqual([
      { kind: 'image', stableRef: 'discord:file:att-1', mimeType: 'image/png', name: 'a.png', sizeBytes: 10 },
      { kind: 'file', stableRef: 'discord:file:att-2', mimeType: 'application/pdf', name: 'b.pdf', sizeBytes: 20 }
    ])
    expect(JSON.stringify(fact)).not.toContain('https://')
  })

  it('tells its own echo apart from another bot', () => {
    // 自己发出去又被回显的那条：不投递，但它是出站通路的证据，必须与「别的机器人」分开。
    expect(readDiscordMessageCreate({ id: '111', channel_id: '222', author: { id: '999', bot: true } }, '999'))
      .toEqual({ kind: 'self-echo', messageId: '111', channelId: '222' })
    expect(readDiscordMessageCreate({ id: '112', channel_id: '222', author: { id: '444', bot: true } }, '999').kind).toBe('ignored')
  })

  it('refuses a payload without a usable message id or author', () => {
    for (const value of [
      null,
      'text',
      [],
      { channel_id: '222', author: { id: '444' } },
      { id: 'bad id!', channel_id: '222', author: { id: '444' } },
      { id: '111', channel_id: '222' },
      { id: '111', channel_id: '', author: { id: '444' } }
    ]) {
      expect(readDiscordMessageCreate(value, null).kind, JSON.stringify(value)).toBe('invalid')
    }
  })

  it('never carries the token or the raw payload forward', () => {
    const raw = {
      id: '111',
      channel_id: '222',
      guild_id: '333',
      content: `token ${TOKEN}`,
      author: { id: '444' },
      mentions: [],
      _raw_provider_blob: 'x'.repeat(50)
    }
    const read = readDiscordMessageCreate(raw, null)
    expect(read.kind).toBe('message')
    const seam = (read as { seam: DiscordMessageSeam }).seam
    // 内容本身是用户打的字，照传；但结构里不该出现原始 blob——只留白名单字段。
    expect(Object.keys(seam).sort()).toEqual(['author_id', 'content', 'conversation_id', 'id', 'kind', 'mentioned_bot'])
    expect(JSON.stringify(seam)).not.toContain('_raw_provider_blob')
  })
})
