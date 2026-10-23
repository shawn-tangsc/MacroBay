import {
  createDefaultNotificationRuntimeSettings,
  PRIORITY_RANK,
  SEVERITY_RANK,
  type NotificationChannel,
  type NotificationPriority,
  type NotificationRecord,
  type NotificationRequest,
  type NotificationRuntimeSettings,
  type NotificationSeverity,
  type NotificationState
} from '../contracts/notificationContracts'

export type NotificationStoreState = {
  records: NotificationRecord[]
}

export function createDefaultNotificationStoreState(): NotificationStoreState {
  return {
    records: []
  }
}

let idCounter = 0

export function createNotificationId(prefix = 'notification'): string {
  idCounter += 1
  return `${prefix}-${Date.now()}-${idCounter}`
}

export function resetNotificationIdCounterForTests(): void {
  idCounter = 0
}

export function normalizeNotificationRecord(value: unknown): NotificationRecord | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<NotificationRecord>
  if (!candidate.id || !candidate.sourceId || !candidate.title) return null

  return {
    id: String(candidate.id),
    owner: candidate.owner === 'platform' ? 'platform' : 'product',
    productId: candidate.productId ? String(candidate.productId) : undefined,
    sourceId: String(candidate.sourceId),
    title: String(candidate.title),
    body: candidate.body ? String(candidate.body) : undefined,
    severity: normalizeSeverity(candidate.severity),
    priority: normalizePriority(candidate.priority),
    channels: normalizeChannels(candidate.channels),
    state: normalizeState(candidate.state),
    deeplink: candidate.deeplink,
    actions: Array.isArray(candidate.actions) ? candidate.actions : [],
    dedupeKey: candidate.dedupeKey ? String(candidate.dedupeKey) : undefined,
    correlationId: candidate.correlationId ? String(candidate.correlationId) : undefined,
    safeMetadata:
      candidate.safeMetadata && typeof candidate.safeMetadata === 'object'
        ? (candidate.safeMetadata as Record<string, unknown>)
        : undefined,
    occurrenceCount: typeof candidate.occurrenceCount === 'number' ? Math.max(1, candidate.occurrenceCount) : 1,
    createdAt: String(candidate.createdAt ?? new Date().toISOString()),
    updatedAt: String(candidate.updatedAt ?? candidate.createdAt ?? new Date().toISOString()),
    readAt: candidate.readAt ? String(candidate.readAt) : undefined,
    acknowledgedAt: candidate.acknowledgedAt ? String(candidate.acknowledgedAt) : undefined,
    dismissedAt: candidate.dismissedAt ? String(candidate.dismissedAt) : undefined,
    snoozedUntil: candidate.snoozedUntil ? String(candidate.snoozedUntil) : undefined,
    expiresAt: candidate.expiresAt ? String(candidate.expiresAt) : undefined
  }
}

export function normalizeNotificationStoreState(value: unknown): NotificationStoreState {
  const defaults = createDefaultNotificationStoreState()
  if (!value || typeof value !== 'object') return defaults
  const candidate = value as Partial<NotificationStoreState>
  const records = Array.isArray(candidate.records)
    ? candidate.records.map(normalizeNotificationRecord).filter((record): record is NotificationRecord => Boolean(record))
    : []
  return { records }
}

export function createNotificationFromRequest(request: NotificationRequest, now = new Date().toISOString()): NotificationRecord {
  return {
    id: createNotificationId(),
    owner: request.owner,
    productId: request.productId,
    sourceId: request.sourceId,
    title: request.title,
    body: request.body,
    severity: request.severity,
    priority: request.priority,
    channels: request.requestedChannels.includes('center') ? request.requestedChannels : ['center', ...request.requestedChannels],
    state: 'unread',
    deeplink: request.deeplink,
    actions: request.actions ?? [],
    dedupeKey: request.dedupeKey,
    correlationId: request.correlationId,
    safeMetadata: request.safeMetadata,
    occurrenceCount: 1,
    createdAt: now,
    updatedAt: now,
    expiresAt: request.expiresAt
  }
}

