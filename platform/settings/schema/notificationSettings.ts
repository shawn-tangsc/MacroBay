import {
  createDefaultNotificationRuntimeSettings,
  type NotificationRuntimeSettings
} from '@platform/notifications/contracts/notificationContracts'

/**
 * 应用设置里「通知」这一组：形状直接就是通知运行时的契约，这里只做转出。
 *
 * 为什么单独成文件：`appSettings.ts` 已经超过体积门禁的 500 行上限，而通知这一组是
 * 一个**完整的类别**（形状 + 归一 + 两张子表的归一），整块搬走不会把任何对象切成两半。
 * 搬出来之后 `appSettings.ts` 只保留「通知设置存在这里」这一条事实与转出。
 */
export type NotificationSettings = NotificationRuntimeSettings

/** 通知设置里**类型认识**的字段。列表之外的键照旧保留（见下面的说明），但会回报一次。 */
const NOTIFICATION_SETTING_FIELDS = [
  'desktopEnabled',
  'toastEnabled',
  'popupEnabled',
  'channelEvents',
  'surfaceSelections',
  'push',
  'retentionDays',
  'defaultSnoozeMinutes',
  'quietHours',
  'minimumDisruptivePriority',
  'productPermissions'
] as const

/**
 * 通知设置的归一化：**已知字段严格校验，未知字段原样保留**。
 *
 * 为什么保留未知字段：这张表以前是纯白名单，每加一个字段都要人记得回来加一行，漏一次就
 * **静默丢数据**——`channelEvents`（情报四条「推不推手机」）丢了整整一版，`surfaceSelections`
 * （表面选择）一进来就丢，用户的症状是「勾了弹回去、点了没反应」。保留之后，最坏情况是
 * 「值存住了但还没人读」（可查），而不是「值被丢掉」（不可查）。
 *
 * **保留不等于默认它对**：这些字段名会被回报一次（每个名字只报一次），拼错的键不会永久潜伏
 * 而没人知道。已知字段的校验一点没放松——类型不对照旧回落默认，不会被当成「未知」留下来。
 */
export function normalizeNotificationSettings(
  value: unknown,
  // 默认值直接取通知契约自己的默认：此前走 `createDefaultAppSettings().notifications`，
  // 为了拿到这一组而把整棵设置树构造一遍；搬出本文件后也必须断开这条反向依赖。
  defaults: NotificationSettings = createDefaultNotificationRuntimeSettings(),
  onUnknownField?: (field: string) => void
): NotificationSettings {
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<NotificationSettings> & Record<string, unknown>
  const known: NotificationSettings = {
    desktopEnabled: typeof candidate.desktopEnabled === 'boolean' ? candidate.desktopEnabled : defaults.desktopEnabled,
    toastEnabled: typeof candidate.toastEnabled === 'boolean' ? candidate.toastEnabled : defaults.toastEnabled,
    popupEnabled: typeof candidate.popupEnabled === 'boolean' ? candidate.popupEnabled : defaults.popupEnabled,
    // 通道选择：空字符串视为未选（null 即关，不另加 enabled 布尔，契约 §2）。
    push: {
      channelId:
        typeof candidate.push?.channelId === 'string' && candidate.push.channelId.length > 0
          ? candidate.push.channelId
          : null
    },
    retentionDays:
      typeof candidate.retentionDays === 'number' && candidate.retentionDays > 0
        ? Math.min(90, Math.round(candidate.retentionDays))
        : defaults.retentionDays,
    defaultSnoozeMinutes:
      typeof candidate.defaultSnoozeMinutes === 'number' && candidate.defaultSnoozeMinutes > 0
        ? Math.round(candidate.defaultSnoozeMinutes)
        : defaults.defaultSnoozeMinutes,
    quietHours: candidate.quietHours
      ? {
          enabled: Boolean(candidate.quietHours.enabled),
          startLocalTime:
            typeof candidate.quietHours.startLocalTime === 'string'
              ? candidate.quietHours.startLocalTime
              : defaults.quietHours?.startLocalTime ?? '22:00',
          endLocalTime:
            typeof candidate.quietHours.endLocalTime === 'string'
              ? candidate.quietHours.endLocalTime
              : defaults.quietHours?.endLocalTime ?? '08:00'
        }
      : defaults.quietHours,
    minimumDisruptivePriority: candidate.minimumDisruptivePriority ?? defaults.minimumDisruptivePriority,
    productPermissions: candidate.productPermissions ?? defaults.productPermissions,
    // 下面两行曾经都缺着。写法是白名单：没列进来的字段在读回时被丢掉——写进去了、重启后没有，
    // 页面把勾冲掉，表现是「这一格点了不能改」，而且不报错。
    //
    // - `channelEvents`（情报四条「推不推手机」）从上一版起就在丢，比「通知方式」那一排更早；
    // - `surfaceSelections`（第三层「发到哪些地方」）是这次新加的字段，一进来就丢。
    channelEvents: normalizeChannelEvents(candidate.channelEvents),
    surfaceSelections: normalizeSurfaceSelections(candidate.surfaceSelections)
  }

  // 未知字段原样留下（深拷贝，别把读进来的引用直接交出去），并回报字段名。
  const preserved: Record<string, unknown> = {}
  for (const [field, raw] of Object.entries(candidate)) {
    if ((NOTIFICATION_SETTING_FIELDS as readonly string[]).includes(field)) continue
    preserved[field] = cloneJsonValue(raw)
    onUnknownField?.(field)
  }
  return Object.keys(preserved).length === 0 ? known : { ...known, ...preserved }
}

/** JSON 形状的深拷贝：设置文件只存 JSON，走这一条就够，不引第三方深合并。 */
function cloneJsonValue<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

/**
 * 「推不推手机」那张表（契约 §5.4）的归一：值只收布尔，别的键丢掉。
 *
 * 它和 `surfaceSelections` 是同一个病：白名单里没列，写进去就被静默丢掉——
 * 四条开关重启后全部回默认，读者会以为「这软件记不住我选的」。
 */
function normalizeChannelEvents(value: unknown): NotificationSettings['channelEvents'] {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, boolean> = {}
  for (const [eventId, enabled] of Object.entries(value as Record<string, unknown>)) {
    if (typeof enabled === 'boolean') out[eventId] = enabled
  }
  return Object.keys(out).length === 0 ? undefined : out
}

/**
 * 表面选择的白名单归一：只留三个可逐事件选的面的布尔值，别的键一律丢。
 *
 * 丢未知键是故意的：越权面（例如某条没批的 `desktop`）本来也不该落盘；读端还会再夹一次，
 * 但落盘就不该留它——「存了一份不生效的配置」比「没存」更难查。
 */
function normalizeSurfaceSelections(
  value: unknown
): NotificationSettings['surfaceSelections'] {
  if (!value || typeof value !== 'object') return undefined
  const out: Record<string, { channel?: boolean; toast?: boolean; desktop?: boolean }> = {}
  for (const [key, selection] of Object.entries(value as Record<string, unknown>)) {
    if (!selection || typeof selection !== 'object') continue
    const entry = selection as Record<string, unknown>
    const normalized: { channel?: boolean; toast?: boolean; desktop?: boolean } = {}
    for (const surface of ['channel', 'toast', 'desktop'] as const) {
      if (typeof entry[surface] === 'boolean') normalized[surface] = entry[surface]
    }
    if (Object.keys(normalized).length > 0) out[key] = normalized
  }
  return Object.keys(out).length === 0 ? undefined : out
}
