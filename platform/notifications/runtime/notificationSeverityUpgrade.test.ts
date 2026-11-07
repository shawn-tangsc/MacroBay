/**
 * 严重度升级再投递（契约 v2.45 §16.3.4 / 验收 N31）。
 *
 * 核心判据一条：**严格高于记录上已推送过的最高值才再推一次**。它是状态，不是计数器——
 * 所以 `medium → high → medium → high` 只多推一次，而不是按次数或按「一天一次」算。
 *
 * 同一条用例里还钉住三件容易混的东西：`signalSeverity` 不等于展示用的 `NotificationSeverity`；
 * 记录上的 `severity` 不再是写死的 `info`；非法档位（`critical`）当场拒收、不落记录。
 */
import { describe, expect, it } from 'vitest'

import {
  createDefaultNotificationRuntimeSettings,
  type NotificationRuntimeSettings,
  type NotificationSubmitRequest
} from '../contracts/notificationContracts'
import { createNotificationEventCatalog } from '../contracts/notificationEventCatalog'
import { createDefaultNotificationStoreState } from '../store/notificationStore'
import { createNotificationRuntime } from './notificationRuntime'

const clock = { now: () => new Date('2026-11-06T12:00:00.000Z'), timeZone: () => 'UTC' }

function catalogFor(dedupeUnit: 'condition' | 'occurrence') {
  return createNotificationEventCatalog({
    policy: {
      'platform.signal': { approvedDisruptionLevels: ['center', 'channel'], approvedBypassQuietHours: false }
    },
    sources: [
      {
        productId: 'platform',
        events: [
          {
            id: 'platform.signal',
            titleKey: 'notification.taskFailed.title',
            bodyKey: 'notification.taskFailed.body',
            reasonKey: 'notification.taskFailed.body',
            requiresUserAction: false,
            category: 'reminder',
            requestedDisruptionLevels: ['channel'],
            dedupeKeyTemplate: 'signal:{id}',
            dedupeUnit,
            ...(dedupeUnit === 'condition' ? { conditionWindowMs: 7_200_000 } : {})
          }
        ]
      }
    ]
  })
}

function harness(options: {
  dedupeUnit?: 'condition' | 'occurrence'
  pushOk?: boolean
  channelEvents?: Readonly<Record<string, boolean>>
} = {}) {
  const pushes: { title: string; highestSeverity?: string }[] = []
  const state = createDefaultNotificationStoreState()
  const settings: NotificationRuntimeSettings = {
    ...createDefaultNotificationRuntimeSettings(),
    // 旧字段留空：升级路径必须走派生入口（技术方案 §1），读它就会一条也发不出去。
    push: { channelId: null },
    ...(options.channelEvents === undefined ? {} : { channelEvents: options.channelEvents })
  }
  let sequence = 0
  const resolvePushChannelFromSettings = async () => ({
    ok: true as const,
    channelId: 'channel-a',
    channelName: 'channel-a'
  })
  const runtime = createNotificationRuntime({
    resolvePushChannel: resolvePushChannelFromSettings,
    diagnostics: () => undefined,
    storage: {
      read: async () => JSON.parse(JSON.stringify(state)),
      write: async (next) => { Object.assign(state, next) }
    },
    catalog: catalogFor(options.dedupeUnit ?? 'condition'),
    getSettings: async () => settings,
    clock,
    getLanguage: async () => 'zh-CN',
    deliveryHooks: {
      push: async (_record, content) => {
        pushes.push({ title: content.title })
        return options.pushOk === false ? { ok: false, reason: 'channel-rejected' } : { ok: true, messageId: `m-${++sequence}` }
      }
    }
  })
  return { runtime, pushes, settings, records: () => state.records }
}

function submit(
  runtime: ReturnType<typeof harness>['runtime'],
  overrides: Partial<NotificationSubmitRequest> = {}
): Promise<unknown> {
  return runtime.submit({
    eventTypeId: 'platform.signal',
    producerId: 'platform',
    dedupeVars: { builder: 'template', vars: { id: 'oi-btc' } },
    titleParams: { taskName: 'BTC 持仓骤降' },
    actions: [],
    occurredAt: '2026-11-06T11:00:00.000Z',
    ...overrides
  })
}

