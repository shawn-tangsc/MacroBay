import { describe, expect, it } from 'vitest'

import { credentialPayload } from './credentialFieldsModel'

/**
 * 凭据载荷的唯一判据：**字段清单来自描述符**，界面不按平台写 if。
 *
 * 曾经的故障：弹层只有一个写死的 `bot_token` 输入框，Slack（两把 token）、QQ 与飞书（两组凭据）
 * 在界面上根本没有入口——读者能建频道却填不了凭据。
 */
describe('credential payload', () => {
  it('carries every filled field when creating, so Slack posts both tokens', () => {
    const { payload, missing } = credentialPayload(
      ['bot_token', 'app_token'],
      { bot_token: 'xoxb-1', app_token: 'xapp-1' },
      'create'
    )
    expect(payload).toEqual({ bot_token: 'xoxb-1', app_token: 'xapp-1' })
    expect(missing).toEqual([])
  })

  it('names the fields that are still empty when creating', () => {
    const { payload, missing } = credentialPayload(['bot_token', 'app_token'], { bot_token: 'xoxb-1' }, 'create')
    // 只填一个字段也要把两个键交齐：缺的那个必须被点名，而不是悄悄少一个键。
    expect(missing).toEqual(['app_token'])
    expect(payload).toEqual({ bot_token: 'xoxb-1' })
  })

  it('sends only the fields the reader typed when rotating, so the rest stay as they are', () => {
    const { payload, missing } = credentialPayload(
      ['bot_token', 'app_token'],
      { app_token: 'xapp-2', bot_token: '   ' },
      'edit'
    )
    // 留空（含只有空白）＝不修改：载荷里不出现这个键，服务端据此保留原值。
    expect(payload).toEqual({ app_token: 'xapp-2' })
    expect(missing).toEqual([])
  })

  it('keeps the descriptor order for app_id style platforms', () => {
    const { payload } = credentialPayload(['app_id', 'client_secret'], { app_id: '1020', client_secret: 's' }, 'create')
    expect(Object.keys(payload)).toEqual(['app_id', 'client_secret'])
  })
})
