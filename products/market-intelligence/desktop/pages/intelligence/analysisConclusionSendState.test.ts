import { describe, expect, it } from 'vitest'

import { describeSendStatus } from './analysisConclusionSendCopy'
import { classifySendReceipt } from './analysisConclusionSendState'
import { analysisConclusionSendText } from './analysisConclusionSendText'

/**
 * 投递结果的判定与说法。
 *
 * 这张用例表就是「提交成功 ≠ 手机收到」的可执行版本，并且按多通道方案的定稿：一条消息发到
 * **所有**已启用通道，读者看到的是**计数**（几条收到、几条没到），不是一句「发送成功」。
 *
 * 四条硬判据：
 * - 正文**只有数字**，通道名一个都不出现；
 * - ⓘ 里按通道一行「名字 · 人话原因」，**不上原因码**；
 * - 「发出去但没收到回执」既不算收到也不算没到（中性占位）；
 * - 多通道是合法配置，**没有一句**让人去停用通道。
 */
const zh = analysisConclusionSendText('zh-CN')
const en = analysisConclusionSendText('en-US')
const time = '12:44'

type PushState = 'queued' | 'sent-accepted' | 'sent-unconfirmed' | 'failed'
type ChannelRow = Readonly<{ channelName?: string; state: PushState; reason?: string }>

const accepted = (push: Readonly<{ state: PushState; reason?: string; channels?: readonly ChannelRow[] }>) =>
  ({ kind: 'accepted' as const, delivery: { push } })

const channels = (...rows: readonly ChannelRow[]): readonly ChannelRow[] => rows

/** 回执 → 说明行：状态与逐通道行都从同一份回执来（和 hook 里的用法一致）。 */
const copyOf = (
  push: Readonly<{ state: PushState; reason?: string; channels?: readonly ChannelRow[] }>,
  text: typeof zh | typeof en = zh
) => {
  const state = classifySendReceipt(accepted(push))
  return describeSendStatus({ state, text, time, ...(push.channels === undefined ? {} : { channels: push.channels }) })
}

