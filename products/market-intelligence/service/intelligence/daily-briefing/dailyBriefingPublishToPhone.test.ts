import { describe, expect, it } from 'vitest'

import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import type { NotificationRuntimeSettings } from '@platform/notifications/contracts/notificationContracts'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import { createNotificationRuntime, type NotificationStorage } from '@platform/notifications/runtime/notificationRuntime'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { publishBriefingToPhone, type BriefingPublishDeps } from './dailyBriefingPublishToPhone'

/**
 * 「发布这一版」的两步：**先写/更新当天的完成记录，再推那一条**。
 *
 * 这就是用户 2026-11-05 看到的那个失败的真因：库里根本没有 `briefing.ready` 记录（生产装配后来才接上），
 * 于是平台回 `redeliver-target-missing`，读者看到一句「这一版还没进通知」。所以第一条用例从
 * **空库**开始：点一次，记录出现、手机收到一次；第二次点不再多一行，但仍会再推一次。
 */

const NOW = '2026-11-05T09:30:00.000Z'
const DATE = '2026-11-05'
const input = Object.freeze({ date: DATE, locale: 'zh-CN' as const, periodId: 'default' })

const settings: NotificationRuntimeSettings = {
  desktopEnabled: true,
  toastEnabled: false,
  popupEnabled: false,
  push: { channelId: 'telegram' },
  retentionDays: 30,
  defaultSnoozeMinutes: 60
}

type StoreState = { records: Array<Record<string, unknown>>; dailyCounters: Record<string, unknown>; subscriptions: Record<string, unknown>; pushBackoff: Record<string, unknown> }

function runtimeWithPush(options: { channels?: 'one' | 'none' } = {}) {
  let state: StoreState = { records: [], dailyCounters: {}, subscriptions: {}, pushBackoff: {} }
  let pushes = 0
  const storage: NotificationStorage = {
    read: async () => JSON.parse(JSON.stringify(state)),
    write: async (next) => { state = JSON.parse(JSON.stringify(next)) as StoreState }
  }
  const runtime = createNotificationRuntime({
    storage,
    catalog: createNotificationEventCatalog({
      // 产品事件（日报已生成）的批准值：各读各的。
      sources: [
        { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
        { productId: 'market-intelligence', events: marketIntelligenceProductManifest.notificationEvents, approval: marketIntelligenceProductManifest.notificationApproval }
      ]
    }),
    diagnostics: () => undefined,
    // 目标通道由唯一派生入口给出（技术方案 §1）：夹具给「恰好一条 runtime-ready」，与生产同形。
    resolvePushChannel: async () => (options.channels === 'none'
      ? { ok: false as const, reason: 'push-unavailable' as const, enabledChannelCount: 0, multiple: false }
      : { ok: true as const, channelId: 'telegram', channelName: 'Telegram · test' }),
    getSettings: async () => settings,
    clock: { now: () => new Date(NOW), timeZone: () => 'UTC' },
    productIds: ['market-intelligence'],
    deliveryHooks: {
      push: async () => {
        pushes += 1
        return { ok: true, messageId: `m-${pushes}` }
      }
    }
  })
  return {
    submit: (request: Parameters<typeof runtime.submit>[0]) => runtime.submit(request),
    redeliver: (payload: { recordId: string; editionId: string; locale: string }) => runtime.redeliverPush(payload),
    records: () => state.records,
    pushes: () => pushes
  }
}

describe('publish to phone: write the record first, then push it', () => {
  it('fails closed with no runtime-ready channel: rejected, reason push-unavailable', async () => {
    const bare = runtimeWithPush({ channels: 'none' })
    const outcome = await publishBriefingToPhone({
      readEdition: async () => ({ document: { lede: { text: '今天的主导事件是…' } } }),
      submit: bare.submit,
      redeliver: bare.redeliver,
      now: () => NOW
    }, input)
    // 0 条 runtime-ready 通道 = 配置事实：这条发布入口自己先拦（`channel-missing`），
    // 运行时那一层的 `push-unavailable` 由 `pushTargetDerivation.test.ts` 钉住。
    expect(outcome).toMatchObject({ kind: 'rejected', reason: 'channel-missing' })
    expect(bare.pushes()).toBe(0)
  })

  it('publishes from an empty library: one record appears and the phone receives it once', async () => {
    const runtime = runtimeWithPush()
    const outcome = await publishBriefingToPhone({
      readEdition: async () => ({ document: { lede: { text: '今天的主导事件是…' } } }), submit: runtime.submit, redeliver: runtime.redeliver, now: () => NOW
    }, input)

    expect(outcome).toMatchObject({ kind: 'accepted', delivery: { state: 'sent-accepted' } })
    expect(runtime.pushes()).toBe(1)
    expect(runtime.records()).toHaveLength(1)
    expect(runtime.records()[0]).toMatchObject({
      eventTypeId: 'market-intelligence.briefing.ready',
      dedupeKey: `market-intelligence|briefing-ready:${DATE}:default:zh-CN`,
      edition: { editionId: `${DATE}:zh-CN:default`, locale: 'zh-CN' },
      // 手动那条也要带导读：从这一版的 document 取，不是只写一条空记录。
      rendered: { 'zh-CN': { body: expect.stringContaining('今天的主导事件是…') } }
    })
  })

  it('pressing again keeps one row and pushes again', async () => {
    const runtime = runtimeWithPush()
    const deps = { readEdition: async () => ({ document: { lede: { text: '今天的主导事件是…' } } }), submit: runtime.submit, redeliver: runtime.redeliver, now: () => NOW }
    await publishBriefingToPhone(deps, input)
    const first = runtime.records()[0]
    const again = await publishBriefingToPhone(deps, input)

    expect(again).toMatchObject({ kind: 'accepted' })
    expect(runtime.records()).toHaveLength(1)
    expect(runtime.pushes()).toBe(2)
    // 只动投递；次数与创建时间不动。
    expect(runtime.records()[0]).toMatchObject({
      id: first?.id,
      createdAt: first?.createdAt,
      occurrenceCount: first?.occurrenceCount
    })
  })

  it('refuses an edition that is not generated: no record, no push', async () => {
    const runtime = runtimeWithPush()
    const outcome = await publishBriefingToPhone({
      readEdition: async () => undefined, submit: runtime.submit, redeliver: runtime.redeliver, now: () => NOW
    }, input)

    expect(outcome).toEqual({ kind: 'rejected', reason: 'edition-missing' })
    expect(runtime.records()).toHaveLength(0)
    expect(runtime.pushes()).toBe(0)
  })

  it('does not write a record when the platform cannot re-push it', async () => {
    const runtime = runtimeWithPush()
    const outcome = await publishBriefingToPhone({
      readEdition: async () => ({ document: { lede: { text: '今天的主导事件是…' } } }), submit: runtime.submit, redeliver: undefined, now: () => NOW
    }, input)

    expect(outcome).toEqual({ kind: 'rejected', reason: 'runtime-unavailable' })
    expect(runtime.records()).toHaveLength(0)
  })

  it('does not claim a push when the submit gave back no record', async () => {
    // 没有回执就没有可推的东西：这一档必须落「没推出去」，不许假装推了（用户 11-05 的原症状）。
    const runtime = runtimeWithPush()
    const outcome = await publishBriefingToPhone({
      readEdition: async () => ({ document: { lede: { text: '今天的主导事件是…' } } }), submit: undefined, redeliver: runtime.redeliver, now: () => NOW
    }, input)

    expect(outcome).toEqual({ kind: 'rejected', reason: 'runtime-unavailable' })
    expect(runtime.pushes()).toBe(0)
  })
})
