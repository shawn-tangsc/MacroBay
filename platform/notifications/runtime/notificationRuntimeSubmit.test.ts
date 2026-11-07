import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog, type NotificationEventPolicy } from '../contracts/notificationEventCatalog'
import type {
  NotificationDiagnosticsEntry,
  NotificationRuntimeSettings,
  NotificationSubmitRequest
} from '../contracts/notificationContracts'
import { createNotificationRuntime, type NotificationStorage } from './notificationRuntime'

const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: null },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}
const clock = { now: () => new Date('2026-11-03T00:00:00.000Z'), timeZone: () => 'UTC' }

const policy: NotificationEventPolicy = {
  'platform.failed': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'platform.done': { approvedDisruptionLevels: ['center', 'desktop'], approvedBypassQuietHours: false },
  'platform.merge-a': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.merge-b': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.merge-c': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'platform.capped': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false },
  'market-intelligence.source.consecutive-failed': { approvedDisruptionLevels: ['center'], approvedBypassQuietHours: false }
}

const catalog = createNotificationEventCatalog({
  policy,
  sources: [
    {
      productId: 'market-intelligence',
      events: [
        {
          id: 'market-intelligence.source.consecutive-failed',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'source:{sourceId}',
          dedupeUnit: 'occurrence',
        }
      ]
    },
    {
      productId: 'platform',
      events: [
        {
          id: 'platform.failed',
          titleKey: 'notification.taskFailed.title',
          bodyKey: 'notification.taskFailed.body',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['desktop'],
          dedupeKeyTemplate: 'failed:{id}:{date}',
          dedupeUnit: 'condition',
          conditionWindowMs: 86_400_000,
        },
        {
          id: 'platform.done',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: ['desktop'],
          dedupeKeyTemplate: 'done:{date}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.merge-a',
          titleKey: 'notification.taskFailed.title',
          bodyKey: 'notification.taskFailed.body',
          reasonKey: 'notification.taskFailed.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'shared:{id}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.merge-b',
          titleKey: 'notification.test.title',
          bodyKey: 'notification.aggregate.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'shared:{id}',
          dedupeUnit: 'occurrence',
        },
        {
          id: 'platform.capped',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'capped:{id}',
          dedupeUnit: 'occurrence',
          dailyLimit: 1
        },
        {
          id: 'platform.merge-c',
          titleKey: 'notification.test.title',
          reasonKey: 'notification.test.body',
          requiresUserAction: false,
    category: 'reminder',
          requestedDisruptionLevels: [],
          dedupeKeyTemplate: 'shared:{id}',
          dedupeUnit: 'occurrence',
        }
      ]
    }
  ]
})

function createRuntime(
  initial?: unknown,
  extra: {
    producerOwnership?: Record<string, 'platform' | { productId: string }>
    productIds?: readonly string[]
  } = {}
) {
  let state: any = initial ?? { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => {
      state = JSON.parse(JSON.stringify(next))
    }
  }
  const diagnostics: string[] = []
  const diagnosticEntries: NotificationDiagnosticsEntry[] = []
  const runtime = createNotificationRuntime({
    storage,
    catalog,
    diagnostics: (entry) => {
      diagnostics.push(entry.code)
      diagnosticEntries.push(entry)
    },
    ...(extra.producerOwnership === undefined ? {} : { producerOwnership: extra.producerOwnership }),
    ...(extra.productIds === undefined ? {} : { productIds: extra.productIds }),
    getSettings: async () => settings,
    clock
  })
  return { runtime, state: () => state, diagnostics, diagnosticEntries }
}

function request(overrides: Partial<NotificationSubmitRequest> = {}): NotificationSubmitRequest {
  return {
    eventTypeId: 'platform.failed',
    dedupeVars: { builder: 'template', vars: { id: 'job-1', date: '2026-11-03' } },
    // 标题模板里有 `{taskName}`：生产者提交时一定带参数，缺了整条会降级成兜底句（N24①）。
    titleParams: { taskName: 'job-1' },
    actions: [],
    occurredAt: '2026-11-03T00:00:00.000Z',
    ...overrides
  }
}

