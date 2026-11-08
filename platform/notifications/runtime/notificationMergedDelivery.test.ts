import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationSubmitRequest } from '../contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

/**
 * 合并回执里**只有真的又投递过**才带 `delivery`（契约：accepted/merged 的 `delivery` 是这次的结果）。
 *
 * 两条判据互为对照：
 * - 普通合并（没有严重度升级）→ 回执**不带** `delivery`：旧记录的各档投递是历史，不是这一次的；
 * - 真升级 → 带，且**只带 `push`**（升级路径只推手机，不带桌面、不带中心）。
 *
 * 缺了这两条，回执「不会把别人的投递当成这次的」就只是注释。
 */
/**
 * **机制夹具**：一条 `condition` 粒度、批了手机的事件。真实平台事件里没有「累积严重度 + 手机」
 * 这一组合（自检虽是诊断但不去重合并），而这里要测的是合并回执的字段，与任何产品事件无关。
 */
const catalog = createNotificationEventCatalog({
  sources: [{
    productId: 'platform',
    events: [{
      id: 'platform.demo-cumulative',
      titleKey: 'notification.event.platform.demo-cumulative.title',
      reasonKey: 'notification.event.platform.demo-cumulative.reason',
      bodyKey: 'notification.event.platform.demo-cumulative.body',
      requiresUserAction: false,
      category: 'needs-action',
      requestedDisruptionLevels: ['channel'],
      dedupeKeyTemplate: 'cumulative:{jobKey}:{date}',
      dedupeUnit: 'condition',
      conditionWindowMs: 86_400_000
    }],
    // 只批中心与手机：这样「升级只推手机」在回执里一眼可辨（没有桌面/提示可混淆）。
    approval: { 'platform.demo-cumulative': { approvedDisruptionLevels: ['center', 'channel'] as const, approvedBypassQuietHours: false } }
  }]
})

const DAY = '2026-11-08T04:00:00.000Z'

function harness() {
  let state: any = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: () => undefined,
    getSettings: async () => createDefaultNotificationRuntimeSettings(),
    clock: { now: () => new Date(DAY), timeZone: () => 'Asia/Shanghai' },
    desktopSupported: () => true,
    deliveryHooks: {
      desktop: async () => ({ ok: true }),
      push: async () => ({ ok: true, messageId: 'm-1' })
    },
    resolvePushChannel: async () => ({ ok: true, channelId: 'channel-a', channelName: 'Telegram · test' }),
    getLanguage: async () => 'zh-CN'
  })
  return { runtime, state: () => state }
}

/** `condition` 粒度的事件：同一天同一任务 → 第二次必然走合并分支。 */
function failedRequest(signalSeverity: 'low' | 'medium' | 'high'): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.demo-cumulative',
    actions: [],
    dedupeVars: { builder: 'template', vars: { jobKey: 'job-1', date: '2026-11-08' } },
    occurredAt: DAY,
    signalSeverity
  }
}

describe('merged receipt: only the delivery this submission produced', () => {
  it('a plain merge carries no delivery: the older record\'s attempts are history, not this result', async () => {
    const { runtime } = harness()
    const first = await runtime.submit(failedRequest('low'))
    expect(first.kind).toBe('accepted')
    const second = await runtime.submit(failedRequest('low'))
    expect(second.kind).toBe('merged')
    expect(second).not.toHaveProperty('delivery')
  })

  it('a severity upgrade carries delivery with push only', async () => {
    const { runtime } = harness()
    expect((await runtime.submit(failedRequest('low'))).kind).toBe('accepted')
    const upgraded = await runtime.submit(failedRequest('high'))
    expect(upgraded.kind).toBe('merged')
    if (upgraded.kind !== 'merged') return
    // 升级只推手机：带的是那一次真实结果，且没有桌面/提示/中心。
    expect(upgraded.delivery).toEqual({ push: expect.objectContaining({ state: 'sent-accepted' }) })
    expect(Object.keys(upgraded.delivery ?? {})).toEqual(['push'])
  })
})
