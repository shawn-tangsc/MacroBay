import { isInsideQuietHours } from './quietHours'
import type { NotificationChannel, NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationRecord } from '../contracts/notificationContracts'
import type { NotificationDeeplink, NotificationRequest } from '../contracts/notificationContracts'

export type DeliveryAttempt = {
  channel: NotificationChannel
  attemptedAt: string
  /**
   * `handed-to-system` = 调用成功交给系统，**不等于用户看到了**：桌面通知可能被系统或用户静音。
   * `sent` 只用于应用内通道——那里的钩子真的跑了，用户界面确实渲染了。
   */
  result: 'sent' | 'handed-to-system' | 'skipped' | 'failed'
  reason?: string
}

/** 投递前由运行时解析好的一份正文（通道方案 §2.2）：端口不做解析，也不碰原始记录之外的东西。 */
export type NotificationDeliveryContent = {
  title: string
  body: string
  /** 「为什么推了」那一句 */
  reason: string
  /**
   * 动作标签，按动作 id 取（`{ actionId: '打开任务' }`）。**连同正文一起解析一次**：
   * 界面拿到的是句子而不是 `labelKey`，否则它就得自己带一张文案表来查。
   * 解析不出标签的动作不出现在这张表里，界面据此不画那个按钮。
   */
  actionLabels: Readonly<Record<string, string>>
  /** 只在合并过时给：单条记录的「共 1 次」是噪音，也是读者没见过的第二个东西。 */
  occurrenceLabel?: string
  deeplink?: NotificationDeeplink
}

export type DeliveryHooks = {
  toast?: (record: NotificationRecord, content: NotificationDeliveryContent) => void
  popup?: (record: NotificationRecord, content: NotificationDeliveryContent) => void
  desktop?: (record: NotificationRecord, content: NotificationDeliveryContent) => Promise<{ ok: boolean; reason?: string }>
  /** 出站到读者已绑定的通道；由主进程装配，通知运行时只调这个口（通道方案 §2.2）。 */
  push?: (record: NotificationRecord, content: NotificationDeliveryContent) => Promise<{ ok: boolean; reason?: string; messageId?: string }>
}

/**
 * 读者的一天的「现在」：设置时区 + 当前时刻。**必传，没有缺省值**。
 * 以前这里缺省成 UTC：调用方忘传时钟时，免打扰会把「我不知道」伪装成「你在格林尼治」，
 * 而忘传与「时区算不出来」是两件事，混在一起连证据链都少一层（`MI-11-R68`）。
 */
export type NotificationClock = { now: () => Date; timeZone: () => string }

export function routeTransientDelivery(
  record: NotificationRecord,
  settings: NotificationRuntimeSettings,
  hooks: DeliveryHooks,
  clock: NotificationClock,
  content: NotificationDeliveryContent = buildDeliveryContent(record),
  /**
   * 规划器算好的**免打扰决定**：同一份决定两处共用（2026-11-08）。缺省时按当前时钟算一次，
   * 只服务还没有规划器决策的旧调用点（读者手动重投）。
   */
  quietHours?: { inside: boolean; bypassed: boolean }
): Promise<DeliveryAttempt[]> {
  const attempts: DeliveryAttempt[] = []
  // 编译期已经要求必传；这里再挡一次 `as never` 之类的绕过，并给出可读原因，
  // 免得「没传时钟」表现成一句 `Cannot read properties of undefined`。
  if (!clock || typeof clock.now !== 'function') throw new Error('notification-clock-required')
  const now = clock.now().toISOString()
  const transientChannels = record.channels.filter((channel) => channel !== 'center')
  // 免打扰内**一档都不试**（S6）：跳过要留证据，不能让它看起来像「试了没到」。
  const quietHoursSuppress = (quietHours?.inside ?? isInsideQuietHours(settings, clock)) && quietHours?.bypassed !== true

  for (const channel of transientChannels) {
    if (quietHoursSuppress) {
      attempts.push({ channel, attemptedAt: now, result: 'skipped', reason: 'quiet-hours' })
      continue
    }
    if (channel === 'toast') {
      if (!settings.toastEnabled) {
        attempts.push({ channel, attemptedAt: now, result: 'skipped', reason: 'toast-disabled' })
        continue
      }
      // A channel with no delivery hook cannot be recorded as sent: that would be a false success.
      if (!hooks.toast) {
        attempts.push({ channel, attemptedAt: now, result: 'skipped', reason: 'toast-unavailable' })
        continue
      }
      hooks.toast(record, content)
      attempts.push({ channel, attemptedAt: now, result: 'sent' })
      continue
    }

    if (channel === 'popup') {
      if (!settings.popupEnabled) {
        attempts.push({ channel, attemptedAt: now, result: 'skipped', reason: 'popup-disabled' })
        continue
      }
      if (!hooks.popup) {
        attempts.push({ channel, attemptedAt: now, result: 'skipped', reason: 'popup-unavailable' })
        continue
      }
      hooks.popup(record, content)
      attempts.push({ channel, attemptedAt: now, result: 'sent' })
    }
  }

  const desktopChannel = transientChannels.includes('desktop')
  if (!desktopChannel) return Promise.resolve(attempts)

  if (quietHoursSuppress) {
    // 已在循环里记过一跳 `quiet-hours`（桌面也在 transientChannels 里），这里不再重复。
    return Promise.resolve(attempts)
  }

  if (!settings.desktopEnabled) {
    attempts.push({ channel: 'desktop', attemptedAt: now, result: 'skipped', reason: 'desktop-disabled' })
    return Promise.resolve(attempts)
  }

  if (!hooks.desktop) {
    attempts.push({ channel: 'desktop', attemptedAt: now, result: 'skipped', reason: 'desktop-unavailable' })
    return Promise.resolve(attempts)
  }

  return hooks.desktop(record, content).then((result) => {
    attempts.push({
      channel: 'desktop',
      attemptedAt: now,
      // `show()` 不抛错只证明交出去了，证明不了被看到——所以不是 `sent`。
      result: result.ok ? 'handed-to-system' : 'failed',
      reason: result.reason
    })
    return attempts
  })
}

