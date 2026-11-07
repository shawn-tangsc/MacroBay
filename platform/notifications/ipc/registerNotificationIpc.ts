import { join } from 'node:path'

import { app, BrowserWindow } from 'electron'

import { IpcChannels } from '../../desktop/ipc/channels'
import type { NotificationCopyLanguage } from '../../i18n/notificationCopy'
import { createDesktopNotificationAdapter } from '../desktop/desktopNotificationAdapter'
import { createNotificationJsonStorage, createNotificationRuntime } from '../runtime/notificationRuntime'
import type { NotificationDiagnosticsSink, NotificationRecord, NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { DeliveryHooks, NotificationClock, NotificationDeliveryContent } from '../runtime/notificationRouting'
import type { NotificationEventCatalog } from '../contracts/notificationEventCatalog'
import type { NotificationCopyPort } from '../contracts/notificationCopyPort'
import type { NotificationProducerOwnership } from '../contracts/notificationProducerOwnership'
import type { TestNoticeCandidatePort } from '../contracts/notificationSelfTest'
import type { PushChannelResolution } from '../delivery/pushChannelResolution'

let notificationRuntime: ReturnType<typeof createNotificationRuntime> | null = null
let getNotificationSettings: (() => Promise<NotificationRuntimeSettings>) | null = null
let notificationClock: NotificationClock | null = null
let getLanguage: (() => Promise<NotificationCopyLanguage>) | null = null
let notificationCatalog: NotificationEventCatalog | null = null
let notificationCopyPort: NotificationCopyPort | null = null
let notificationDiagnostics: NotificationDiagnosticsSink | null = null
let updateNotificationSettings: ((patch: Partial<NotificationRuntimeSettings>) => Promise<void>) | null = null
let getNotificationPushTargets: (() => Promise<readonly unknown[]>) | null = null
let notificationPushHook: DeliveryHooks['push'] | null = null
let notificationProducerOwnership: NotificationProducerOwnership | null = null
let notificationProductIds: readonly string[] | null = null
/** 这两个端口是「一旦装配就固定」的，用一个小对象收着，免得再加两个模块级变量。 */
const resolutionDeps: {
  resolvePushChannel: (() => Promise<PushChannelResolution>) | null
  testNoticeCandidates: TestNoticeCandidatePort | null
} = { resolvePushChannel: null, testNoticeCandidates: null }

export function configureNotificationRuntime(deps: {
  getSettings: () => Promise<NotificationRuntimeSettings>
  catalog?: NotificationEventCatalog
  copy?: NotificationCopyPort
  /** 诊断出口：**必传**。漏传时运行时照样能记、但没人接，等于没留痕（2026-11-08 定）。 */
  diagnostics: NotificationDiagnosticsSink
  updateSettings?: (patch: Partial<NotificationRuntimeSettings>) => Promise<void>
  getPushTargets?: () => Promise<readonly unknown[]>
  /** 三枚测试按钮的只读取数端口（产品侧实现，组合根注入）；不传＝诚实的 `read-failed`。 */
  testNoticeCandidates?: TestNoticeCandidatePort
  /** 目标通道的唯一派生（技术方案 §1）。 */
  resolvePushChannel?: () => Promise<PushChannelResolution>
  push?: DeliveryHooks['push']
  producerOwnership?: NotificationProducerOwnership
  productIds?: readonly string[]
  /** 读者时区与当前时刻。**必传**：缺省成 UTC 会把「不知道」当成「用户在格林尼治」（`MI-11-R68`）。 */
  clock: NotificationClock
  /**
   * 读者语言：桌面通知在主进程发出，文案必须在这里解析。
   * 类型上可缺是为了装配顺序（先 configure 再取实例），但**缺了会在取实例时直接抛错**，
   * 不会悄悄按中文发出去——静默兜底会让英文用户收到中文桌面通知。
   */
  getLanguage?: () => Promise<NotificationCopyLanguage>
}): void {
  getNotificationSettings = deps.getSettings
  notificationClock = deps.clock
  getLanguage = deps.getLanguage ?? null
  notificationCatalog = deps.catalog ?? null
  notificationCopyPort = deps.copy ?? null
  notificationDiagnostics = deps.diagnostics
  updateNotificationSettings = deps.updateSettings ?? null
  getNotificationPushTargets = deps.getPushTargets ?? null
  resolutionDeps.resolvePushChannel = deps.resolvePushChannel ?? null
  resolutionDeps.testNoticeCandidates = deps.testNoticeCandidates ?? null
  notificationPushHook = deps.push ?? null
  notificationProducerOwnership = deps.producerOwnership ?? null
  notificationProductIds = deps.productIds ?? null
}

/** 记录变化后广播一次：角标与列表订阅它，不轮询。事件只说明「变了」，真值仍由 `list()` 读。 */
/**
 * 应用内投递：把那条记录推给渲染层去画。
 *
 * 存在理由：`routeTransientDelivery` 早就有 `toast` / `popup` 两个钩子，但没人接——于是开关
 * 打开了、路由算完「该弹」、`hooks.toast` 缺席，记录被写成 `skipped: toast-unavailable`。
 * 效果与假开关相同：用户勾了它，屏幕上什么都没发生。
 */
async function broadcastNotificationDelivered(
  record: NotificationRecord,
  content: NotificationDeliveryContent,
  channel: 'toast' | 'popup'
): Promise<void> {
  // 同一个投影、同一份正文：横幅和中心必须逐字一样，各解析一次就会出现两种说法。
  const runtime = notificationRuntime
  if (runtime === null) return
  const item = await runtime.toCenterItem(record, content)
  const payload = { channel, record: item }
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IpcChannels.notificationsDelivered, payload)
  }
}

