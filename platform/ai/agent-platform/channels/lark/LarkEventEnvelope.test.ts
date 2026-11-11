import { describe, expect, it } from 'vitest'

import { readLarkMessageEvent, type LarkMessageSeam } from './LarkEventEnvelope'
import { toLongConnectionEvent, type LarkLongConnectionEvent } from './LarkLongConnectionClient'

/**
 * 飞书消息事件 → 有界形状。判据：去重键来自 header.event_id、自己发的不回、
 * 群里要有 @ 才算叫我、只留白名单字段（事件体里没有 URL 可留）。
 */

const TOKEN_TEXT = JSON.stringify({ text: 'hello' })

function event(payload: unknown, eventType = 'im.message.receive_v1'): LarkLongConnectionEvent {
  return { eventId: 'evt-1', eventType, payload }
}

describe('lark message event mapping', () => {
  it('maps a p2p text message, always counting it as mentioned', () => {
    const read = readLarkMessageEvent(event({
      schema: '2.0',
      header: { event_id: 'evt-1', event_type: 'im.message.receive_v1' },
      event: {
        sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
        message: { message_id: 'om_1', chat_id: 'oc_1', chat_type: 'p2p', message_type: 'text', content: TOKEN_TEXT }
      }
    }))
    expect(read).toEqual({
      kind: 'message',
      seam: {
        event_id: 'evt-1',
        message_id: 'om_1',
        chat_id: 'oc_1',
        chat_type: 'p2p',
        user_id: 'ou_1',
        mentioned_bot: true,
        text: 'hello'
      }
    })
  })

  it('only counts a group message as mentioned when it carries mentions', () => {
    const base = {
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
      message: { message_id: 'om_2', chat_id: 'oc_2', chat_type: 'group', message_type: 'text', content: TOKEN_TEXT }
    }
    expect((readLarkMessageEvent(event({ event: base })) as { seam: LarkMessageSeam }).seam.mentioned_bot).toBe(false)
    expect((readLarkMessageEvent(event({
      event: { ...base, message: { ...base.message, mentions: [{ key: '@_user_1', id: { open_id: 'ou_1' } }] } }
    })) as { seam: LarkMessageSeam }).seam.mentioned_bot).toBe(true)
  })

  it('ignores its own app messages and other event types', () => {
    const own = readLarkMessageEvent(event({
      event: {
        sender: { sender_type: 'app', sender_id: { open_id: 'ou_bot' } },
        message: { message_id: 'om_3', chat_id: 'oc_1', chat_type: 'p2p', message_type: 'text', content: TOKEN_TEXT }
      }
    }))
    expect(own.kind).toBe('ignored')
    expect(readLarkMessageEvent(event({}, 'im.chat.updated_v1')).kind).toBe('ignored')
  })

  it('keeps an image key as an attachment fact and never invents a url', () => {
    const read = readLarkMessageEvent(event({
      event: {
        sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
        message: {
          message_id: 'om_4',
          chat_id: 'oc_1',
          chat_type: 'group',
          message_type: 'image',
          content: JSON.stringify({ image_key: 'img_v2_abc' }),
          mentions: [{ key: '@_user_1' }]
        }
      }
    }))
    const seam = (read as { seam: LarkMessageSeam }).seam
    expect(seam.text).toBeUndefined()
    expect(seam.attachments).toEqual([{ kind: 'image', file_key: 'img_v2_abc', mime_type: 'image/*' }])
    expect(JSON.stringify(seam)).not.toContain('http')
  })

  it('reads the flattened schema-2.0 shape the SDK actually delivers', () => {
    // SDK 的 `RequestHandle.parse()` 把 `header` 与 `event` 摊平再交给 handler：
    // 真实到达的是 `{schema, event_id, event_type, sender, message}`，没有 header/event 两层。
    const flattened = {
      schema: '2.0',
      event_id: 'evt-flat-1',
      event_type: 'im.message.receive_v1',
      create_time: '1760000000000',
      token: 'v2-token',
      app_id: 'cli_x',
      tenant_key: 'tenant_x',
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
      message: { message_id: 'om_1', chat_id: 'oc_1', chat_type: 'p2p', message_type: 'text', content: '{"text":"你好"}' }
    }
    const event = toLongConnectionEvent(flattened)
    expect(event.eventId).toBe('evt-flat-1')
    expect(event.eventType).toBe('im.message.receive_v1')

    const read = readLarkMessageEvent(event)
    expect(read.kind).toBe('message')
    if (read.kind !== 'message') throw new Error('expected a message seam')
    expect(read.seam.chat_type).toBe('p2p')
    expect(read.seam.text).toBe('你好')
  })

  it('still refuses a flattened shape that has no event id', () => {
    const event = toLongConnectionEvent({
      schema: '2.0',
      event_type: 'im.message.receive_v1',
      sender: { sender_type: 'user', sender_id: { open_id: 'ou_1' } },
      message: { message_id: 'om_1', chat_id: 'oc_1', chat_type: 'p2p', message_type: 'text', content: '{"text":"你好"}' }
    })
    expect(event.eventId).toBe('')
    expect(readLarkMessageEvent(event).kind).toBe('invalid')
  })

  it('refuses a payload without a usable event id, chat id or sender', () => {
    for (const payload of [
      null,
      { event: { message: { chat_id: 'oc_1', chat_type: 'p2p' } } },
      { event: { sender: { sender_id: { open_id: 'ou_1' } }, message: { chat_id: 'oc_1', chat_type: 'p2p' } } }
    ]) {
      expect(readLarkMessageEvent({ eventId: '', eventType: 'im.message.receive_v1', payload }).kind).toBe('invalid')
    }
  })
})