describe('reading one send receipt across every channel', () => {
  it('says all channels received it, with the count and no channel names', () => {
    const state = classifySendReceipt(accepted({
      state: 'sent-accepted',
      channels: channels(
        { channelName: 'Telegram · 观潮', state: 'sent-accepted' },
        { channelName: '飞书 · 团队', state: 'sent-accepted' },
        { channelName: 'Discord · 群', state: 'sent-accepted' }
      )
    }))
    expect(state).toEqual({ state: 'delivered', total: 3 })
    const copy = copyOf({
      state: 'sent-accepted',
      channels: channels(
        { channelName: 'Telegram · 观潮', state: 'sent-accepted' },
        { channelName: '飞书 · 团队', state: 'sent-accepted' },
        { channelName: 'Discord · 群', state: 'sent-accepted' }
      )
    })
    expect(copy.message).toBe('3 条通道都收到了')
    // 正文里没有通道名——名字全在 ⓘ 的逐行说明里。
    expect(copy.message).not.toContain('Telegram')
    expect(copy.channels?.map((row) => row.name)).toEqual(['Telegram · 观潮', '飞书 · 团队', 'Discord · 群'])
  })

  it('counts a partial result: how many received, how many did not', () => {
    const state = classifySendReceipt(accepted({
      state: 'failed',
      channels: channels(
        { channelName: 'Telegram', state: 'sent-accepted' },
        { channelName: '飞书', state: 'failed', reason: 'channel-rejected' },
        { channelName: 'Discord', state: 'failed', reason: 'push-backoff' }
      )
    }))
    expect(state).toEqual({ state: 'partial', received: 1, total: 3 })
    const copy = copyOf({
      state: 'failed',
      channels: channels(
        { channelName: 'Telegram', state: 'sent-accepted' },
        { channelName: '飞书', state: 'failed', reason: 'channel-rejected' },
        { channelName: 'Discord', state: 'failed', reason: 'push-backoff' }
      )
    })
    expect(copy.message).toBe('1 条通道收到，2 条没到')
    expect(copy.message).not.toContain('Telegram')
    // 每条通道一行，原因是人话，**不是原因码**。
    expect(copy.channels).toEqual([
      { name: 'Telegram', detail: '收到了' },
      { name: '飞书', detail: '通道没接这次请求' },
      { name: 'Discord', detail: '这条通道刚失败过几次，暂时没有重试' }
    ])
    expect(JSON.stringify(copy)).not.toContain('channel-rejected')
  })

  it('says no channel received it when every channel failed', () => {
    const state = classifySendReceipt(accepted({
      state: 'failed',
      channels: channels(
        { channelName: 'Telegram', state: 'failed', reason: 'channel-rejected' },
        { channelName: '飞书', state: 'failed', reason: 'unknown-after-send' }
      )
    }))
    expect(state).toEqual({ state: 'none-received', total: 2 })
    const copy = copyOf({
      state: 'failed',
      channels: channels(
        { channelName: 'Telegram', state: 'failed', reason: 'channel-rejected' },
        { channelName: '飞书', state: 'failed', reason: 'unknown-after-send' }
      )
    })
    expect(copy.message).toBe('没有任何通道收到（共 2 条）')
    expect(copy.channels?.[1]).toEqual({ name: '飞书', detail: '送到一半失去响应，不知道到没到' })
  })

  it('counts a backoff skip as "did not receive", not as received', () => {
    // `queued` 是退避跳过：这一次请求根本没发出去。
    const state = classifySendReceipt(accepted({
      state: 'queued',
      channels: channels(
        { channelName: 'Telegram', state: 'sent-accepted' },
        { channelName: '飞书', state: 'queued', reason: 'push-backoff' }
      )
    }))
    expect(state).toEqual({ state: 'partial', received: 1, total: 2 })
    expect(copyOf({
      state: 'queued',
      channels: channels(
        { channelName: 'Telegram', state: 'sent-accepted' },
        { channelName: '飞书', state: 'queued', reason: 'push-backoff' }
      )
    }).message).toBe('1 条通道收到，1 条没到')
  })

  it('uses a neutral sentence when a receipt is still missing, and never counts it either way', () => {
    // 产品还在定这一档：既不能说收到（假成功），也不能说没到（假失败）。
    const state = classifySendReceipt(accepted({
      state: 'sent-unconfirmed',
      channels: channels(
        { channelName: 'Telegram', state: 'sent-accepted' },
        { channelName: '飞书', state: 'sent-unconfirmed' }
      )
    }))
    expect(state).toEqual({ state: 'unconfirmed' })
    const copy = copyOf({
      state: 'sent-unconfirmed',
      channels: channels(
        { channelName: 'Telegram', state: 'sent-accepted' },
        { channelName: '飞书', state: 'sent-unconfirmed' }
      )
    })
    expect(copy.message).toBe('已送出去，还没收到回执')
    // 逐条真相照实说：收到的那条仍是「收到了」，未确认的那条不并入任何一边。
    expect(copy.channels).toEqual([
      { name: 'Telegram', detail: '收到了' },
      { name: '飞书', detail: '已送出去，还没收到回执' }
    ])
  })

  it('keeps the neutral sentence even when some channels already failed', () => {
    // 有未确认的一档时总括句走中性：既不能说「都收到了」，也不能把未确认算进「没到」。
    const state = classifySendReceipt(accepted({
      state: 'sent-unconfirmed',
      channels: channels(
        { channelName: 'Telegram', state: 'failed', reason: 'channel-rejected' },
        { channelName: '飞书', state: 'sent-unconfirmed' }
      )
    }))
    expect(state).toEqual({ state: 'unconfirmed' })
    expect(copyOf({
      state: 'sent-unconfirmed',
      channels: channels(
        { channelName: 'Telegram', state: 'failed', reason: 'channel-rejected' },
        { channelName: '飞书', state: 'sent-unconfirmed' }
      )
    }).message).toBe('已送出去，还没收到回执')
  })

  it('has an unknown-channel name fallback instead of inventing a brand', () => {
    expect(copyOf({ state: 'sent-accepted', channels: channels({ state: 'sent-accepted' }) }).channels?.[0]?.name)
      .toBe('推送通道')
  })

  it('says it does not recognize a channel reason instead of inventing one', () => {
    expect(copyOf({
      state: 'failed',
      channels: channels({ channelName: 'Telegram', state: 'failed', reason: 'brand-new-reason' })
    }).channels?.[0]).toEqual({ name: 'Telegram', detail: '这次没成功，原因还不认识' })
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
    expect(copy.channels).toBeUndefined()
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
  })

  it('says it does not recognize a suppression reason, instead of calling it sent or unsent', () => {
    // 契约的值域是四个码；这里喂一个**值域外**的码，界面必须出兜底句：不空着、不说收到、也不冒充没到。
    const state = classifySendReceipt({
      kind: 'accepted',
      delivery: { suppressed: [{ level: 'push', reason: 'not-approved' }] }
    })
    expect(state).toEqual({ state: 'suppressed-unknown', reason: 'not-approved' })
    const copy = describeSendStatus({ state, text: zh, time })
    expect(copy.message).toBe(zh.suppressedUnknown)
    expect(copy.message).not.toContain('已收到')
    expect(JSON.stringify(copy)).not.toContain('not-approved')
  })

  it('has a sentence for every suppression reason the contract can actually produce', () => {
    for (const reason of ['quiet-hours', 'toast-disabled', 'popup-disabled', 'desktop-disabled'] as const) {
      const state = classifySendReceipt({ kind: 'accepted', delivery: { suppressed: [{ level: 'push', reason }] } })
      expect(state).toEqual({ state: 'suppressed', reason })
      expect(describeSendStatus({ state, text: zh, time }).message.length).toBeGreaterThan(0)
    }
  })

  it('points at enabling a channel when none exists, and never tells the reader to turn one off', () => {
    const state = classifySendReceipt({ kind: 'accepted', delivery: { push: { state: 'failed', reason: 'push-unavailable' } } })
    expect(state).toEqual({ state: 'push-unavailable' })
    expect(describeSendStatus({ state, text: zh, time }).message).toBe('没发到手机：还没有可用的通道，去「频道」启用一条')
    // 多通道是合法配置：任何一份回执、任何一种语言都不许再叫读者去停用通道。
    for (const text of [zh, en]) {
      const sentences = [
        describeSendStatus({ state, text, time }).message,
        describeSendStatus({ state: classifySendReceipt({ kind: 'rejected', reason: 'x' }), text, time }).message,
        describeSendStatus({ state: classifySendReceipt({ kind: 'accepted' }), text, time }).message
      ].join('\n')
      expect(sentences).not.toContain('只剩一条')
      expect(sentences.toLowerCase()).not.toContain('leave only one')
    }
  })

  it('carries any other rejection code through untouched, but never prints it', () => {
    const state = classifySendReceipt({ kind: 'rejected', reason: 'channel-not-configured' })
    expect(state).toEqual({ state: 'failed', reason: 'channel-not-configured' })
    const copy = describeSendStatus({ state, text: zh, time })
    expect(copy.message).toBe('没发出去')
    expect(JSON.stringify(copy)).not.toContain('channel-not-configured')
  })

  it('renders a legacy single-channel record without inventing per-channel rows', () => {
    // 老记录没有 `channels[]`：那时确实只有一条通道，按聚合档单条读，不回填、不报错。
    const state = classifySendReceipt({ kind: 'accepted', delivery: { push: { state: 'sent-accepted' } } })
    expect(state).toEqual({ state: 'delivered', total: 1 })
    const copy = describeSendStatus({ state, text: zh, time })
    expect(copy.message).toBe('1 条通道都收到了')
    expect(copy.channels).toBeUndefined()
  })

  it('never says "pushed" or "sent" as a state word, in either language', () => {
    // 判据（Chief 2026-11-12）：页面不再出现「已推送」「已发送」——收到/没到才是事实。
    const every = [zh, en]
      .map((text) => Object.values(text).filter((value) => typeof value === 'string').join('\n'))
      .join('\n')
    expect(every).not.toContain('已推送')
    expect(every).not.toContain('已发送')
    expect(every.toLowerCase()).not.toContain('delivered')
  })
})
