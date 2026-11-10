import { describe, expect, it } from 'vitest'

import { NO_PUSH_CHANNEL } from '../delivery/pushChannelResolution'
import { composeSelfTestSurface } from './notificationSelfTestSurface'

/**
 * 平台只剩一种测试：`link`（链路自检）。产品的三种取数在各自产品里拼请求，不属于这份契约。
 */
function harness(options: { channel?: unknown; outcome?: string; suppressed?: { level: 'push' | 'desktop'; reason: 'quiet-hours' | 'desktop-disabled' }[] } = {}) {
  const submitted: { eventTypeId: string; namespace?: string; rendered?: Record<string, { title: string }>; deeplink?: unknown; dedupeVars?: { vars?: Record<string, string> } }[] = []
  const surface = composeSelfTestSurface({
    resolvePushChannel: async () => (options.channel ?? { ok: true, channelId: 'channel-a', channelName: 'Telegram · test' }) as never,
    submitRequest: async (input) => {
      submitted.push(input as never)
      if (options.outcome === 'rejected') return { kind: 'rejected', reason: 'unknown-event-type', message: 'x' } as never
      if (options.outcome === 'collapsed') return { kind: 'collapsed', aggregateRecordId: 'a1', collapsedCount: 2 } as never
      if (options.outcome === 'merged') return { kind: 'merged', recordId: 'r1', occurrenceCount: 2, mergedEventTypes: [] } as never
      if (options.outcome === 'delegated') return { kind: 'delegated', eventTypeId: 'x', producerId: 'p', ownerProductId: 'o' } as never
      return { kind: 'accepted', recordId: 'r1', levels: ['channel'], suppressedLevels: options.suppressed ?? [] } as never
    },
    now: () => '2026-11-08T00:00:00.000Z'
  })
  return { surface, submitted }
}

describe('sendTestNotice (link only)', () => {
  it('says the submit was rejected instead of pretending the sample could not be read', async () => {
    // 被拒（门禁/批准表）与「读不到样例」是两种病：同一个码盖两种病，读者会去查数据而不是查开关。
    const { surface } = harness({ outcome: 'rejected' })
    await expect(surface.sendTestNotice()).resolves.toEqual({ state: 'unavailable', reasonCode: 'rejected' })
  })

  it('uses a new dedupe key per click, so two clicks are two records', async () => {
    const first = harness()
    const second = harness()
    await first.surface.sendTestNotice()
    await second.surface.sendTestNotice()
    const key = (h: ReturnType<typeof harness>) => (h.submitted[0] as { dedupeVars?: { vars?: Record<string, string> } }).dedupeVars?.vars
    // 键里带点击时刻：同一毫秒以外，两次点击必然不同 -> 不会互相吞掉。
    expect(key(first)).toHaveProperty('seq')
    expect(key(first)?.date).toEqual(key(second)?.date)
  })

  it('sends the fixed sample through the same submit in the test namespace and names the channel', async () => {
    const { surface, submitted } = harness()
    await expect(surface.sendTestNotice()).resolves.toEqual({ state: 'sent', channelId: 'channel-a', channelName: 'Telegram · test' })
    // 文案走平台文案表（不带 rendered 成品句）：平台自己的事件、自己的文案，不复用真实事件。
    expect(submitted[0]).toMatchObject({ namespace: 'test', eventTypeId: 'platform.notification.self-test' })
    expect(submitted[0]?.rendered).toBeUndefined()
    // 点开回到设置页那枚按钮。
    expect(submitted[0]?.deeplink).toEqual({ scope: 'platform' })
  })

  it('says the test was not run when a surface was never attempted, instead of claiming it arrived', async () => {
    // 免打扰或开关关着时那一档根本没试过：回「已发到」就是把「没测」说成「到了」。
    const { surface } = harness({ suppressed: [{ level: 'desktop', reason: 'quiet-hours' }] })
    await expect(surface.sendTestNotice()).resolves.toEqual({ state: 'unavailable', reasonCode: 'suppressed' })
  })

  it('never reports "sent" when the submission was folded, merged or delegated', async () => {
    for (const outcome of ['collapsed', 'merged', 'delegated'] as const) {
      const { surface } = harness({ outcome })
      await expect(surface.sendTestNotice()).resolves.toEqual({ state: 'unavailable', reasonCode: outcome })
    }
  })

  it('fails closed with 0 channels and carries the count from the same judgement', async () => {
    const { surface, submitted } = harness({ channel: NO_PUSH_CHANNEL })
    await expect(surface.sendTestNotice()).resolves.toEqual({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 0 })
    expect(submitted).toEqual([])
  })

  it('fails closed with ≥2 channels and reports the real count, not a hard-coded 2', async () => {
    const { surface } = harness({ channel: { ok: false, reason: 'push-unavailable', enabledChannelCount: 3, multiple: true, states: { 'runtime-ready': 3 } } })
    await expect(surface.sendTestNotice()).resolves.toMatchObject({ state: 'unavailable', reasonCode: 'push-unavailable', enabledChannelCount: 3 })
  })
})
