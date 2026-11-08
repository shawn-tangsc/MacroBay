import { describe, expect, it } from 'vitest'

import { readSendReceipt } from './analysisConclusionSendClient'

/**
 * 回执解析只有一条规矩：**认不出形状就报错，不许猜成成功、也不许猜成某一种失败**。
 * 猜成成功会让界面在没发出去的时候说「已发出」；猜成失败会把「没配通道」和「今天到上限」混成一句。
 */
describe('reading the send receipt', () => {
  it('keeps an accepted record and its levels', () => {
    expect(readSendReceipt({ kind: 'accepted', recordId: 'n-1', levels: ['center', 'channel'] }))
      .toEqual({ kind: 'accepted', recordId: 'n-1', levels: ['center', 'channel'] })
  })

  it('drops levels it cannot read instead of guessing them', () => {
    expect(readSendReceipt({ kind: 'accepted', recordId: 'n-1', levels: ['center', 7] }))
      .toEqual({ kind: 'accepted', recordId: 'n-1', levels: ['center'] })
    expect(readSendReceipt({ kind: 'accepted', recordId: 'n-1' }))
      .toEqual({ kind: 'accepted', recordId: 'n-1', levels: [] })
  })

  it('hands a rejection reason through untouched', () => {
    expect(readSendReceipt({ kind: 'rejected', reason: 'daily-limit-reached' }))
      .toEqual({ kind: 'rejected', reason: 'daily-limit-reached' })
  })

  it('refuses a receipt it cannot read, rather than calling it a success', () => {
    for (const value of [undefined, null, 'ok', {}, { kind: 'accepted' }, { kind: 'rejected' }]) {
      expect(() => readSendReceipt(value)).toThrow('analysis-conclusion-send-unreadable')
    }
  })
})
