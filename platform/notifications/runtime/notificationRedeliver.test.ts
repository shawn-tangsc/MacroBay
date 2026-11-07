import { describe, expect, it } from 'vitest'

import {
  createDefaultNotificationRuntimeSettings,
  type NotificationRuntimeSettings
} from '../contracts/notificationContracts'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

/**
 * 「把这一条再推一次手机」（契约 §16.3.4）。
 *
 * 这组用例只钉三件读者能感知的事：**不新建记录**、**不改内容与计数**、**每点一次真推一次**；
 * 以及四种拒绝都说得出原因（键不存在 / 版次不符 / 只开手机 / 没通道或熔断中）。
 */

const catalog = createNotificationEventCatalog({
  policy: {
    'platform.done': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false }
  },
  sources: [
    {
      productId: 'platform',
      events: [
        {
          id: 'platform.done',
          titleKey: 'notification.test.title',
          bodyKey: 'notification.test.body',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['channel'],
          dedupeKeyTemplate: 'done:{date}',
          dedupeUnit: 'occurrence'
        }
      ]
    }
  ]
})

const clock = { now: () => new Date('2026-11-04T00:00:00.000Z'), timeZone: () => 'UTC' }

function createRuntime(options: {
  settings?: Partial<NotificationRuntimeSettings>
  push?: (record: unknown, content: unknown) => Promise<{ ok: boolean; reason?: string; messageId?: string }>
  pausedUntil?: string
} = {}) {
  let state: any = { records: [], dailyCounters: {}, pushBackoff: {}, providerCredentialHealth: {} }
  if (options.pausedUntil !== undefined) {
    state.pushBackoff = { telegram: { failures: 3, pausedUntil: options.pausedUntil } }
  }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => {
      state = JSON.parse(JSON.stringify(next))
    }
  }
  const runtime = createNotificationRuntime({
    diagnostics: () => undefined,
    storage,
    catalog,
    getSettings: async () => ({
      ...createDefaultNotificationRuntimeSettings(),
      push: { channelId: 'telegram' },
      ...options.settings
    }),
    clock,
    deliveryHooks: options.push === undefined ? {} : { push: options.push }
  })
  return { runtime, state: () => state }
}

const submitRequest = {
  eventTypeId: 'platform.done',
  dedupeVars: { builder: 'template' as const, vars: { date: '2026-11-04' } },
  actions: [],
  occurredAt: '2026-11-04T00:00:00.000Z',
  edition: { editionId: 'brief-2026-11-04-v2', locale: 'zh-CN' }
}

describe('redeliverPush: 只重投一条已有记录的手机一面', () => {
  it('creates the record without delivering when deliver is false, then pushes on request', async () => {
    let pushes = 0
    const { runtime, state } = createRuntime({
      push: async () => {
        pushes += 1
        return { ok: true, messageId: 'm-1' }
      }
    })
    // 手动重新生成：记录更新、**不投递任何表面**
    const outcome = await runtime.submit({ ...submitRequest, deliver: false })
    expect(outcome.kind).toBe('accepted')
    expect(pushes).toBe(0)
    const created = state().records[0]
    expect(created.delivery.push).toBeUndefined()
    expect(created.edition).toEqual({ editionId: 'brief-2026-11-04-v2', locale: 'zh-CN' })

    const result = await runtime.redeliverPush({
      recordId: created.id,
      editionId: 'brief-2026-11-04-v2',
      locale: 'zh-CN'
    })
    expect(result.kind).toBe('accepted')
    expect(pushes).toBe(1)
    const after = state().records[0]
    // 行数与内容不变，只动投递与 updatedAt
    expect(state().records).toHaveLength(1)
    expect(after.occurrenceCount).toBe(created.occurrenceCount)
    expect(after.createdAt).toBe(created.createdAt)
    expect(after.titleKey).toBe(created.titleKey)
    expect(after.delivery.push).toMatchObject({ state: 'sent-accepted', pushCount: 1, messageId: 'm-1' })

    // 再点一次仍然真推一次（平台不做时间窗去重）
    await runtime.redeliverPush({ recordId: created.id, editionId: 'brief-2026-11-04-v2', locale: 'zh-CN' })
    expect(pushes).toBe(2)
    expect(state().records[0].delivery.push).toMatchObject({ pushCount: 2 })
  })

  it('records sent-unconfirmed when the channel accepted but gave no receipt', async () => {
    const { runtime, state } = createRuntime({ push: async () => ({ ok: true }) })
    await runtime.submit({ ...submitRequest, deliver: false })
    const record = state().records[0]
    await runtime.redeliverPush({ recordId: record.id, editionId: 'brief-2026-11-04-v2', locale: 'zh-CN' })
    expect(state().records[0].delivery.push).toMatchObject({ state: 'sent-unconfirmed', pushCount: 1 })
  })

  it('rejects a missing target without creating a row', async () => {
    const { runtime, state } = createRuntime({ push: async () => ({ ok: true }) })
    const result = await runtime.redeliverPush({
      recordId: 'notification-does-not-exist',
      editionId: 'x',
      locale: 'zh-CN'
    })
    expect(result).toEqual({ kind: 'rejected', reason: 'redeliver-target-missing' })
    expect(state().records).toHaveLength(0)
  })

  it('rejects a version that is not the one on the record, and a historical record without one', async () => {
    const { runtime, state } = createRuntime({ push: async () => ({ ok: true }) })
    await runtime.submit({ ...submitRequest, deliver: false })
    const record = state().records[0]
    await expect(
      runtime.redeliverPush({ recordId: record.id, editionId: 'brief-2026-11-04-v1', locale: 'zh-CN' })
    ).resolves.toEqual({ kind: 'rejected', reason: 'redeliver-edition-mismatch' })
    await expect(
      runtime.redeliverPush({ recordId: record.id, editionId: 'brief-2026-11-04-v2', locale: 'en-US' })
    ).resolves.toEqual({ kind: 'rejected', reason: 'redeliver-edition-mismatch' })
  })

  it('opens only the phone surface', async () => {
    const { runtime, state } = createRuntime({ push: async () => ({ ok: true }) })
    await runtime.submit({ ...submitRequest, deliver: false })
    const record = state().records[0]
    await expect(
      runtime.redeliverPush({
        recordId: record.id,
        editionId: 'brief-2026-11-04-v2',
        locale: 'zh-CN',
        surface: 'desktop'
      })
    ).resolves.toEqual({ kind: 'rejected', reason: 'redeliver-surface-invalid' })
  })

  it('names the two channel reasons instead of a generic failure', async () => {
    const noChannel = createRuntime({
      settings: { push: { channelId: null } },
      push: async () => ({ ok: true })
    })
    await noChannel.runtime.submit({ ...submitRequest, deliver: false })
    const noChannelRecord = noChannel.state().records[0]
    await expect(
      noChannel.runtime.redeliverPush({
        recordId: noChannelRecord.id,
        editionId: 'brief-2026-11-04-v2',
        locale: 'zh-CN'
      })
    ).resolves.toEqual({ kind: 'rejected', reason: 'channel-missing' })

    const paused = createRuntime({ push: async () => ({ ok: true }), pausedUntil: '2026-11-04T01:00:00.000Z' })
    await paused.runtime.submit({ ...submitRequest, deliver: false })
    const pausedRecord = paused.state().records[0]
    await expect(
      paused.runtime.redeliverPush({
        recordId: pausedRecord.id,
        editionId: 'brief-2026-11-04-v2',
        locale: 'zh-CN'
      })
    ).resolves.toEqual({ kind: 'rejected', reason: 'push-paused' })
  })
})
