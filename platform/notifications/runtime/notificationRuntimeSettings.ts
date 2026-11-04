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
  /** 整段变更排进 runtime 的队列：订阅与记录同一份 JSON，绕开队列就会互相覆盖。 */
  exclusive: <T>(operation: () => Promise<T>) => Promise<T>
  persistWithDiagnostics: (state: NotificationStoreState) => Promise<void>
  notifyChanged: () => void
}

export function createNotificationSettingsSurface(input: NotificationSettingsSurfaceInput) {
  return {
    async listEventCatalog(): Promise<readonly NotificationEventCatalogEntry[]> {
      return input.getCatalog()?.list() ?? []
    },

    /** 桌面开关：新装默认关，读者打开那一刻才请求系统授权（契约 §5.1）。 */
    async setDesktopEnabled(enabled: boolean): Promise<{ desktopEnabled: boolean }> {
      if (!input.updateSettings) throw new Error('notification-settings-update-not-configured')
      await input.updateSettings({ desktopEnabled: enabled })
      return { desktopEnabled: enabled }
    },

    /**
     * 情报三条「推不推手机」的**唯一写入口**（契约 §5.4）：
     * 只接受批准含 `channel` 的那三个 id，写别的 id **报错**，不静默忽略——静默忽略会让
     * 调用方以为存上了。与记录、两个总开关同一份 JSON，不另建设置文件。
     */
    async setChannelEvent(eventId: string, enabled: boolean): Promise<{ eventId: string; enabled: boolean }> {
      if (!input.updateSettings) throw new Error('notification-settings-update-not-configured')
      const entry = input.getCatalog()?.get(eventId)
      if (!entry || !entry.approvedDisruptionLevels.includes('channel')) {
        throw new Error(`notification-channel-event-not-allowed: ${eventId}`)
      }
      const settings = await input.getSettings()
      await input.updateSettings({
        channelEvents: { ...(settings.channelEvents ?? {}), [eventId]: enabled }
      })
      return { eventId, enabled }
    },

    /** 读回那张三条表：没写过的按默认（开）——「装上就推，不想收再去关」。 */
    async getChannelEvents(): Promise<Readonly<Record<string, boolean>>> {
      const settings = await input.getSettings()
      const events = settings.channelEvents ?? {}
      return Object.freeze({ ...events })
    },

    /** 设置页首帧要的几个当前值：提示开关、桌面开关、通道接线状态（契约 §5.2）。 */
    async getDeliverySettings(): Promise<{
      toastEnabled: boolean
      desktopEnabled: boolean
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
        desktopEnabled: settings.desktopEnabled,
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

  }
}

/**
 * 设置面的**装配**（从 runtime 搬出来只为体积门禁）。
 *
 * 这里仍然只有一份设置面：唯一写入口还是 `updateSettings`，runtime 不另外整份重写设置，
 * 所以搬出来不会多出第二个写入方（契约 §5.1）。
 */
export function composeNotificationSettingsSurface(
  deps: {
    catalog?: NotificationEventCatalog
    getSettings: () => Promise<NotificationRuntimeSettings>
    updateSettings?: (patch: Partial<NotificationRuntimeSettings>) => Promise<void>
    getPushTargets?: () => Promise<readonly unknown[]>
    pushWired?: () => boolean
  },
  internals: Pick<
    NotificationSettingsSurfaceInput,
    'load' | 'exclusive' | 'persistWithDiagnostics' | 'notifyChanged'
  >
) {
  return createNotificationSettingsSurface({
    getCatalog: () => deps.catalog,
    getSettings: deps.getSettings,
    updateSettings: deps.updateSettings,
    getPushTargets: deps.getPushTargets,
    pushWired: deps.pushWired,
    ...internals
  })
}
