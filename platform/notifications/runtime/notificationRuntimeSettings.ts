/**
 * runtime 的设置面（契约 §5.1 / §5.2）：目录投影、订阅读写、投递设置。
 *
 * 从 `notificationRuntime.ts` 拆出来是为了体积门禁，也是为了**单一路径**看得清：
 * 这些方法都只经由注入的 `load` / `persistWithDiagnostics` 改同一份 state——订阅与记录
 * 住在同一个 JSON，谁都不许绕开 runtime 自己写。
 */
import type {
  NotificationEventCatalog,
  NotificationEventCatalogEntry
} from '../contracts/notificationEventCatalog'
import {
  applySubscriptionPatch,
  type NotificationSubscription,
  type NotificationSubscriptionPatch,
  type NotificationSubscriptionTable
} from '../contracts/notificationSubscriptions'
import type { NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationStoreState } from '../store/notificationStore'

export type NotificationSettingsSurfaceInput = {
  getCatalog: () => NotificationEventCatalog | undefined
  getSettings: () => Promise<NotificationRuntimeSettings>
  updateSettings?: (patch: Partial<NotificationRuntimeSettings>) => Promise<void>
  getPushTargets?: () => Promise<readonly unknown[]>
  /** 端口真的装配好才为 true；不再读一个永远 false 的常量。 */
  pushWired?: () => boolean
  load: () => Promise<NotificationStoreState>
  persistWithDiagnostics: (state: NotificationStoreState) => Promise<void>
  notifyChanged: () => void
}

export function createNotificationSettingsSurface(input: NotificationSettingsSurfaceInput) {
  return {
    async listEventCatalog(): Promise<readonly NotificationEventCatalogEntry[]> {
      return input.getCatalog()?.list() ?? []
    },

    async getSubscriptions(): Promise<NotificationSubscriptionTable> {
      return (await input.load()).subscriptions
    },

    /**
     * 订阅写入的**唯一入口**（契约 §5.1）：订阅与记录在同一份 JSON，绕开 runtime 直接写
     * 文件就会和记录互相覆盖。产品内入口只许写自己前缀的行；通用设置页传 `'platform'`。
     */
    async setSubscription(
      eventTypeId: string,
      patch: NotificationSubscriptionPatch,
      actor: 'platform' | { productId: string } = 'platform'
    ): Promise<{ ok: true; subscription: NotificationSubscription | null } | { ok: false; reasonCode: string }> {
      const entry = input.getCatalog()?.get(eventTypeId)
      if (!entry) return { ok: false, reasonCode: 'unknown-event-type' }
      if (actor !== 'platform' && !eventTypeId.startsWith(`${actor.productId}.`)) {
        return { ok: false, reasonCode: 'scope-mismatch' }
      }
      const state = await input.load()
      const result = applySubscriptionPatch(entry, patch, state.subscriptions[eventTypeId])
      if (!result.ok) return { ok: false, reasonCode: result.reasonCode }
      const subscriptions: Record<string, NotificationSubscription> = { ...state.subscriptions }
      if (result.subscription === null) delete subscriptions[eventTypeId]
      else subscriptions[eventTypeId] = result.subscription
      await input.persistWithDiagnostics({ ...state, subscriptions })
      input.notifyChanged()
      return result
    },

    /** 设置页首帧要的三个当前值：提示开关、通道选择、通道接线状态（契约 §5.2）。 */
    async getDeliverySettings(): Promise<{
      toastEnabled: boolean
      channelId: string | null
      pushWired: boolean
      channels: readonly unknown[]
      lastPushFailureAt: string | null
      lastPushFailureReason: string | null
    }> {
      const settings = await input.getSettings()
      const state = await input.load()
      // U3 的「最近一次推送失败（含时刻）」：从已存记录里取，不给 pushBackoff 加字段。
      let lastPushFailureAt: string | null = null
      let lastPushFailureReason: string | null = null
      for (const record of state.records) {
        const push = record.delivery.push
        if (push?.state !== 'failed') continue
        if (lastPushFailureAt === null || push.at > lastPushFailureAt) {
          lastPushFailureAt = push.at
          // 原因与时刻取自**同一条记录**：拼两处的值会得到「这条的时刻 + 那条的原因」。
          lastPushFailureReason = push.reason ?? null
        }
      }
      return {
        toastEnabled: settings.toastEnabled,
        channelId: settings.push.channelId,
        pushWired: input.pushWired?.() ?? false,
        channels: (await input.getPushTargets?.()) ?? [],
        lastPushFailureAt,
        lastPushFailureReason
      }
    },

    async setToastEnabled(enabled: boolean): Promise<{ toastEnabled: boolean }> {
      if (!input.updateSettings) throw new Error('notification-settings-update-not-configured')
      await input.updateSettings({ toastEnabled: enabled })
      return { toastEnabled: enabled }
    },

    async setPushChannel(channelId: string | null): Promise<{ channelId: string | null }> {
      if (!input.updateSettings) throw new Error('notification-settings-update-not-configured')
      await input.updateSettings({ push: { channelId } })
      return { channelId }
    }
  }
}
