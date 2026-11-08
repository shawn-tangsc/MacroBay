import type { AppLanguage, AppSettings } from '@platform/settings/schema/appSettings'
import type { ProductManifest } from '@platform/product-manifest'
import { notificationCopy } from '@platform/i18n/notificationCopy'
import { createNotificationCopyPort, type JobTitleResolver } from '@platform/notifications/contracts/notificationCopyPort'
import { productNotificationCopyTables } from './notificationCopyTables'
import { createNotificationEventCatalog } from '@platform/notifications/contracts/notificationEventCatalog'
import { diagnosticLogFields } from '@platform/notifications/contracts/notificationDiagnosticLogFields'
import { PLATFORM_NOTIFICATION_APPROVALS, PLATFORM_NOTIFICATION_EVENTS } from '@platform/notifications/contracts/platformNotificationEvents'
import type {
  NotificationDiagnosticsSink,
  NotificationRuntimeSettings
} from '@platform/notifications/contracts/notificationContracts'
import { configureNotificationRuntime } from '@platform/notifications/ipc/registerNotificationIpc'
import { createChannelPushPort, type ChannelPushPortDeps } from '@platform/notifications/delivery/channelPushPort'
import { resolvePushChannel, type PushChannelResolution } from '@platform/notifications/delivery/pushChannelResolution'
import { createNotificationProducerOwnership } from '@platform/notifications/contracts/notificationProducerOwnership'
import type { DeliveryHooks } from '@platform/notifications/runtime/notificationRouting'

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
  /** 诊断出口（runtime §2）：**必传**，装配层接到 AppLog、测试给 recorder；缺了运行时一律编译不过。 */
  diagnostics: NotificationDiagnosticsSink
  /** 目标通道的唯一派生；App 组合根按通道投影注入，低层组合根由调用方给。 */
  resolvePushChannel?: () => Promise<PushChannelResolution>
  /** 出站端口；装上后 pushWired 才为真。 */
  push?: DeliveryHooks['push']
  /**
   * 通知设置页「发送到通道」那一行读的只读投影：可选通道 + 目标绑定。
   *
   * 不传的话运行时会把它当成「没有任何可投递通道」，界面就永远说「还没有可用通道」——
   * 明明能发、界面却说没有，这是最坏的一种谎：读者以为功能不存在。
   */
  getPushTargets?: () => Promise<readonly unknown[]>
  /**
   * 作业名解析（契约 v2.40）：按 `definitionId` 取作业定义上的 `JobTitle`，按当前语言选，
   * **不另建文案表**。不传就一律解析不到——那会整条降级成兜底句，不会印出 `definitionId`。
   */
  jobTitle?: JobTitleResolver
}>

export function composeNotificationRuntime(ports: NotificationCompositionPorts): void {
  // 平台事件表 + 各产品 manifest 的声明：目录只接受注入，平台不认识产品代码（契约 §2/§3）。
  const catalog = createNotificationEventCatalog({
    sources: [
      // b1：平台事件也带自己的批准段（值逐字抄自平台表）；本步目录仍读表，行为不变。
      { productId: 'platform', events: PLATFORM_NOTIFICATION_EVENTS, approval: PLATFORM_NOTIFICATION_APPROVALS },
      ...ports.manifests
        .filter((manifest) => (manifest.notificationEvents?.length ?? 0) > 0)
        .map((manifest) => ({
          productId: manifest.id,
          events: manifest.notificationEvents ?? [],
          // 批准值随声明走（契约 §7.1b）：迁移期与平台表并存，兜底仍在，行为不变。
          ...(manifest.notificationApproval === undefined ? {} : { approval: manifest.notificationApproval })
        }))
    ]
  })

  const producerOwnership = createNotificationProducerOwnership({ manifests: ports.manifests })
  configureNotificationRuntime({
    getSettings: async () => (await ports.getSettings()).notifications,
    producerOwnership,
    productIds: ports.manifests.map((manifest) => manifest.id),
    clock: { now: () => new Date(), timeZone: ports.timeZone },
    getLanguage: async (): Promise<AppLanguage> => {
      const language = (await ports.getSettings()).language
      return language === 'en-US' ? 'en-US' : 'zh-CN'
    },
    catalog,
    // 装配层注入产品文案表：运行时/契约不 import 产品，平台根只按 manifest 声明的表收（契约 §3.3）。
    copy: createNotificationCopyPort({
      platform: notificationCopy,
      products: productNotificationCopyTables(ports.manifests),
      ...(ports.jobTitle === undefined ? {} : { jobTitle: ports.jobTitle })
    }),
    ...(ports.updateSettings === undefined ? {} : { updateSettings: ports.updateSettings }),
    diagnostics: ports.diagnostics,
    ...(ports.push === undefined ? {} : { push: ports.push }),
    ...(ports.getPushTargets === undefined ? {} : { getPushTargets: ports.getPushTargets }),
    ...(ports.resolvePushChannel === undefined ? {} : { resolvePushChannel: ports.resolvePushChannel }),
  })
}


