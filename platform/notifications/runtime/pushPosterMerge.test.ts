import { describe, expect, it, vi } from 'vitest'

import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationDeliveryContent } from './notificationRouting'
import type { NotificationRecord } from '../contracts/notificationContracts'
import type { ChannelPushAttempt, ChannelPushTarget } from '../delivery/channelPushPort'
import type { ChannelPosterPushAttempt } from '../delivery/channelPosterPushPort'
import { attemptChannelPush } from './pushFanout'

/**
 * 海报那一格的重推语义（2026-11-25，界面设计 v1.3 核出）。
 *
 * 同一格有两条写入口：**手动补发**（`channelImageWiring`）会把先前的 `sent-accepted` 合回去，
 * 而**推送扇出**（这里）以前是整格替换。两条路语义不一致时，一次升级重推里某条通道失败，
 * 就把「手机上那张图确实到过」改写成「未发送」——详情页那一行会跳态。
 *
 * 定稿：**成功过就保留，其余取最近一次尝试**（与手动补发同一条口径）。
 */
const NOW = '2026-11-25T01:00:00.000Z'
const HASH = 'abcdef0123456789'

const content: NotificationDeliveryContent = { title: 't', body: 'b', reason: 'r', actionLabels: {} }

function record(): NotificationRecord {
  return {
    id: 'notification-1',
    owner: 'product',
    productId: 'market-intelligence',
    sourceId: 'market-intelligence.briefing.ready',
    eventTypeId: 'market-intelligence.briefing.ready',
    // 已经有上一次投递的账：正文两条都受理，海报一条受理。
    delivery: {
      push: {
        state: 'sent-accepted',
        at: NOW,
        channels: [
          { channelId: 'channel-a', channelName: 'A', state: 'sent-accepted', at: NOW },
          { channelId: 'channel-b', channelName: 'B', state: 'sent-accepted', at: NOW }
        ]
      },
      pushImage: {
        state: 'sent-accepted',
        at: NOW,
        channels: [{ channelId: 'channel-a', channelName: 'A', state: 'sent-accepted', attemptId: 'p-a', at: NOW }]
      }
    },
    channels: ['center'],
    state: 'read',
    severity: 'info',
    priority: 'normal',
    edition: { editionId: '2026-11-25:zh-CN:default', locale: 'zh-CN' },
    editionPoster: { contentHash: HASH },
    actions: [],
    occurrenceCount: 1,
    createdAt: NOW,
    updatedAt: NOW
  }
}

function settings() {
  return { ...createDefaultNotificationRuntimeSettings(), desktopEnabled: true, toastEnabled: true }
}

async function push(input: Readonly<{ posterResult: () => { ok: boolean; reason?: string } }>) {
  const target = record()
  const delivery = JSON.parse(JSON.stringify(target.delivery)) as NotificationRecord['delivery']
  await attemptChannelPush({
    record: target,
    delivery,
    settings: settings(),
    pushBackoff: {},
    content,
    signalSeverity: undefined,
    now: () => NOW,
    resolvePushChannels: async () => ({
      ok: true as const,
      channels: [
        { id: 'channel-a', name: 'A' },
        { id: 'channel-b', name: 'B' }
      ]
    }),
    pushHook: vi.fn(async (
      _record: NotificationRecord,
      _content: NotificationDeliveryContent,
      targets: readonly ChannelPushTarget[]
    ) => targets.map((entry): ChannelPushAttempt => ({
      channelId: entry.channelId,
      channelName: entry.channelName,
      result: { ok: true, messageId: `m-${entry.channelId}` }
    }))) as never,
    pushImageHook: vi.fn(async (
      _record: NotificationRecord,
      targets: readonly ChannelPushTarget[]
    ) => targets.map((entry): ChannelPosterPushAttempt => ({
      channelId: entry.channelId,
      channelName: entry.channelName,
      result: input.posterResult()
    }))) as never
  })
  return delivery.pushImage
}

describe('海报那一格：成功后不被后来的失败抹掉', () => {
  it('重推时某条通道失败：已受理的那条仍是 sent-accepted，整格也不变红', async () => {
    const pushImage = await push({ posterResult: () => ({ ok: false, reason: 'channel-rejected' }) })
    const rowA = pushImage?.channels?.find((row) => row.channelId === 'channel-a')
    // 手机上那张图确实到过：它这一行不许被这次失败改写。
    expect(rowA?.state).toBe('sent-accepted')
    expect(rowA?.attemptId).toBe('p-a')
    // 另一条这次失败照实记（它从来没成功过）；总括因此是 failed——那是「这一轮 b 真失败了」，
    // 与「a 被抹掉」是两件事，详情页读的是逐行，不读这个聚合。
    expect(pushImage?.channels?.find((row) => row.channelId === 'channel-b')?.state).toBe('failed')
    expect(pushImage?.state).toBe('failed')
  })

  it('这次也成功：仍是一行，不新增行、不重复计数', async () => {
    const pushImage = await push({ posterResult: () => ({ ok: true }) })
    expect(pushImage?.channels).toHaveLength(2)
    // a 先前受理过、这次没拿到回执号：保留先前那一行（「到过」比「这次没回执」更该记住）；
    // b 第一次发、没有回执号 → `sent-unconfirmed`，与正文那条同一张映射表。
    expect(pushImage?.channels?.find((row) => row.channelId === 'channel-a')?.state).toBe('sent-accepted')
    expect(pushImage?.channels?.find((row) => row.channelId === 'channel-b')?.state).toBe('sent-unconfirmed')
  })
})