describe('notification runtime submit', () => {
  it('rejects an unregistered event type without writing a row', async () => {
    const { runtime, state } = createRuntime()
    await expect(runtime.submit(request({ eventTypeId: 'platform.nope' }))).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'unknown-event-type'
    })
    expect(state().records).toHaveLength(0)
  })

  it('still records a completion event: there is no "not subscribed" suppression any more', async () => {
    // 订阅层 2026-11-04 撤销：完成类不再因为「没勾」被丢掉，中心恒记一条。
    const { runtime, state } = createRuntime()
    const outcome = await runtime.submit(
      request({ eventTypeId: 'platform.done', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } } })
    )
    expect(outcome).toMatchObject({ kind: 'accepted' })
    expect(state().records).toHaveLength(1)
  })

  it('records a completion event with the center surface, whatever the switches say', async () => {
    const { runtime, state } = createRuntime({
      records: [],
      dailyCounters: {},
      pushBackoff: {}
    })
    const outcome = await runtime.submit(
      request({ eventTypeId: 'platform.done', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } } })
    )
    expect(outcome).toMatchObject({ kind: 'accepted' })
    expect(state().records).toHaveLength(1)
    // 两个本机表面互斥：排了桌面就不再排提示。
    expect(state().records[0]?.delivery.toast).toBeUndefined()
  })

  it('T27: merges two event types under one key, keeping title/actions of the first and body of the latest', async () => {
    const { runtime, state } = createRuntime()
    const first = await runtime.submit(
      request({ eventTypeId: 'platform.merge-a', dedupeVars: { builder: 'template', vars: { id: 'x' } } })
    )
    expect(first.kind).toBe('accepted')

    const second = await runtime.submit(
      request({ eventTypeId: 'platform.merge-b', dedupeVars: { builder: 'template', vars: { id: 'x' } } })
    )
    expect(second).toMatchObject({
      kind: 'merged',
      occurrenceCount: 1,
      mergedEventTypes: ['platform.merge-a', 'platform.merge-b']
    })
    expect(state().records).toHaveLength(1)
    const record = state().records[0]
    expect(record.titleKey).toBe('notification.taskFailed.title')
    expect(record.bodyKey).toBe('notification.aggregate.title')
  })

  it('T28: a later submission without a body keeps the existing body', async () => {
    const { runtime, state } = createRuntime()
    await runtime.submit(
      request({ eventTypeId: 'platform.merge-b', dedupeVars: { builder: 'template', vars: { id: 'y' } } })
    )
    await runtime.submit(
      request({ eventTypeId: 'platform.merge-c', dedupeVars: { builder: 'template', vars: { id: 'y' } } })
    )
    expect(state().records[0].bodyKey).toBe('notification.aggregate.title')
  })

  it('S10: a claimed producer is delegated to its product, with one diagnostic', async () => {
    const { runtime, state, diagnostics } = createRuntime(undefined, {
      producerOwnership: { 'market-intelligence.dailyBriefing': { productId: 'market-intelligence' } },
      productIds: ['market-intelligence']
    })
    await expect(
      runtime.submit(request({ producerId: 'market-intelligence.dailyBriefing' }))
    ).resolves.toMatchObject({
      kind: 'delegated',
      producerId: 'market-intelligence.dailyBriefing',
      ownerProductId: 'market-intelligence'
    })
    expect(state().records).toHaveLength(0)
    expect(diagnostics).toEqual(['delegated'])
  })

  it('S10: a product-prefixed unclaimed producer is sent by the platform and diagnosed once', async () => {
    const { runtime, diagnostics } = createRuntime(undefined, { productIds: ['market-intelligence'] })
    await runtime.submit(request({ producerId: 'market-intelligence.new-job' }))
    await runtime.submit(request({ producerId: 'market-intelligence.new-job', dedupeVars: { builder: 'template', vars: { id: 'job-2', date: '2026-11-04' } } }))
    expect(diagnostics).toEqual(['unclaimed-producer'])
  })

  it('S10: a claimed producer does not swallow the product own event', async () => {
    const { runtime, state, diagnostics } = createRuntime(undefined, {
      producerOwnership: { 'market-intelligence.dailyBriefing': { productId: 'market-intelligence' } },
      productIds: ['market-intelligence']
    })
    const outcome = await runtime.submit({
      eventTypeId: 'market-intelligence.source.consecutive-failed',
      producerId: 'market-intelligence.dailyBriefing',
      dedupeVars: { builder: 'template', vars: { sourceId: 'macro' } },
      actions: [],
      occurredAt: '2026-11-03T00:00:00.000Z'
    })
    expect(outcome.kind).toBe('accepted')
    expect(state().records).toHaveLength(1)
    expect(diagnostics).toEqual([])
  })

  it('S10: a handler with no product prefix is platform-owned and never diagnosed', async () => {
    const { runtime, diagnostics } = createRuntime()
    await runtime.submit(request({ producerId: 'assistant.sessionRetention' }))
    expect(diagnostics).toEqual([])
  })

  it('T19: with the desktop switch off the event still lands in the center, without a desktop delivery', async () => {
    const { runtime, state } = createRuntime({ settings: { desktopEnabled: false } })
    await expect(
      runtime.submit(
        request({ eventTypeId: 'platform.done', dedupeVars: { builder: 'template', vars: { date: '2026-11-03' } } })
      )
    ).resolves.toMatchObject({ kind: 'accepted' })
    expect(state().records[0]?.delivery.desktop).toBeUndefined()
  })
})

