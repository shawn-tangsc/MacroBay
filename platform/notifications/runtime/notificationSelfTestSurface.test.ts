import { describe, expect, it } from 'vitest'

import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { NO_PUSH_CHANNEL } from '../delivery/pushChannelResolution'
import { composeSelfTestSurface } from './notificationSelfTestSurface'

/**
 * 判据 4 / 7 / 8 / 9（技术方案 §5）：三枚测试按钮的主进程那一半。
 * 取数由产品端口给（这一笔缺席＝`read-failed`），这里用一条现成请求当「真数据」。
 */
const request: NotificationSubmitRequest = {
  eventTypeId: 'platform.test',
  dedupeVars: { builder: 'template', vars: { date: '2026-11-08' } },
  actions: [],
  occurredAt: '2026-11-08T00:00:00.000Z'
}

function harness(options: {
  channels?: Awaited<ReturnType<typeof NO_PUSH_CHANNEL extends never ? never : () => Promise<never>>> | unknown
  candidates?: () => Promise<unknown>
  timeZone?: () => string
  rejected?: boolean
} = {}) {
  const submitted: { eventTypeId: string; namespace?: 'test' }[] = []
  const surface = composeSelfTestSurface({
    getTimezone: options.timeZone ?? (() => 'Asia/Shanghai'),
    resolvePushChannel: async () => (options.channels ?? { ok: true, channelId: 'channel-a', channelName: 'Telegram · test' }) as never,
    ...(options.candidates === undefined ? {} : { candidates: options.candidates as never }),
    deliver: async (input) => {
      submitted.push(input)
      return (options.rejected === true ? { kind: 'rejected', reason: 'unknown-event-type', message: 'x' } : { kind: 'accepted', recordId: 'r1', levels: ['channel'] }) as never
    },
    now: () => '2026-11-08T00:00:00.000Z'
  })
  return { surface, submitted }
}

const candidate = { ok: true as const, request }

describe('sendTestNotice', () => {
  it('sends through the same submit with the test namespace and names the channel', async () => {
    const { surface, submitted } = harness({ candidates: async () => candidate })
    await expect(surface.sendTestNotice('sentiment')).resolves.toEqual({
      state: 'sent', channelId: 'channel-a', channelName: 'Telegram · test'
    })
    // 与真实推送同一个提交入口，唯一差别就是去重域。
    expect(submitted).toEqual([{ ...candidate.request, namespace: 'test' }])
  })

  it('fails closed with 0 channels, carrying the count from the same judgement', async () => {
    const { surface, submitted } = harness({ channels: NO_PUSH_CHANNEL, candidates: async () => candidate })
    await expect(surface.sendTestNotice('sentiment')).resolves.toEqual({
      state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 0
    })
    expect(submitted).toEqual([])
  })

  it('fails closed with ≥2 channels and reports the real count, not a hard-coded 2', async () => {
    const { surface } = harness({
      channels: { ok: false, reason: 'push-unavailable', enabledChannelCount: 3, multiple: true },
      candidates: async () => candidate
    })
    await expect(surface.sendTestNotice('calendar-landed')).resolves.toMatchObject({
      state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 3
    })
  })

  it('refuses to guess a day boundary when the reader timezone cannot be read', async () => {
    const { surface, submitted } = harness({
      candidates: async () => candidate,
      timeZone: () => { throw new Error('settings unavailable') }
    })
    await expect(surface.sendTestNotice('sentiment')).resolves.toEqual({
      state: 'unavailable', reasonCode: 'timezone-unreadable'
    })
    expect(submitted).toEqual([])
  })

  it('says read-failed when no data port is wired, instead of pretending it sent', async () => {
    const { surface, submitted } = harness()
    await expect(surface.sendTestNotice('sentiment')).resolves.toEqual({
      state: 'unavailable', reasonCode: 'read-failed'
    })
    expect(submitted).toEqual([])
  })

  it('keeps the three "nothing" answers apart instead of merging them', async () => {
    for (const reasonCode of ['sentiment-none', 'calendar-upcoming-none', 'calendar-landed-none'] as const) {
      const { surface } = harness({ candidates: async () => ({ ok: false, reasonCode }) })
      await expect(surface.sendTestNotice('sentiment')).resolves.toEqual({ state: 'no-data', reasonCode })
    }
  })
})