/**
 * app.ts 侧的一行装配：把设置 store 与 AppLog 适配成 runtime 需要的两个端口。
 *
 * 适配器放这里而不是 app.ts：`app.ts` 是「只减不增」的基线文件，每加一行都要先抽离。
 */
export type AppNotificationCompositionPorts = Omit<NotificationCompositionPorts, 'diagnostics' | 'resolvePushChannel'> & {
  /** 通道侧的只读投影 + 投递入口；只有 app 组合根有这两样。 */
  channels: ChannelPushPortDeps['channels']
  deliver: ChannelPushPortDeps['deliver']
  settingsStore: {
    get: () => Promise<AppSettings>
    update: (patch: Partial<AppSettings>) => Promise<unknown>
  }
  log: {
    log: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
  }
}

/**
 * 表面选择写失败时留一行痕（契约 §5.5），其余设置失败照旧往上抛。
 *
 * 为什么单独包一层：读者点了勾、页面弹回原样、一声不响——那正是「点了没反应」，而这一格
 * 以前就是静默的。日志**只打组键与原因**：`surfaceSelections` 是读者自己的配置，整份打出来
 * 等于把它抄进日志。错误照旧抛回去，页面才能当场说「这次没存上」。
 */
export function withSurfaceSaveDiagnostics(input: {
  update: (patch: Partial<NotificationRuntimeSettings>) => Promise<unknown>
  log: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>) => void
}): (patch: Partial<NotificationRuntimeSettings>) => Promise<void> {
  return async (patch) => {
    try {
      await input.update(patch)
    } catch (error) {
      if (patch.surfaceSelections !== undefined) {
        input.log('warn', 'notification.surface-selection-save-failed', {
          key: Object.keys(patch.surfaceSelections)[0] ?? null,
          reason: error instanceof Error ? error.message : String(error)
        })
      }
      throw error
    }
  }
}

export function composeNotificationRuntimeForApp(ports: AppNotificationCompositionPorts): void {
  /**
   * 目标通道的唯一派生（技术方案 §1）：三处（主推送 / 严重度升级 / 手动重投）都读这一个函数，
   * 因此「读者启用了两条」这件事在三条路上同时成立，不会主路径拒绝、升级路径照发。
   */
  const pushTarget = async () => resolvePushChannel(ports.channels.list(), (code, count) => {
    ports.log.log('warn', code === 'push-multiple-enabled' ? 'notification.push-multiple-enabled' : `notification.${code}`, { count })
  })
  const push = createChannelPushPort({
    channels: ports.channels,
    deliver: ports.deliver,
    resolvePushChannel: pushTarget,
    // 至多一个「看原文」；多出来的取第一个照发，但留一行痕——静默取第一个等于让写错的人永远不知道。
    diagnostics: (code, detail) => {
      ports.log.log('warn', code === 'push-multiple-enabled' ? 'notification.push-multiple-enabled' : `notification.${code}`, { ...detail })
    }
  })
  composeNotificationRuntime({
    getSettings: ports.getSettings,
    timeZone: ports.timeZone,
    manifests: ports.manifests,
    push,
    resolvePushChannel: pushTarget,
    getPushTargets: async () => ports.channels.listDeliveryTargets().channels,
    updateSettings: withSurfaceSaveDiagnostics({
      update: async (patch) => {
        const current = await ports.settingsStore.get()
        await ports.settingsStore.update({ notifications: { ...current.notifications, ...patch } })
      },
      log: (level, event, fields) => ports.log.log(level, event, fields)
    }),
    diagnostics: (entry) => {
      // `unclaimed-producer` 记 `info`，不是 `warn`（2026-11-07 定）。
      //
      // 它是「首次见到这个未声明生产者」的一次性提示，不是故障：平台照发（门禁在记完之后
      // `return { action: 'send' }`），S10② 要求的正是这行可查。而它按**作业 handler** 计——
      // 实测 5 天 204 条，全在 `platform.job.failed-terminal` 上（某个每 10 分钟跑一次的采集
      // 作业这类），每次启动每个 handler 一条。记成 warn 的代价不是「多了几行」，是**真的故障混在里面
      // 没人再看**。也不能靠给这些 handler 补 claim 消掉：claim 会让平台事件被让渡，P1/P2 就没人发了。
      // 提交被拒自带档位（`rejectionTraceLevel` 一处定义：代码错 `error`、正常抑制 `info`），
      // 这里只透传——档位规则不在这层重建第二份。
      const level =
        entry.level ??
        (entry.code === 'delegated' || entry.code === 'unclaimed-producer'
          ? 'info'
          : entry.code === 'persist-failed' ? 'error' : 'warn')
      const event = entry.code === 'push-multiple-enabled' ? 'notification.push-multiple-enabled' : `notification.${entry.code}`
      // 字段透传走**唯一一份清单**（`diagnosticLogFields`）：手写一份白名单会吞掉下一个字段，
      // 线上那次 `submit-failed` 没有 `reason` 就是这么来的。清单只含闭集码、id、条数与时刻。
      ports.log.log(level, event, diagnosticLogFields(entry))
    }
  })
}
