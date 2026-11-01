import { minutesOfDayInTimeZone } from '../../time/timeZoneClock'
import type { NotificationChannel, NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationRecord } from '../contracts/notificationContracts'
import type { NotificationRequest } from '../contracts/notificationContracts'

export type DeliveryAttempt = {
  channel: NotificationChannel
  attemptedAt: string
  result: 'sent' | 'skipped' | 'failed'
  reason?: string
}

export type DeliveryHooks = {
  toast?: (record: NotificationRecord) => void
  popup?: (record: NotificationRecord) => void
  desktop?: (record: NotificationRecord) => Promise<{ ok: boolean; reason?: string }>
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
  clock: NotificationClock
): Promise<DeliveryAttempt[]> {
  const attempts: DeliveryAttempt[] = []
  const now = new Date().toISOString()
  const transientChannels = record.channels.filter((channel) => channel !== 'center')

  for (const channel of transientChannels) {
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
      hooks.toast(record)
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
      hooks.popup(record)
      attempts.push({ channel, attemptedAt: now, result: 'sent' })
    }
  }

  const desktopChannel = transientChannels.includes('desktop')
  if (!desktopChannel) return Promise.resolve(attempts)

  if (!settings.desktopEnabled) {
    attempts.push({ channel: 'desktop', attemptedAt: now, result: 'skipped', reason: 'desktop-disabled' })
    return Promise.resolve(attempts)
  }

  if (!hooks.desktop) {
    attempts.push({ channel: 'desktop', attemptedAt: now, result: 'skipped', reason: 'desktop-unavailable' })
    return Promise.resolve(attempts)
  }

  return hooks.desktop(record).then((result) => {
    attempts.push({
      channel: 'desktop',
      attemptedAt: now,
      result: result.ok ? 'sent' : 'failed',
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
    if (channel === 'center') return settings.centerEnabled
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

  return channels.filter((channel) => {
    if (!disruptive.has(channel)) return true
    if (minimumPriority && priorityRank[priority] < priorityRank[minimumPriority]) return false
    if (settings.quietHours?.enabled && quietHoursVerdict(settings.quietHours, clock) === 'inside') {
      return priority === 'urgent'
    }
    return true
  })
}

/**
 * 免打扰窗口的判定结果。`unknown` 与 `outside` 是两件事：前者是「拿不到现在几点」，
 * 后者是「拿得到，且不在窗口内」。混成一个布尔值，就等于把「不知道」当成「不在」。
 */
type QuietHoursVerdict = 'inside' | 'outside' | 'unknown'

function quietHoursVerdict(
  quietHours: NonNullable<NotificationRuntimeSettings['quietHours']>,
  clock: NotificationClock
): QuietHoursVerdict {
  // 免打扰窗口按设置的读者时区判断，不按运行这台机器的本地时间。
  const currentMinutes = minutesOfDayInTimeZone(clock.now(), clock.timeZone())
  // 时区用不了时不做判定：宁可多响一次，也不在错的钟点把提醒静音掉。
  if (currentMinutes === null) return 'unknown'
  const start = parseLocalMinutes(quietHours.startLocalTime)
  const end = parseLocalMinutes(quietHours.endLocalTime)
  if (start === end) return 'outside'
  const inside = start < end
    ? currentMinutes >= start && currentMinutes < end
    : currentMinutes >= start || currentMinutes < end
  return inside ? 'inside' : 'outside'
}

function parseLocalMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return hours * 60 + minutes
}
