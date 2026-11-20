import { describe, expect, it } from 'vitest'

import type { TestNoticeReceipt } from '../notifications/contracts/notificationSelfTest'
import { selfTestNoticeText } from './selfTestNoticeText'

/**
 * 自检回执 → 读者可见的句子（多通道方案 §5-5 平台侧）。
 *
 * 三条判据：
 * - 一次点击在每条可用通道上各发一条，所以必须能说清「发到几条、每条什么结果」；
 * - **没发到就不许说发到**：只有 `sent-accepted` 计入总括；
 * - `pushUnavailable` 只给「一条可用通道都没有」那一种处境。
 */
const sent = (...names: string[]): TestNoticeReceipt => ({
  state: 'sent',
  channelId: 'channel-a',
  channelName: names[0] ?? 'Telegram',
  channels: names.map((name, index) => ({ channelId: `channel-${index}`, channelName: name, state: 'sent-accepted' as const }))
})

describe('self-test receipt sentences', () => {
  it('says "sent to N channels" only when every channel accepted', () => {
    expect(selfTestNoticeText(sent('Telegram', 'Slack'), 'zh-CN')).toEqual({
      summary: '已发到 2 条通道（测试）',
      lines: ['已发到 Telegram（测试）', '已发到 Slack（测试）']
    })
  })

  it('keeps the single-channel sentence when only one channel is in play', () => {
    expect(selfTestNoticeText(sent('Telegram'), 'zh-CN')).toEqual({
      summary: '已发到 Telegram（测试）',
      lines: ['已发到 Telegram（测试）']
    })
  })

  it('does not claim a send when one channel failed, and still lists every channel', () => {
    const receipt: TestNoticeReceipt = {
      state: 'sent',
      channelId: 'channel-a',
      channelName: 'Telegram',
      channels: [
        { channelId: 'channel-a', channelName: 'Telegram', state: 'sent-accepted' },
        { channelId: 'channel-b', channelName: 'Slack', state: 'failed', reason: 'channel-rejected' },
        { channelId: 'channel-c', channelName: 'Feishu', state: 'queued', reason: 'push-backoff' },
        { channelId: 'channel-d', channelName: 'Discord', state: 'sent-unconfirmed' }
      ]
    }
    expect(selfTestNoticeText(receipt, 'zh-CN')).toEqual({
      summary: '测试消息没发出去',
      lines: [
        '已发到 Telegram（测试）',
        '没发出去：Slack',
        '冷却中：Feishu',
        '没收到回执：Discord'
      ]
    })
  })

  it('uses the "no channel connected" sentence exactly when there is none', () => {
    // 0 条可用通道：这是唯一该说 pushUnavailable 的处境（多通道方案 §5-4）。
    expect(selfTestNoticeText({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 0 }, 'zh-CN'))
      .toEqual({ summary: '这条没接通投递通道', lines: [] })
    // 别的不可用（提交被拒/折叠/合并/免打扰）不许复用那一句。
    expect(selfTestNoticeText({ state: 'unavailable', reasonCode: 'rejected' }, 'zh-CN'))
      .toEqual({ summary: '测试消息没发出去', lines: [] })
    expect(selfTestNoticeText({ state: 'unavailable', reasonCode: 'suppressed' }, 'zh-CN'))
      .toEqual({ summary: '测试消息没发出去', lines: [] })
  })

  it('speaks English when the reader does', () => {
    expect(selfTestNoticeText(sent('Telegram', 'Slack'), 'en-US')).toEqual({
      summary: 'Sent to 2 channels (test)',
      lines: ['Sent to Telegram (test)', 'Sent to Slack (test)']
    })
    expect(selfTestNoticeText({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 0 }, 'en-US'))
      .toEqual({ summary: 'This notification has no delivery channel connected.', lines: [] })
  })
})
