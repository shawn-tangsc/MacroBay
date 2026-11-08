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
import {
  isSurfaceAvailable,
  resolveSurfaceSelection,
  SELECTABLE_SURFACES,
  surfaceGroupMembers,
  type NotificationSurfaceSelection,
  type SelectableSurface
} from '../contracts/notificationSurfaceSelection'
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

    /**
     * 读一条通知（或一个组）的表面选择（契约 §5.5 第三层）。
     *
     * 键是**组键**（同一件事的两条共用一份）或事件 id；返回值里带上「可用面」与「是否冲突」，
     * 页面据此只画能画的勾、并在冲突时说清「今天先按都关」——**页面不自己判三层**。
     */
    async getSurfaceSelection(eventTypeId: string): Promise<{
      key: string
      available: readonly SelectableSurface[]
      selection: NotificationSurfaceSelection
      conflict: boolean
    }> {
      const entry = input.getCatalog()?.get(eventTypeId)
      if (!entry) throw new Error(`notification-surface-event-unknown: ${eventTypeId}`)
      const settings = await input.getSettings()
      const list = () => input.getCatalog()?.list() ?? []
      const resolved = resolveSurfaceSelection({
        entry,
        list,
        selections: settings.surfaceSelections ?? {}
      })
      const members = entry.surfaceGroup === undefined ? [entry] : surfaceGroupMembers(entry.surfaceGroup, list)
      return {
        key: entry.surfaceGroup ?? entry.id,
        available: SELECTABLE_SURFACES.filter((surface) => isSurfaceAvailable(surface, members)),
        selection: resolved.selection,
        conflict: resolved.conflict
      }
    },

    /**
     * 写一份表面选择（契约 §5.5）。**一次只写一个键**：有组写组键，没组写事件 id。
     *
     * 三种情况报错、不静默忽略：事件不存在、某条成员没批这个面（越权）、组里没有任何成员。
     * 组写到一个键上，所以「一条写了、另一条没写」这种半次写入**不可能**发生——
     * 历史数据里各存一份的旧形状由读端按「都关 + 诊断」兜住。
     */
    async setSurfaceSelection(eventTypeId: string, selection: NotificationSurfaceSelection): Promise<{
      key: string
      selection: NotificationSurfaceSelection
    }> {
      if (!input.updateSettings) throw new Error('notification-settings-update-not-configured')
      const entry = input.getCatalog()?.get(eventTypeId)
      if (!entry) throw new Error(`notification-surface-event-unknown: ${eventTypeId}`)
      const list = () => input.getCatalog()?.list() ?? []
      const members = entry.surfaceGroup === undefined ? [entry] : surfaceGroupMembers(entry.surfaceGroup, list)
      const key = entry.surfaceGroup ?? entry.id

      for (const [surface, wanted] of Object.entries(selection)) {
        if (wanted !== true) continue
        // 没批的面不许写进来：写进来读端也会夹掉，但那样调用方会以为存上了。
        if (!isSurfaceAvailable(surface, members)) {
          throw new Error(`notification-surface-not-approved: ${key}:${surface}`)
        }
      }

      const current = await input.getSettings()
      const stored: NotificationSurfaceSelection = Object.freeze({
        ...(current.surfaceSelections ?? {})[key],
        ...Object.fromEntries(
          SELECTABLE_SURFACES
            .filter((surface) => selection[surface] !== undefined)
            .map((surface) => [surface, selection[surface] === true])
        )
      })
      await input.updateSettings({
        surfaceSelections: { ...(current.surfaceSelections ?? {}), [key]: stored }
      })
      return { key, selection: stored }
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
