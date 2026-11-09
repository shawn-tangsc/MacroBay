import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { notificationBreakerPolicy } from './notificationBreaker'
import { createNotificationJsonStorage, createNotificationRuntime } from './notificationRuntime'

/**
 * 宿主当日熔断的**计数确实落盘**，且重启不清零（2026-11-08 的待验项）。
 *
 * 为什么必须验这一条：熔断靠一个「今天已经发了几条」的计数，计数只在内存里的话，重启一次就等于
 * 给了读者无限额度；而它又不在任何界面上，坏了没人看得见。判据只有一条：**第 51 条被折叠**，
 * 且**换一个进程（重新从同一个文件加载）仍然是第 51 条**。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'platform',
    events: [{
      id: 'platform.demo-counted',
      titleKey: 'notification.event.platform.demo-counted.title',
      reasonKey: 'notification.event.platform.demo-counted.reason',
      bodyKey: 'notification.event.platform.demo-counted.body',
      requiresUserAction: false,
      category: 'reminder',
      requestedDisruptionLevels: [],
      dedupeKeyTemplate: 'counted:{seq}',
      dedupeUnit: 'occurrence'
    }],
    approval: { 'platform.demo-counted': { approvedDisruptionLevels: ['center'] as const, approvedBypassQuietHours: false } }
  }]
})

const NOW = '2026-11-08T12:00:00.000Z'

function request(seq: number): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.demo-counted',
    actions: [],
    dedupeVars: { builder: 'template', vars: { seq: String(seq) } },
    occurredAt: NOW
  }
}

function runtimeAt(file: string) {
  return createNotificationRuntime({
    storage: createNotificationJsonStorage(file),
    catalog,
    diagnostics: () => undefined,
    getSettings: async () => createDefaultNotificationRuntimeSettings(),
    clock: { now: () => new Date(NOW), timeZone: () => 'Asia/Shanghai' }
  })
}

describe('the host daily breaker counter survives a restart', () => {
  it('folds the submission past the limit, and still folds it after the process is reopened', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'notification-breaker-'))
    const file = join(dir, 'notifications.json')
    const limit = notificationBreakerPolicy.defaultDailyLimit

    const first = runtimeAt(file)
    let lastKind = ''
    for (let seq = 1; seq <= limit; seq += 1) {
      const outcome = await first.submit(request(seq))
      expect(outcome.kind, `第 ${seq} 条应当是正常写入`).toBe('accepted')
    }
    // 计数落盘：文件里那一个桶等于 limit。
    const counters = (JSON.parse(readFileSync(file, 'utf8')) as { dailyCounters: Record<string, number> }).dailyCounters
    const used = Object.values(counters).reduce((sum, value) => sum + value, 0)
    expect(used).toBe(limit)

    // 同一个文件、新的运行时（等于重启一次）：下一条仍然被折叠，而不是重新拥有额度。
    const reopened = runtimeAt(file)
    lastKind = (await reopened.submit(request(limit + 1))).kind
    expect(lastKind).toBe('collapsed')

    rmSync(dir, { recursive: true, force: true })
  })
})