/**
 * 被拒留痕（第 10 条同类问题的第二次，2026-11-08）：调用方普遍 `catch {}` 或丢弃返回值，
 * 被拒的那一次原本在日志、记录、计数三处都查不到。这里钉三件事：记不记、记几条、什么级别。
 */
describe('notification runtime: a refusal leaves exactly one trace', () => {
  it('S37①: an unregistered event type is refused and leaves one error-level line, carrying only the event id and the reason', async () => {
    const { runtime, state, diagnosticEntries } = createRuntime()
    await expect(runtime.submit(request({ eventTypeId: 'platform.nope' }))).resolves.toMatchObject({
      kind: 'rejected',
      reason: 'unknown-event-type'
    })
    expect(diagnosticEntries).toHaveLength(1)
    expect(diagnosticEntries[0]).toMatchObject({
      code: 'unknown-event-type',
      level: 'error',
      eventTypeId: 'platform.nope'
    })
    // 只留痕、不改行为：拒收不建记录。
    expect(state().records).toHaveLength(0)
  })

  it('S37②: the entry stopped by the daily cap folds into today last record instead of logging a refusal', async () => {
    const { runtime, state, diagnosticEntries } = createRuntime()
    const first = await runtime.submit(
      request({ eventTypeId: 'platform.capped', dedupeVars: { builder: 'template', vars: { id: 'a' } } })
    )
    expect(first).toMatchObject({ kind: 'accepted' })

    const second = await runtime.submit(
      request({ eventTypeId: 'platform.capped', dedupeVars: { builder: 'template', vars: { id: 'b' } } })
    )
    // 折叠不是「被拒」：记录里有痕（`lastSuppressedReason`），日志里不该再有一条——两个痕迹就是两套说法。
    expect(second).toMatchObject({ kind: 'merged', occurrenceCount: 2 })
    expect(diagnosticEntries).toEqual([])
    expect(state().records).toHaveLength(1)
    expect(state().records[0]?.safeMetadata.lastSuppressedReason).toBe('daily-limit-reached')
  })

  it('S37③: one submission leaves one line, not zero and not two', async () => {
    const { runtime, diagnosticEntries } = createRuntime()
    await runtime.submit(request({ eventTypeId: 'platform.nope' }))
    await runtime.submit(request({ eventTypeId: 'platform.nope' }))
    expect(diagnosticEntries.map((entry) => entry.code)).toEqual(['unknown-event-type', 'unknown-event-type'])
  })
})