export function normalizeRequestedChannels(
  request: NotificationRequest,
  settings: NotificationRuntimeSettings,
  clock: NotificationClock
): NotificationChannel[] {
  const requested = request.requestedChannels.includes('center')
    ? request.requestedChannels
    : ['center', ...request.requestedChannels]

  const filtered = requested.filter((channel): channel is NotificationChannel => {
    // 通知中心常开：它不是用户能关的开关。能关就等于「发不出去也不留一条」（4a 的唯一用途）。
    // 用户不想看，用标已读/清空处理——那是「现在没空看」，不是「别给我存」。
    if (channel === 'center') return true
    if (!isProductNotificationAllowed(request, settings)) return channel === 'center'
    if (channel === 'toast') return settings.toastEnabled && hasProductChannelPermission(request, settings, 'toast')
    if (channel === 'popup') return settings.popupEnabled && hasProductChannelPermission(request, settings, 'popup')
    if (channel === 'desktop') return settings.desktopEnabled && hasProductChannelPermission(request, settings, 'desktop')
    return false
  })

  return applyQuietHoursAndPriority(filtered, request.priority, settings, clock)
}

function isProductNotificationAllowed(request: NotificationRequest, settings: NotificationRuntimeSettings): boolean {
  if (!request.productId || !settings.productPermissions) return true
  return settings.productPermissions[request.productId]?.enabled ?? true
}

function hasProductChannelPermission(
  request: NotificationRequest,
  settings: NotificationRuntimeSettings,
  channel: 'toast' | 'popup' | 'desktop'
): boolean {
  if (!request.productId || !settings.productPermissions) return true
  const permission = settings.productPermissions[request.productId]
  if (!permission) return true
  if (channel === 'toast') return permission.allowToast
  if (channel === 'popup') return permission.allowPopup
  return permission.allowDesktop
}

function applyQuietHoursAndPriority(
  channels: NotificationChannel[],
  priority: NotificationRequest['priority'],
  settings: NotificationRuntimeSettings,
  clock: NotificationClock
): NotificationChannel[] {
  const minimumPriority = settings.minimumDisruptivePriority
  const disruptive = new Set<NotificationChannel>(['toast', 'popup', 'desktop'])
  const priorityRank: Record<NotificationRequest['priority'], number> = {
    low: 1,
    normal: 2,
    high: 3,
    urgent: 4
  }

  // 免打扰判别走 `quietHours.ts` 一处实现：`unknown`（时区取不到）**不静音**，只有确定在窗口内才静音。
  // 窗口内**不留穿透**（Chief 2026-11-07 定）：`urgent` 也不再豁免。留一个例外，就等于替读者
  // 决定「这一条算紧急」，而他从没同意把那个判断权交给我们；真要「必须叫醒」的事件，那是单独
  // 设计一类、在界面上写明会穿透，不能靠一个悄悄标的 `priority` 绕过去。
  // 手机那一档在 `notificationSubmitPlan.effectiveLevels` 里按同一份判定摘掉。
  const insideQuietHours = isInsideQuietHours(settings, clock)
  return channels.filter((channel) => {
    if (!disruptive.has(channel)) return true
    if (insideQuietHours) return false
    if (minimumPriority && priorityRank[priority] < priorityRank[minimumPriority]) return false
    return true
  })
}



/** 旧的 `(record)` 调用点没有正文：用记录里的键兜底，保证端口永远拿到同一份形状。 */
export function buildDeliveryContent(record: NotificationRecord): NotificationDeliveryContent {
  return {
    title: String(record.titleKey),
    body: record.bodyKey === undefined ? '' : String(record.bodyKey),
    reason: record.reasonKey === undefined ? '' : String(record.reasonKey),
    actionLabels: {},
    ...(record.deeplink === undefined ? {} : { deeplink: record.deeplink })
  }
}
