import { describe, expect, it } from 'vitest'

import { normalizeQqEvent } from './QqUpdateNormalizer'
import { isQqMessageEvent, readQqMessageCreate, type QqMessageSeam } from './QqGatewayDispatch'

/**
 * QQ 三种消息事件的归一：群 @、单聊、频道 @。判据与 Discord 那层同形——
 * 去重键来自消息 id、别的机器人不回、附件只留 mime/名字/大小且**不带 URL**。
 */

describe('qq message event mapping', () => {
  it('maps a group @ message by its group openid', () => {
    const read = readQqMessageCreate('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-1',
      content: 'hello',
      group_openid: 'group-1',
      author: { id: 'u-1', member_openid: 'member-1' }
    })
    expect(read).toEqual({
      kind: 'message',
      seam: {
        id: 'msg-1',
        author_id: 'member-1',
        conversation_id: 'group-1',
        kind: 'group',
        content: 'hello',
        mentioned_bot: true
      }
    })
    expect(normalizeQqEvent((read as { seam: QqMessageSeam }).seam)?.eventKey).toBe('qq:event:msg-1')
  })

  it('maps a direct message to the author as the conversation', () => {
    const read = readQqMessageCreate('C2C_MESSAGE_CREATE', {
      id: 'msg-2',
      content: 'hi',
      author: { user_openid: 'user-9' }
    })
    expect(read).toMatchObject({ kind: 'message', seam: { conversation_id: 'user-9', kind: 'direct', mentioned_bot: true } })
  })

  it('maps a guild channel message by channel id', () => {
    const read = readQqMessageCreate('AT_MESSAGE_CREATE', {
      id: 'msg-3',
      content: 'hi',
      channel_id: 'chan-1',
      guild_id: 'guild-1',
      author: { id: 'u-3' }
    })
    expect(read).toMatchObject({ kind: 'message', seam: { conversation_id: 'chan-1', kind: 'channel' } })
  })

  it('keeps attachment facts and drops every provider URL', () => {
    const read = readQqMessageCreate('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-4',
      content: '',
      group_openid: 'group-1',
      author: { member_openid: 'member-1' },
      attachments: [
        { content_type: 'image/png', filename: 'a.png', size: 12, url: 'https://multimedia.nt.qq.com.cn/secret' },
        { content_type: 'application/pdf', filename: 'b.pdf', url: 'https://multimedia.nt.qq.com.cn/secret' }
      ]
    })
    const fact = normalizeQqEvent((read as { seam: QqMessageSeam }).seam)
    expect(fact?.attachments).toEqual([
      { kind: 'image', stableRef: 'qq:file:msg-4_0', mimeType: 'image/png', name: 'a.png', sizeBytes: 12 },
      { kind: 'file', stableRef: 'qq:file:msg-4_1', mimeType: 'application/pdf', name: 'b.pdf' }
    ])
    expect(JSON.stringify(fact)).not.toContain('https://')
  })

  it('ignores other bots and refuses payloads without a usable id', () => {
    expect(readQqMessageCreate('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-5', group_openid: 'group-1', author: { member_openid: 'm', bot: true }
    }).kind).toBe('ignored')

    for (const value of [null, 'text', [], { group_openid: 'g', author: {} }, { id: 'bad id!', group_openid: 'g', author: { member_openid: 'm' } }]) {
      expect(readQqMessageCreate('GROUP_AT_MESSAGE_CREATE', value).kind, JSON.stringify(value)).toBe('invalid')
    }
  })

  it('knows which dispatch events carry a message', () => {
    for (const event of ['GROUP_AT_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE', 'AT_MESSAGE_CREATE']) {
      expect(isQqMessageEvent(event)).toBe(true)
    }
    for (const event of ['READY', 'GUILD_CREATE', 'GROUP_ADD_ROBOT', 'MESSAGE_CREATE']) {
      expect(isQqMessageEvent(event)).toBe(false)
    }
  })
})
