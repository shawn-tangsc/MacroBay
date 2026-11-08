import { describe, expect, it } from 'vitest'

import { SEND_ACTION_READY, readSendReceipt } from './analysisConclusionSendClient'

/**
 * 回执解析的两条规矩：
 * 1. **认不出形状就报错**——不猜成成功，也不猜成某一种失败；
 * 2. **投递结果就在回执里**（`delivery.push` / `delivery.suppressed`），不再去读一次记录；
 *    没带就是「这次没有投递」，那是「只在应用内」，不是「已发到」。
 */
/**
 * 放行开关：**回执里还没有 `delivery` 时按钮不摆**。频道线把 `accepted.delivery` 落进契约后，
 * 这一条会跟着 `SEND_ACTION_READY` 一起要改——那时按钮才允许出现。
 */
describe('the send action gate', () => {
  it('stays hidden until the receipt carries the delivery result', () => {
    expect(SEND_ACTION_READY).toBe(false)
  })
})

describe('reading the send receipt', () => {
  it('keeps the delivery the platform reported for this submit', () => {
    expect(readSendReceipt({ kind: 'accepted', recordId: 'n-1', delivery: { push: { state: 'sent-accepted', channelName: 'Telegram' } } }))
      .toEqual({ kind: 'accepted', delivery: { push: { state: 'sent-accepted', channelName: 'Telegram' } } })
    // 「没拿到回执」也是一档，原样带过来，界面负责说得准。
    expect(readSendReceipt({ kind: 'accepted', delivery: { push: { state: 'sent-unconfirmed' } } }))
      .toEqual({ kind: 'accepted', delivery: { push: { state: 'sent-unconfirmed' } } })
  })

  it('keeps the suppression reason, and ignores a reason the closed set does not have', () => {
    expect(readSendReceipt({ kind: 'accepted', delivery: { suppressed: [{ level: 'channel', reason: 'quiet-hours' }] } }))
      .toEqual({ kind: 'accepted', delivery: { suppressed: [{ level: 'channel', reason: 'quiet-hours' }] } })
    // 认不出的码不当成某一种原因：整条压下信息丢掉，于是判成「没排上」，绝不当成功。
    expect(readSendReceipt({ kind: 'accepted', delivery: { suppressed: [{ level: 'channel', reason: 'brand-new-reason' }] } }))
      .toEqual({ kind: 'accepted' })
  })

  it('treats an accepted submit without a delivery result as "no delivery this time"', () => {
    expect(readSendReceipt({ kind: 'accepted', recordId: 'n-1' })).toEqual({ kind: 'accepted' })
    // merged 只在真升级时带投递结果；不带就是没有这次投递。
    expect(readSendReceipt({ kind: 'merged', recordId: 'n-1', occurrenceCount: 2 })).toEqual({ kind: 'accepted' })
    expect(readSendReceipt({ kind: 'merged', recordId: 'n-1', delivery: { push: { state: 'failed', reason: 'push-unavailable' } } }))
      .toEqual({ kind: 'accepted', delivery: { push: { state: 'failed', reason: 'push-unavailable' } } })
  })

  it('hands a rejection reason through untouched', () => {
    expect(readSendReceipt({ kind: 'rejected', reason: 'daily-limit-reached' }))
      .toEqual({ kind: 'rejected', reason: 'daily-limit-reached' })
  })

  it('refuses a receipt it cannot read, rather than calling it a success', () => {
    for (const value of [undefined, null, 'ok', {}, { kind: 'rejected' }, { kind: 'collapsed' }]) {
      expect(() => readSendReceipt(value)).toThrow('analysis-conclusion-send-unreadable')
    }
  })
})
