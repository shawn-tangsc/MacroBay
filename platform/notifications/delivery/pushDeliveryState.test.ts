import { describe, expect, it } from 'vitest'

import { pushDeliveryState } from './pushDeliveryState'

/**
 * 一次推送结果 → 记录上的投递状态：**唯一**一张表（2026-11-08）。
 *
 * 这张表存在的理由就是它只有一份：以前新提交路径与手动重投各写一份，
 * `unknown-after-send` 在一边是 `failed`、在另一边是 `sent-unconfirmed`——同一件事两种说法。
 */
describe('push delivery state', () => {
  it('maps an accepted push with a receipt to sent-accepted', () => {
    expect(pushDeliveryState({ ok: true, messageId: 'm-1' })).toEqual({ state: 'sent-accepted' })
  })

  it('maps an accepted push without a receipt to sent-unconfirmed, not to success', () => {
    expect(pushDeliveryState({ ok: true })).toEqual({ state: 'sent-unconfirmed' })
  })

  it('maps unknown-after-send to sent-unconfirmed: "no receipt" is not "not delivered"', () => {
    expect(pushDeliveryState({ ok: false, reason: 'unknown-after-send' })).toEqual({
      state: 'sent-unconfirmed',
      reason: 'unknown-after-send'
    })
  })

  it('maps a channel rejection to failed with the reason, defaulting when the port gives none', () => {
    expect(pushDeliveryState({ ok: false, reason: 'channel-rejected' })).toEqual({
      state: 'failed',
      reason: 'channel-rejected'
    })
    expect(pushDeliveryState({ ok: false })).toEqual({ state: 'failed', reason: 'channel-rejected' })
  })
})
