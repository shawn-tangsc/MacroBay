import type { NotificationRuntimeDependencies } from './notificationRuntime'
import { createNotificationDelivery } from './notificationRuntimeDelivery'
import { composeNotificationSettingsSurface } from './notificationRuntimeSettings'

/**
 * 把运行时的依赖折成**两个面**：设置面（设置页读写）与投递面（正文解析 + 各表面投递）。
 *
 * 为什么单独成文件：这段是纯装配——每个端口从哪个依赖来、缺了哪个键就不传——留在 runtime 里
 * 和几十个提交/读方法挤在一起时，动作与装配分不清。搬出来之后 `notificationRuntime.ts` 只留接线。
 *
 * 不变的两件事（以后改这里要一起看）：
 * - `pushWired` 由 `deliveryHooks.push` **是否存在**决定，不读任何配置值；
 * - `resolvePushChannel` 是**可选**端口：没装就不传，界面据此说「没有可用通道」，不猜。
 *
 * 类型上刻意只引用 `NotificationRuntimeDependencies` 与两个组合函数的参数，不新造一份端口清单：
 * 多一份清单，就多一处会与 runtime 漂开的地方。
 */
export type NotificationRuntimeSurfaceInternals = Readonly<{
  load: Parameters<typeof composeNotificationSettingsSurface>[1]['load']
  exclusive: Parameters<typeof composeNotificationSettingsSurface>[1]['exclusive']
  persistWithDiagnostics: Parameters<typeof composeNotificationSettingsSurface>[1]['persistWithDiagnostics']
  notifyChanged: Parameters<typeof composeNotificationSettingsSurface>[1]['notifyChanged']
  now: () => string
}>

export function composeNotificationRuntimeSurfaces(
  deps: NotificationRuntimeDependencies,
  internals: NotificationRuntimeSurfaceInternals
): { settingsSurface: ReturnType<typeof composeNotificationSettingsSurface>; delivery: ReturnType<typeof createNotificationDelivery> } {
  const settingsSurface = composeNotificationSettingsSurface(
    {
      catalog: deps.catalog,
      getSettings: deps.getSettings,
      updateSettings: deps.updateSettings,
      getPushTargets: deps.getPushTargets,
      ...(deps.resolvePushChannel === undefined ? {} : { resolvePushChannel: deps.resolvePushChannel }),
      ...(deps.lastDelivery === undefined ? {} : { lastDelivery: deps.lastDelivery }),
      pushWired: () => deps.deliveryHooks?.push !== undefined
    },
    {
      load: internals.load,
      exclusive: internals.exclusive,
      persistWithDiagnostics: internals.persistWithDiagnostics,
      notifyChanged: internals.notifyChanged
    }
  )
  const delivery = createNotificationDelivery({
    deliveryHooks: deps.deliveryHooks,
    clock: deps.clock,
    getLanguage: deps.getLanguage,
    copy: deps.copy,
    diagnostics: deps.diagnostics,
    ...(deps.resolvePushChannel === undefined ? {} : { resolvePushChannel: deps.resolvePushChannel }),
    now: internals.now
  })
  return { settingsSurface, delivery }
}
