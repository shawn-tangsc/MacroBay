import { describe, expect, it } from 'vitest'

import { NO_PUSH_CHANNEL } from '../delivery/pushChannelResolution'
import { composeSelfTestSurface } from './notificationSelfTestSurface'

/**
 * 平台只剩一种测试：`link`（链路自检）。产品的三种取数在各自产品里拼请求，不属于这份契约。
 */
function harness(options: { channel?: unknown; rejected?: boolean } = {}) {
  const submitted: { eventTypeId: string; namespace?: string; rendered?: Record<string, { title: string }> }[] = []
  const surface = composeSelfTestSurface({
    resolvePushChannel: async () => (options.channel ?? { ok: true, channelId: 'channel-a', channelName: 'Telegram · test' }) as never,
    deliver: async (input) => {
      submitted.push(input as never)
      return (options.rejected === true ? { kind: 'rejected', reason: 'unknown-event-type', message: 'x' } : { kind: 'accepted', recordId: 'r1', levels: ['channel'] }) as never
    },
    now: () => '2026-11-08T00:00:00.000Z'
  })
  return { surface, submitted }
}

describe('sendTestNotice (link only)', () => {
  it('sends the fixed sample through the same submit in the test namespace and names the channel', async () => {
    const { surface, submitted } = harness()
    await expect(surface.sendTestNotice()).resolves.toEqual({ state: 'sent', channelId: 'channel-a', channelName: 'Telegram · test' })
    expect(submitted[0]).toMatchObject({ namespace: 'test' })
    expect(submitted[0]?.rendered?.['zh-CN']?.title).toContain('【测试】')
    expect(submitted[0]?.rendered?.['en-US']?.title).toContain('[Test]')
  })

  it('fails closed with 0 channels and carries the count from the same judgement', async () => {
    const { surface, submitted } = harness({ channel: NO_PUSH_CHANNEL })
    await expect(surface.sendTestNotice()).resolves.toEqual({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 0 })
    expect(submitted).toEqual([])
  })

  it('fails closed with ≥2 channels and reports the real count, not a hard-coded 2', async () => {
    const { surface } = harness({ channel: { ok: false, reason: 'push-unavailable', enabledChannelCount: 3, multiple: true } })
    await expect(surface.sendTestNotice()).resolves.toMatchObject({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 3 })
  })
})