describe('严重度升级再投递', () => {
  it('medium → high → medium → high 只多推一次（封顶靠级数，不靠计数）', async () => {
    const { runtime, pushes, records } = harness()

    await submit(runtime, { signalSeverity: 'medium' })
    await submit(runtime, { signalSeverity: 'high' })
    // 降级：不是新事实，不推。
    await submit(runtime, { signalSeverity: 'medium' })
    // 回到 high：没有超过「已推过的 high」，不推——这正是计数器做不到的那件事。
    await submit(runtime, { signalSeverity: 'high' })

    expect(pushes).toHaveLength(2)
    const record = records()[0]
    // 合并、不新建行；次数照常累加。
    expect(records()).toHaveLength(1)
    expect(record?.occurrenceCount).toBe(4)
    expect(record?.delivery.push?.highestSeverity).toBe('high')
    expect(record?.delivery.push?.state).toBe('sent-accepted')
  })

  // 事件级开关落在两个地方：规划层不排手机、投递层兜住升级与重投。这里验的是后者——
  // 严重度升级不经过规划，若只在规划层判，读者关掉之后仍会被这条高等级再推一次。
  it('等级再高也不越过读者关掉的事件开关', async () => {
    const { runtime, pushes, settings, records } = harness()
    await submit(runtime, { signalSeverity: 'medium' })
    expect(pushes).toHaveLength(1)

    // 读者把这条事件关掉，随后同一件事升级：这条升级不经过规划层。
    settings.channelEvents = { 'platform.signal': false }
    await submit(runtime, { signalSeverity: 'high' })

    expect(pushes).toHaveLength(1)
    expect(records()).toHaveLength(1)
    // 「读者选择不推」不是一次失败：不写新的 push 状态，最高已推级也停在 medium。
    expect(records()[0]?.delivery.push?.highestSeverity).toBe('medium')
  })

  it('同级第二次不推：medium 之后再 medium 没有新事实', async () => {
    const { runtime, pushes } = harness()
    await submit(runtime, { signalSeverity: 'medium' })
    await submit(runtime, { signalSeverity: 'medium' })
    expect(pushes).toHaveLength(1)
  })

  it('occurrence 事件不开这个口子：一次一条就够了', async () => {
    const { runtime, pushes } = harness({ dedupeUnit: 'occurrence' })
    await submit(runtime, { signalSeverity: 'medium' })
    await submit(runtime, { signalSeverity: 'high' })
    expect(pushes).toHaveLength(1)
  })

  it('手动路径不走升级：deliver: false 只落记录', async () => {
    const { runtime, pushes } = harness()
    await submit(runtime, { signalSeverity: 'medium' })
    await submit(runtime, { signalSeverity: 'high', deliver: false })
    expect(pushes).toHaveLength(1)
  })

  it('推送失败不抬 highestSeverity：没真正告诉读者就不算', async () => {
    const { runtime, records } = harness({ pushOk: false })
    await submit(runtime, { signalSeverity: 'high' })
    expect(records()[0]?.delivery.push?.state).toBe('failed')
    expect(records()[0]?.delivery.push?.highestSeverity).toBeUndefined()
  })

  it('critical 不属于信号严重度：拒收、具名原因、不落记录', async () => {
    const { runtime, records, pushes } = harness()
    const outcome = await submit(runtime, { signalSeverity: 'critical' as never })

    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'invalid-signal-severity' })
    expect(records()).toHaveLength(0)
    expect(pushes).toHaveLength(0)
  })

  it('记录上的 severity 来自请求，不再是写死的 info', async () => {
    const { runtime, records } = harness()
    await submit(runtime, { signalSeverity: 'low', severity: 'warning' })
    expect(records()[0]?.severity).toBe('warning')
  })
})
