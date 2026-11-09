import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import type { DeliveryHooks } from './notificationRouting'
import { PUSH_BACKOFF_WINDOW_MS } from '../delivery/pushBackoffPolicy'
import { createNotificationJsonStorage, createNotificationRuntime } from './notificationRuntime'

/**
 * 熔断计数（push-backoff）**重启之后是否还在**（行 13 的验收项）。
 *
 * 设计是「保留」：`pushBackoff` 是通知状态的一部分（`notificationStore.ts:33`，按 `channelId`
 * 每通道一份），随整份 `notifications.json` 落盘。它必须保留——否则重启一次就白送一次「重新开始
 * 连发」的机会，而读者那边只能看到「怎么又开始推了」。
 *
 * 反向也要成立：暂停时刻**已过**就立刻恢复发送，不拿一个过期的恢复时刻继续拦。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'platform',
    events: [{
      id: 'platform.demo-push',
      titleKey: 'notification.event.platform.demo-push.title',
      reasonKey: 'notification.event.platform.demo-push.reason',
      bodyKey: 'notification.event.platform.demo-push.body',
      requiresUserAction: false,
      category: 'reminder',
      requestedDisruptionLevels: ['channel'],
      dedupeKeyTemplate: 'demo:{id}',
      dedupeUnit: 'occurrence'
    }],
    approval: { 'platform.demo-push': { approvedDisruptionLevels: ['center', 'channel'] as const, approvedBypassQuietHours: false } }
  }]
})

const NOW = '2026-11-09T12:00:00.000Z'
const CHANNEL = 'channel-a'

function request(id: string): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.demo-push',
    actions: [],
    dedupeVars: { builder: 'template', vars: { id } },
    occurredAt: NOW
  }
}

function runtimeAt(file: string, now: string, push: NonNullable<DeliveryHooks['push']>) {
  return createNotificationRuntime({
    storage: createNotificationJsonStorage(file),
    catalog,
    diagnostics: () => undefined,
    getSettings: async () => createDefaultNotificationRuntimeSettings(),
    clock: { now: () => new Date(now), timeZone: () => 'Asia/Shanghai' },
    resolvePushChannel: async () => ({ ok: true, channelId: CHANNEL, channelName: 'Telegram' }),
    deliveryHooks: { push }
  })
}

describe('push backoff survives a restart', () => {
  it('keeps the channel paused after the process is reopened, then resumes once the window has passed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notification-backoff-'))
    const file = join(dir, 'notifications.json')
    const pausedUntil = new Date(Date.parse(NOW) + PUSH_BACKOFF_WINDOW_MS).toISOString()
    writeFileSync(file, JSON.stringify({
      records: [],
      subscriptions: {},
      dailyCounters: {},
      // 上一次进程里连续失败 3 次留下的熔断记录：**落盘在通知状态里，按通道各一份**。
      pushBackoff: { [CHANNEL]: { channelId: CHANNEL, failures: 3, pausedUntil } }
    }), 'utf8')

    const blockedPush = vi.fn(async () => ({ ok: true, messageId: 'm-1' })) as unknown as NonNullable<DeliveryHooks['push']>
    const blocked = runtimeAt(file, NOW, blockedPush)
    const blockedOutcome = await blocked.submit(request('one'))
    expect(blockedOutcome.kind).toBe('accepted')
    // 重启后仍然拦着：端口一次都没被调用，记录写的是「熔断退避」而不是「已发出」。
    expect(blockedPush).not.toHaveBeenCalled()
    expect((blockedOutcome as { delivery?: { push?: { state?: string; reason?: string } } }).delivery?.push)
      .toMatchObject({ state: 'failed', reason: 'push-backoff' })

    // 窗口过去之后（同一份文件、新的运行时）：立刻恢复发送，不拿过期时刻继续拦。
    const resumedPush = vi.fn(async () => ({ ok: true, messageId: 'm-2' })) as unknown as NonNullable<DeliveryHooks['push']>
    const resumed = runtimeAt(file, new Date(Date.parse(pausedUntil) + 1_000).toISOString(), resumedPush)
    const resumedOutcome = await resumed.submit(request('two'))
    expect(resumedPush).toHaveBeenCalledTimes(1)
    expect((resumedOutcome as { delivery?: { push?: { state?: string } } }).delivery?.push?.state).toBe('sent-accepted')
    // 恢复后写回的是清零的熔断状态，而不是把旧的暂停时刻留在文件里等人误读。
    const persisted = JSON.parse(readFileSync(file, 'utf8')) as { pushBackoff: Record<string, { pausedUntil: string | null }> }
    expect(persisted.pushBackoff[CHANNEL]?.pausedUntil ?? null).toBeNull()

    rmSync(dir, { recursive: true, force: true })
  })
})
