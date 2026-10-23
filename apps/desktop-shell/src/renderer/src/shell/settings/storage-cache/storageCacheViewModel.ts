import type { AppLanguage } from '@platform/settings/schema/appSettings'
import type {
  CacheCategory,
  CacheLocalizedText,
  CacheOperationResult,
  CacheOperationType,
  SafeCacheView
} from '@platform/storage/cache-governance/cacheContracts'
import { platformText } from '../../../i18n/platformText'

export type StorageCacheFilterKey = 'all' | 'platform' | 'ai-runtime' | 'product' | 'derived-data'

export function listStorageCacheFilters(language: AppLanguage): Array<{ key: StorageCacheFilterKey; label: string }> {
  const labels = platformText[language].storageCache
  return [
    { key: 'all', label: labels.tabAll },
    { key: 'platform', label: labels.tabPlatform },
    { key: 'ai-runtime', label: labels.tabAiRuntime },
    { key: 'product', label: labels.tabProducts },
    { key: 'derived-data', label: labels.tabDerivedData }
  ]
}

export function filterCachesByKey(caches: SafeCacheView[], filter: StorageCacheFilterKey): SafeCacheView[] {
  if (filter === 'all') return caches
  return caches.filter((cache) => {
    if (filter === 'product') return cache.ownerType === 'product'
    return cache.category === (filter as CacheCategory)
  })
}

export function buildStorageCacheSummary(caches: SafeCacheView[]): {
  totalCaches: number
  clearableCaches: number
  sensitiveCaches: number
  totalSizeBytes: number
} {
  return {
    totalCaches: caches.length,
    clearableCaches: caches.filter((cache) => cache.clearable).length,
    sensitiveCaches: caches.filter(isSensitiveOrDerivedCache).length,
    totalSizeBytes: caches.reduce((total, cache) => total + Math.max(0, cache.latestInspection?.sizeBytes ?? 0), 0)
  }
}

export function isSensitiveOrDerivedCache(cache: SafeCacheView): boolean {
  return cache.sensitivity === 'contains-user-content' || cache.category === 'derived-data'
}

export function shouldConfirmCompact(cache: SafeCacheView): boolean {
  return cache.compactable && isSensitiveOrDerivedCache(cache)
}

export function buildConfirmMessage(
  input: {
    cache: SafeCacheView
    operation: Extract<CacheOperationType, 'clear' | 'compact'>
    dryRun: boolean
  },
  language: AppLanguage
): string {
  const labels = platformText[language].storageCache
  const lines = [
    input.operation === 'clear' ? labels.confirmClear(input.cache.displayName) : labels.confirmCompact(input.cache.displayName),
    labels.confirmDerivedWarning
  ]

  if (isSensitiveOrDerivedCache(input.cache)) {
    lines.push(input.operation === 'clear' ? labels.confirmSensitiveClear : labels.confirmSensitiveCompact)
  }

  if (input.dryRun) {
    lines.push(labels.confirmDryRunHint)
  }

  return lines.join('\n\n')
}

export function confirmStorageCacheAction(
  input: {
    cache: SafeCacheView
    operation: Extract<CacheOperationType, 'clear' | 'compact'>
    dryRun: boolean
  },
  language: AppLanguage,
  confirmImpl: (message: string) => boolean
): boolean {
  if (input.operation === 'compact' && !shouldConfirmCompact(input.cache)) {
    return true
  }
  return confirmImpl(buildConfirmMessage(input, language))
}

export function formatStorageOperationType(operation: CacheOperationType, language: AppLanguage): string {
  const labels = platformText[language].storageCache
  switch (operation) {
    case 'clear':
      return labels.operationClear
    case 'compact':
      return labels.operationCompact
    case 'invalidate':
      return labels.operationInvalidate
  }
}

export function resolveStorageCacheText(
  value: string,
  localized: CacheLocalizedText | undefined,
  language: AppLanguage
): string {
  return localized?.[language] ?? localized?.['en-US'] ?? localized?.['zh-CN'] ?? value
}

export function resolveStorageCacheWarnings(cache: SafeCacheView, language: AppLanguage): string[] {
  if (Array.isArray(cache.warningsI18n) && cache.warningsI18n.length > 0) {
    const localized = cache.warningsI18n
      .map((warning) => resolveStorageCacheText('', warning, language))
      .filter((warning) => warning.trim().length > 0)
    if (localized.length > 0) return localized
  }
  return cache.warnings
}

export function formatStorageOperationToast(
  cache: SafeCacheView,
  result: CacheOperationResult,
  language: AppLanguage
): string {
  const labels = platformText[language].storageCache
  const name = resolveStorageCacheText(cache.displayName, cache.displayNameI18n, language)
  if (result.status === 'skipped') return labels.toastSkipped(name)
  if (result.operation === 'clear') return labels.toastCleared(name, result.dryRun)
  if (result.operation === 'compact') return labels.toastCompacted(name, result.dryRun)
  return labels.operationSuccess
}
