import type { AppLanguage, AppSettings } from '@platform/settings/schema/appSettings'
import type { ProductManifest } from '@platform/product-manifest'
import { notificationCopy } from '@platform/i18n/notificationCopy'
import { createNotificationCopyPort } from '@platform/notifications/contracts/notificationCopyPort'
import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { NOTIFICATION_EVENT_POLICY } from '@platform/notifications/contracts/notificationEventPolicy'
import { PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import type {
  NotificationDiagnosticsSink,
  NotificationRuntimeSettings
} from '@platform/notifications/contracts/notificationContracts'
import { configureNotificationRuntime } from '@platform/notifications/ipc/registerNotificationIpc'

/**
 * 通知运行时的装配。
 *
 * 搬家不是目的，**收口**才是：`app.ts` 里这一段原本是 10 行闭包，它读的是设置与时区两份状态。
 * 现在这两份状态由调用方按端口传进来，模块自己不知道设置存在哪儿——`app.ts` 只剩一行。
 *
 * 两处口径保持不变（都是从 `app.ts` 逐字搬过来的，不是重写）：
 * - **免打扰窗口按设置的读者时区判断**，不按运行机器；
 * - **桌面通知每次读设置拿当前语言**，所以切语言后连历史通知也按新语言解析。
 */
export type NotificationCompositionPorts = Readonly<{
  /** 当前设置。每次调用都重读，**不许缓存**：语言与时区随时会变。 */
  getSettings: () => Promise<AppSettings>
  /** 读者时区（设置里的那一个，不是运行机器的）。 */
  timeZone: () => string
  /** 装配期注入的产品 manifest：平台只读它们的 `notificationEvents`，不 import 产品代码。 */
  manifests: readonly ProductManifest[]
  /** 写提示开关 / 通道选择；由 app.ts 接到设置 store。 */
  updateSettings?: (patch: Partial<NotificationRuntimeSettings>) => Promise<void>
  /** 诊断出口（runtime §2）：装配层接到 AppLog，测试可给 recorder。 */
  diagnostics?: NotificationDiagnosticsSink
}>

export function composeNotificationRuntime(ports: NotificationCompositionPorts): void {
  // 平台事件表 + 各产品 manifest 的声明：目录只接受注入，平台不认识产品代码（契约 §2/§3）。
  const catalog = createNotificationEventCatalog({
    sources: [
      { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS },
      ...ports.manifests
        .filter((manifest) => (manifest.notificationEvents?.length ?? 0) > 0)
        .map((manifest) => ({ productId: manifest.id, events: manifest.notificationEvents ?? [] }))
    ],
    policy: NOTIFICATION_EVENT_POLICY
  })

  configureNotificationRuntime({
    getSettings: async () => (await ports.getSettings()).notifications,
    clock: { now: () => new Date(), timeZone: ports.timeZone },
    getLanguage: async (): Promise<AppLanguage> => {
      const language = (await ports.getSettings()).language
      return language === 'en-US' ? 'en-US' : 'zh-CN'
    },
    catalog,
    // 产品文案表由第 5 步注入；现在只有平台表，产品键解析不到会走兜底句 + 诊断。
    copy: createNotificationCopyPort({ platform: notificationCopy }),
    ...(ports.updateSettings === undefined ? {} : { updateSettings: ports.updateSettings }),
    ...(ports.diagnostics === undefined ? {} : { diagnostics: ports.diagnostics })
  })
}


/**
 * app.ts 侧的一行装配：把设置 store 与 AppLog 适配成 runtime 需要的两个端口。
 *
 * 适配器放这里而不是 app.ts：`app.ts` 是「只减不增」的基线文件，每加一行都要先抽离。
 */
export type AppNotificationCompositionPorts = NotificationCompositionPorts & {
  settingsStore: {
    get: () => Promise<AppSettings>
    update: (patch: Partial<AppSettings>) => Promise<unknown>
  }
  log: {
    log: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  }
}

export function composeNotificationRuntimeForApp(ports: AppNotificationCompositionPorts): void {
  composeNotificationRuntime({
    getSettings: ports.getSettings,
    timeZone: ports.timeZone,
    manifests: ports.manifests,
    updateSettings: async (patch) => {
      const current = await ports.settingsStore.get()
      await ports.settingsStore.update({ notifications: { ...current.notifications, ...patch } })
    },
    diagnostics: (entry) => {
      const level = entry.code === 'delegated' ? 'info' : entry.code === 'persist-failed' ? 'error' : 'warn'
      ports.log.log(level, `notification.${entry.code}`, {
        eventTypeId: entry.eventTypeId,
        producerId: entry.producerId,
        at: entry.at
      })
    }
  })
}
