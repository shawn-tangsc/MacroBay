import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type {
  CacheBackupPolicy,
  CacheCategory,
  CacheDurability,
  CacheInspectionStatus,
  CacheKind,
  CacheOperationAuditRecord,
  CacheSensitivity,
  SafeCacheView
} from '@platform/storage/cache-governance/cacheContracts'
import { platformText } from '../../../i18n/platformText'

export type StorageCacheLabels = (typeof platformText)['en-US']['storageCache']

export function getStorageCacheLabels(language: AppLanguage): StorageCacheLabels {
  return platformText[language].storageCache
}

export function formatBytes(value: number | undefined, fallback: string): string {
  if (!Number.isFinite(value)) return fallback
  const bytes = Math.max(0, value ?? 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Relative "3 hours ago" for scanning; returns the raw value when it cannot be parsed. */
export function formatRelativeTime(iso: string | undefined, language: AppLanguage, now: number = Date.now()): string {
  if (!iso) return ''
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return iso
  const seconds = Math.round((timestamp - now) / 1000)
  const abs = Math.abs(seconds)
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })

  if (abs < 45) return formatter.format(0, 'second')
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), 'minute')
  if (abs < 86400) return formatter.format(Math.round(seconds / 3600), 'hour')
  if (abs < 2592000) return formatter.format(Math.round(seconds / 86400), 'day')
  if (abs < 31536000) return formatter.format(Math.round(seconds / 2592000), 'month')
  return formatter.format(Math.round(seconds / 31536000), 'year')
}

export function formatAbsoluteTime(iso: string | undefined, language: AppLanguage): string {
  if (!iso) return ''
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return iso
  return new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

export function formatOwner(cache: SafeCacheView, labels: StorageCacheLabels): string {
  return cache.ownerType === 'platform' ? labels.ownerPlatform : labels.ownerProduct(cache.ownerId)
}

export function formatCategory(category: CacheCategory, labels: StorageCacheLabels): string {
  switch (category) {
    case 'platform':
      return labels.categoryPlatform
    case 'ai-runtime':
      return labels.categoryAiRuntime
    case 'product':
      return labels.categoryProduct
    case 'derived-data':
      return labels.categoryDerivedData
  }
}

export function formatKind(kind: CacheKind, labels: StorageCacheLabels): string {
  switch (kind) {
    case 'memory':
      return labels.kindMemory
    case 'runtime-handle':
      return labels.kindRuntimeHandle
    case 'json-file':
      return labels.kindJsonFile
    case 'sqlite-derived':
      return labels.kindSqliteDerived
    case 'local-storage':
      return labels.kindLocalStorage
    case 'parquet-partition':
      return labels.kindParquetPartition
  }
}

export function formatDurability(durability: CacheDurability, labels: StorageCacheLabels): string {
  switch (durability) {
    case 'session-only':
      return labels.durabilitySessionOnly
    case 'persisted-derived':
      return labels.durabilityPersistedDerived
    case 'rebuildable':
      return labels.durabilityRebuildable
    case 'user-data-like':
      return labels.durabilityUserDataLike
  }
}

export function formatSensitivity(sensitivity: CacheSensitivity, labels: StorageCacheLabels): string {
  switch (sensitivity) {
    case 'none':
      return labels.sensitivityNone
    case 'contains-user-content':
      return labels.sensitivityContainsUserContent
    case 'contains-secret-ref':
      return labels.sensitivityContainsSecretRef
  }
}

export function formatBackupPolicy(policy: CacheBackupPolicy, labels: StorageCacheLabels): string {
  switch (policy) {
    case 'exclude':
      return labels.backupExclude
    case 'include':
      return labels.backupInclude
    case 'metadata-only':
      return labels.backupMetadataOnly
  }
}

export function formatInspectionStatus(status: CacheInspectionStatus | undefined, labels: StorageCacheLabels): string {
  switch (status) {
    case 'ready':
      return labels.statusReady
    case 'empty':
      return labels.statusEmpty
    case 'active':
      return labels.statusActive
    case 'inspection_failed':
      return labels.statusInspectionFailed
    default:
      return labels.neverInspected
  }
}

export function formatOperationStatus(
  status: CacheOperationAuditRecord['status'],
  labels: StorageCacheLabels
): string {
  switch (status) {
    case 'succeeded':
      return labels.statusSucceeded
    case 'failed':
      return labels.statusFailed
    case 'skipped':
      return labels.statusSkipped
  }
}

export function dedupeWarnings(warnings: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const warning of warnings) {
    const text = warning.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    result.push(text)
  }
  return result
}
