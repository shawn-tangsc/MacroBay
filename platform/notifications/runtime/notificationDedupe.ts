import type { NotificationPriority } from '../contracts/notificationContracts'
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

export function shouldBypassThrottle(priority: NotificationPriority): boolean {
  return priority === 'urgent'
}
