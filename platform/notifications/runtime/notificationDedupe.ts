import type { NotificationChannel, NotificationPriority, NotificationRuntimeSettings } from '../contracts/notificationContracts'
import type { NotificationRecord } from '../contracts/notificationContracts'
import type { NotificationRequest } from '../contracts/notificationContracts'
import { isActiveNotification } from '../store/notificationStore'

export function findActiveDuplicate(
  records: NotificationRecord[],
  request: NotificationRequest,
  now = new Date().toISOString()
): NotificationRecord | undefined {
  if (!request.dedupeKey) return undefined
  return records.find((record) => record.dedupeKey === request.dedupeKey && isActiveNotification(record, now))
}

export function resolveDeliveryChannels(
  record: NotificationRecord,
  settings: NotificationRuntimeSettings,
  options: { resendTransient?: boolean } = {}
): NotificationChannel[] {
  if (!options.resendTransient) {
    return []
  }

  const channels = record.channels.filter((channel) => {
    if (channel === 'center') return settings.centerEnabled
    if (channel === 'toast') return settings.toastEnabled
    if (channel === 'popup') return settings.popupEnabled
    if (channel === 'desktop') return settings.desktopEnabled
    return false
  })

  return channels.filter((channel) => channel !== 'center')
}

export function shouldBypassThrottle(priority: NotificationPriority): boolean {
  return priority === 'urgent'
}
