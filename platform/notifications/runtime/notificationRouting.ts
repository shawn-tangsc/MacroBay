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

export function routeTransientDelivery(
  record: NotificationRecord,
  settings: NotificationRuntimeSettings,
  hooks: DeliveryHooks
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
      hooks.toast?.(record)
      attempts.push({ channel, attemptedAt: now, result: 'sent' })
      continue
    }

    if (channel === 'popup') {
      if (!settings.popupEnabled) {
        attempts.push({ channel, attemptedAt: now, result: 'skipped', reason: 'popup-disabled' })
        continue
      }
      hooks.popup?.(record)
      attempts.push({ channel, attemptedAt: now, result: 'sent' })
    }
  }

  const desktopChannel = transientChannels.includes('desktop')
  if (!desktopChannel) return Promise.resolve(attempts)

  if (!settings.desktopEnabled || !hooks.desktop) {
    attempts.push({ channel: 'desktop', attemptedAt: now, result: 'skipped', reason: 'desktop-disabled' })
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

export function normalizeRequestedChannels(request: NotificationRequest, settings: NotificationRuntimeSettings): NotificationChannel[] {
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

  return applyQuietHoursAndPriority(filtered, request.priority, settings)
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
  settings: NotificationRuntimeSettings
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
    if (settings.quietHours?.enabled && isWithinQuietHours(settings.quietHours)) {
      return priority === 'urgent'
    }
    return true
  })
}

function isWithinQuietHours(quietHours: NonNullable<NotificationRuntimeSettings['quietHours']>): boolean {
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const start = parseLocalMinutes(quietHours.startLocalTime)
  const end = parseLocalMinutes(quietHours.endLocalTime)
  if (start === end) return false
  if (start < end) return currentMinutes >= start && currentMinutes < end
  return currentMinutes >= start || currentMinutes < end
}

function parseLocalMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map((part) => Number.parseInt(part, 10))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return 0
  return hours * 60 + minutes
}