export function mergeDuplicateNotification(existing: NotificationRecord, incoming: NotificationRequest, now: string): NotificationRecord {
  return {
    ...existing,
    title: incoming.title,
    body: incoming.body ?? existing.body,
    severity: strongerSeverity(existing.severity, incoming.severity),
    priority: strongerPriority(existing.priority, incoming.priority),
    channels: uniqueChannels([...existing.channels, ...incoming.requestedChannels]),
    updatedAt: now,
    occurrenceCount: existing.occurrenceCount + 1,
    expiresAt: incoming.expiresAt ?? existing.expiresAt,
    safeMetadata: incoming.safeMetadata ?? existing.safeMetadata
  }
}

export function markNotificationRead(record: NotificationRecord, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'dismissed' || record.state === 'expired') return record
  return {
    ...record,
    state: record.state === 'acknowledged' ? 'acknowledged' : 'read',
    readAt: record.readAt ?? now,
    updatedAt: now
  }
}

export function acknowledgeNotification(record: NotificationRecord, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'dismissed' || record.state === 'expired') return record
  return {
    ...record,
    state: 'acknowledged',
    readAt: record.readAt ?? now,
    acknowledgedAt: now,
    updatedAt: now
  }
}

export function dismissNotification(record: NotificationRecord, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'expired') return record
  return {
    ...record,
    state: 'dismissed',
    dismissedAt: now,
    updatedAt: now
  }
}

export function snoozeNotification(record: NotificationRecord, until: string, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'dismissed' || record.state === 'expired') return record
  return {
    ...record,
    state: 'snoozed',
    snoozedUntil: until,
    updatedAt: now
  }
}

export function expireNotification(record: NotificationRecord, now = new Date().toISOString()): NotificationRecord {
  if (record.state === 'dismissed') return record
  return {
    ...record,
    state: 'expired',
    updatedAt: now
  }
}

export function reactivateSnoozedNotifications(records: NotificationRecord[], now = new Date().toISOString()): NotificationRecord[] {
  return records.map((record) => {
    if (record.state !== 'snoozed' || !record.snoozedUntil) return record
    if (record.snoozedUntil > now) return record
    return {
      ...record,
      state: 'unread',
      snoozedUntil: undefined,
      updatedAt: now
    }
  })
}

export function expireDueNotifications(records: NotificationRecord[], now = new Date().toISOString()): NotificationRecord[] {
  return records.map((record) => {
    if (!record.expiresAt || record.expiresAt > now) return record
    return expireNotification(record, now)
  })
}

export function isActiveNotification(record: NotificationRecord, now = new Date().toISOString()): boolean {
  if (record.state === 'dismissed' || record.state === 'expired') return false
  if (record.state === 'snoozed' && record.snoozedUntil && record.snoozedUntil > now) return false
  return true
}

function normalizeSeverity(value: unknown): NotificationSeverity {
  if (value === 'success' || value === 'warning' || value === 'critical') return value
  return 'info'
}

function normalizePriority(value: unknown): NotificationPriority {
  if (value === 'low' || value === 'high' || value === 'urgent') return value
  return 'normal'
}

function normalizeState(value: unknown): NotificationState {
  if (
    value === 'read' ||
    value === 'acknowledged' ||
    value === 'dismissed' ||
    value === 'snoozed' ||
    value === 'expired'
  ) {
    return value
  }
  return 'unread'
}

function normalizeChannels(value: unknown): NotificationChannel[] {
  if (!Array.isArray(value)) return ['center']
  const allowed: NotificationChannel[] = ['center', 'toast', 'popup', 'desktop']
  const channels = value.filter((item): item is NotificationChannel => allowed.includes(item as NotificationChannel))
  return channels.length > 0 ? uniqueChannels(channels) : ['center']
}

function strongerSeverity(left: NotificationSeverity, right: NotificationSeverity): NotificationSeverity {
  return SEVERITY_RANK[left] >= SEVERITY_RANK[right] ? left : right
}

function strongerPriority(left: NotificationPriority, right: NotificationPriority): NotificationPriority {
  return PRIORITY_RANK[left] >= PRIORITY_RANK[right] ? left : right
}

function uniqueChannels(channels: NotificationChannel[]): NotificationChannel[] {
  return [...new Set(channels)]
}
