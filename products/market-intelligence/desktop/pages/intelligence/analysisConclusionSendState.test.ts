import { describe, expect, it } from 'vitest'

import { describeSendStatus } from './analysisConclusionSendCopy'
import { classifySendReceipt } from './analysisConclusionSendState'
import { analysisConclusionSendText } from './analysisConclusionSendText'

/**
 * 投递结果的判定与说法。
 *
 * 这张用例表就是「提交成功 ≠ 手机收到」的可执行版本：每条都从一个不同的回执形状出发，
 * 断言读者看到的那句话——**被免打扰压下不许说成发了、也不许说成「没发到手机」；
 * 上限不许说成发送失败；没接通要指路**。
 */
const zh = analysisConclusionSendText('zh-CN')
const time = '12:44'

describe('reading one send receipt', () => {
  it('says the channel accepted it, with the channel name and the time', () => {
    const state = classifySendReceipt({ kind: 'accepted', delivery: { push: { state: 'sent-accepted' } } })
    expect(state).toEqual({ state: 'sent' })
    // 通道名来自**这次提交的结果**（回执），不是点击前那份通道派生。
    expect(describeSendStatus({ state, text: zh, receiptChannelName: 'Telegram · 观潮', time }))
      .toEqual({ message: '已发到 Telegram · 观潮 · 12:44' })
  })

  it('does not dress "no receipt" up as delivered', () => {
    const state = classifySendReceipt({ kind: 'accepted', delivery: { push: { state: 'sent-unconfirmed' } } })
    expect(describeSendStatus({ state, text: zh, receiptChannelName: 'Telegram', time }).message)
      .toBe('已交给 Telegram，没拿到回执 · 12:44')
  })

  it('keeps a quiet-hours suppression honest, and does not call the channel broken', () => {
    // 免打扰：记录照建、中心有条，手机那一档被压下，并且平台说明了原因。
    const state = classifySendReceipt({
      kind: 'accepted',
      delivery: { suppressed: [{ level: 'channel', reason: 'quiet-hours' }] }
    })
    expect(state).toEqual({ state: 'suppressed', reason: 'quiet-hours' })
    const copy = describeSendStatus({ state, text: zh, time })
    // 免打扰是「筛掉」不是「顺延」：句子既要说明不会补发，也要给出此刻能做的那一步。
    expect(copy.message).toContain('不会自动补发')
    expect(copy.message).toContain('关掉免打扰再点一次')
    expect(copy.reasonCode).toBeUndefined()
  })

  it('says "app only" when the phone leg simply was not planned', () => {
    const state = classifySendReceipt({ kind: 'accepted' })
    expect(state).toEqual({ state: 'app-only' })
    expect(describeSendStatus({ state, text: zh, time }).message).toBe('只留在应用内，没到手机 · 12:44')
  })

  it('calls the daily cap by its name: a refused submit, not a suppressed surface', () => {
    // 上限是提交被拒（`rejected`），不属于「某一档被压下」——两步动作不同：等明天 vs 查通道。
    const rejected = classifySendReceipt({ kind: 'rejected', reason: 'daily-limit-reached' })
    expect(rejected).toEqual({ state: 'daily-limit' })
    const copy = describeSendStatus({ state: rejected, text: zh, time })
    expect(copy.message).toContain('今天的上限到了')
    expect(copy.reasonCode).toBeUndefined()
  })

  it('says it does not recognize a suppression reason, instead of calling it sent or unsent', () => {
    // 契约的值域是四个码；这里喂一个**值域外**的码（旧表里那个「未批准」），
    // 界面必须出兜底句：不空着、不说「已发到」、也不冒充「没发到手机」的原因。
    const state = classifySendReceipt({
      kind: 'accepted',
      delivery: { suppressed: [{ level: 'push', reason: 'not-approved' }] }
    })
    expect(state).toEqual({ state: 'suppressed-unknown', reason: 'not-approved' })
    const copy = describeSendStatus({ state, text: zh, time })
    expect(copy.message).toBe(zh.suppressedUnknown)
    expect(copy.message.length).toBeGreaterThan(0)
    expect(copy.message).not.toContain('已发到')
    expect(copy.reasonCode).toBe('not-approved')
  })

  it('has a sentence for every reason the contract can actually produce', () => {
    for (const reason of ['quiet-hours', 'toast-disabled', 'popup-disabled', 'desktop-disabled'] as const) {
      const state = classifySendReceipt({ kind: 'accepted', delivery: { suppressed: [{ level: 'push', reason }] } })
      expect(state).toEqual({ state: 'suppressed', reason })
      expect(describeSendStatus({ state, text: zh, time }).message.length).toBeGreaterThan(0)
    }
  })

  it('points at the channel page differently for none and for several channels', () => {
    const state = classifySendReceipt({ kind: 'accepted', delivery: { push: { state: 'failed', reason: 'push-unavailable' } } })
    expect(state).toEqual({ state: 'push-unavailable' })
    expect(describeSendStatus({ state, text: zh, channel: { enabledChannelCount: 0, multiple: false }, time }))
      .toEqual({ message: '没发到手机：还没有可用的通道，去「频道」启用一条', reasonCode: 'push-unavailable' })
    expect(describeSendStatus({ state, text: zh, channel: { enabledChannelCount: 2, multiple: true }, time }).message)
      .toContain('停用到只剩一条')
  })

  it('keeps a channel error out of the sentence and inside the folded code', () => {
    const state = classifySendReceipt({ kind: 'accepted', delivery: { push: { state: 'failed', reason: 'channel-rejected' } } })
    expect(state).toEqual({ state: 'not-sent', reason: 'channel-rejected' })
    const copy = describeSendStatus({ state, text: zh, time })
    expect(copy.message).toBe('没发到手机')
    expect(copy.message).not.toContain('channel-rejected')
    expect(copy.reasonCode).toBe('channel-rejected')
  })

  it('falls back to a neutral channel name instead of inventing one', () => {
    const state = classifySendReceipt({ kind: 'accepted', delivery: { push: { state: 'sent-accepted' } } })
    expect(describeSendStatus({ state, text: zh, time }).message).toBe('已发到 推送通道 · 12:44')
    // 点击前那份通道事实**不参与**这句话：它只回答「有没有可用通道」，而且这里根本没有通道名。
    expect(describeSendStatus({ state, text: zh, channel: { enabledChannelCount: 0, multiple: false }, time }).message)
      .toBe('已发到 推送通道 · 12:44')
  })

  it('carries any other rejection code through untouched', () => {
    const state = classifySendReceipt({ kind: 'rejected', reason: 'channel-not-configured' })
    expect(state).toEqual({ state: 'failed', reason: 'channel-not-configured' })
    // 码只出现在折叠区那一处，主句里没有。
    expect(describeSendStatus({ state, text: zh, time })).toEqual({ message: '没发出去', reasonCode: 'channel-not-configured' })
  })

  it('treats a queued push as not-yet, never as sent', () => {
    const state = classifySendReceipt({ kind: 'accepted', delivery: { push: { state: 'queued' } } })
    expect(state).toEqual({ state: 'app-only' })
  })
})
