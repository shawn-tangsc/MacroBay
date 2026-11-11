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

  it('accepts the opaque ids QQ actually sends, dots and equals included', () => {
    // 现场：真 C2C 事件的消息 id 是 `ROBOT1.0_4L5m…`，白名单把点判成坏帧，消息全被丢掉。
    const dotted = readQqMessageCreate('C2C_MESSAGE_CREATE', {
      id: 'ROBOT1.0_4L5mAbC-dEf=',
      content: '测试',
      author: { id: 'robot-1', user_openid: 'B1C4D2E3F4A5' }
    })
    expect(dotted.kind).toBe('message')
    if (dotted.kind !== 'message') throw new Error('unreachable')
    expect(dotted.seam.kind).toBe('direct')
    expect(dotted.seam.id).toBe('ROBOT1.0_4L5mAbC-dEf=')
    expect(dotted.seam.conversation_id).toBe('B1C4D2E3F4A5')

    // 群与频道同样可能带点/等号：同一份有界判据覆盖，不按事件类型各写一套。
    const group = readQqMessageCreate('GROUP_AT_MESSAGE_CREATE', {
      id: 'GROUP.1_abc', group_openid: 'G.1=x', content: 'hi', author: { member_openid: 'M.1' }
    })
    expect(group.kind).toBe('message')
    const channel = readQqMessageCreate('AT_MESSAGE_CREATE', {
      id: 'AT.1_abc', channel_id: 'C.1==', content: 'hi', author: { id: 'U.1' }
    })
    expect(channel.kind).toBe('message')
  })

  it('still refuses control characters and over-long ids, and names the field', () => {
    // 放宽的是「字符集」，不是「有没有界」：控制字符与超长仍然拒绝，并且说出是哪一项。
    const controlId = readQqMessageCreate('C2C_MESSAGE_CREATE', {
      id: 'bad\u0000id', content: 'x', author: { user_openid: 'u1' }
    })
    expect(controlId).toEqual({ kind: 'invalid', field: 'id' })
    const longId = readQqMessageCreate('C2C_MESSAGE_CREATE', {
      id: 'x'.repeat(257), content: 'x', author: { user_openid: 'u1' }
    })
    expect(longId).toEqual({ kind: 'invalid', field: 'id' })
    const noAuthor = readQqMessageCreate('C2C_MESSAGE_CREATE', { id: 'msg-1', content: 'x' })
    expect(noAuthor).toEqual({ kind: 'invalid', field: 'author' })
    const noConversation = readQqMessageCreate('AT_MESSAGE_CREATE', { id: 'msg-1', author: { id: 'u1' } })
    expect(noConversation).toEqual({ kind: 'invalid', field: 'conversation' })
  })

  it('ignores other bots and refuses payloads without a usable id', () => {
    expect(readQqMessageCreate('GROUP_AT_MESSAGE_CREATE', {
      id: 'msg-5', group_openid: 'group-1', author: { member_openid: 'm', bot: true }
    }).kind).toBe('ignored')

    for (const value of [
      null, 'text', [],
      { group_openid: 'g', author: {} },
      // 不透明 id 现在允许点/叹号（QQ 真 id 就长这样），但控制字符与超长仍然不许。
      { id: 'bad\u0000id', group_openid: 'g', author: { member_openid: 'm' } },
      { id: 'x'.repeat(257), group_openid: 'g', author: { member_openid: 'm' } },
      { id: 'msg-1', group_openid: 'bad\u0001group', author: { member_openid: 'm' } }
    ]) {
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