function broadcastNotificationChanged(change: { version: number }): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue
    window.webContents.send(IpcChannels.notificationsChanged, change)
  }
}

export function getNotificationRuntime() {
  if (!notificationRuntime) {
    if (getLanguage === null) {
      throw new Error('notification-runtime-language-not-configured')
    }
    if (notificationClock === null) {
      // 装配顺序错误：宁可启动即失败，也不拿 UTC 顶替读者时区去判一次免打扰。
      throw new Error('notification-runtime-clock-not-configured')
    }
    if (notificationDiagnostics === null) {
      // 同样宁可启动即失败：能记却没人接，与实际没留痕无法区分。
      throw new Error('notification-runtime-diagnostics-not-configured')
    }
    const desktopAdapter = createDesktopNotificationAdapter()
    notificationRuntime = createNotificationRuntime({
      storage: createNotificationJsonStorage(join(app.getPath('userData'), 'platform', 'notifications.json')),
      getSettings: () =>
        getNotificationSettings?.() ??
        Promise.resolve({
          desktopEnabled: true,
          toastEnabled: false,
          popupEnabled: true,
          push: { channelId: null },
          retentionDays: 30,
          defaultSnoozeMinutes: 60
        }),
      clock: notificationClock,
      getLanguage: () => getLanguage?.() ?? Promise.resolve('zh-CN'),
      catalog: notificationCatalog ?? undefined,
      copy: notificationCopyPort ?? undefined,
      diagnostics: notificationDiagnostics,
      updateSettings: updateNotificationSettings ?? undefined,
      getPushTargets: getNotificationPushTargets ?? undefined,
      producerOwnership: notificationProducerOwnership ?? undefined,
      productIds: notificationProductIds ?? undefined,
      deliveryHooks: {
        // 应用内两档推给渲染层时，句子里已经解析好：渲染层没有键，也就印不出键。
        toast: (record, content: NotificationDeliveryContent) => { void broadcastNotificationDelivered(record, content, 'toast') },
        popup: (record, content: NotificationDeliveryContent) => { void broadcastNotificationDelivered(record, content, 'popup') },
        // 四个钩子拿运行时解析好的**同一份** content（通道方案 §2.2）：端口不再解析一遍。
        desktop: async (_record, content: NotificationDeliveryContent) =>
          desktopAdapter.show({
            title: content.title,
            ...(content.body.length === 0 ? {} : { body: content.body })
          }),
        ...(notificationPushHook === null ? {} : { push: notificationPushHook })
      },
      readDesktopPermission: () => desktopAdapter.readPermission(),
      onChanged: broadcastNotificationChanged
    })
    void notificationRuntime.initialize()
  }
  return notificationRuntime
}

export function resetNotificationRuntimeForTests(): void {
  notificationRuntime = null
  getNotificationSettings = null
  notificationClock = null
  notificationCatalog = null
  notificationCopyPort = null
  notificationDiagnostics = null
  updateNotificationSettings = null
  getNotificationPushTargets = null
  notificationPushHook = null
  notificationProducerOwnership = null
  notificationProductIds = null
}
