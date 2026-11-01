export const CACHE_CATEGORIES = ['platform', 'ai-runtime', 'product', 'derived-data'] as const
export type CacheCategory = (typeof CACHE_CATEGORIES)[number]

export const CACHE_OWNER_TYPES = ['platform', 'product'] as const
export type CacheOwnerType = (typeof CACHE_OWNER_TYPES)[number]

export const CACHE_KINDS = [
  'memory',
  'runtime-handle',
  'json-file',
  'sqlite-derived',
  'local-storage',
  'parquet-partition'
] as const
export type CacheKind = (typeof CACHE_KINDS)[number]

export const CACHE_DURABILITIES = [
  'session-only',
  'persisted-derived',
  'rebuildable',
  'user-data-like'
] as const
export type CacheDurability = (typeof CACHE_DURABILITIES)[number]

export const CACHE_SENSITIVITIES = ['none', 'contains-user-content', 'contains-secret-ref'] as const
export type CacheSensitivity = (typeof CACHE_SENSITIVITIES)[number]

/**
 * 备份执行器落地前只允许 `exclude`。
 *
 * `include` / `metadata-only` 是预留值：没有执行者时登记它们，界面就会展示一个不存在的保障。
 * 加回来时必须与「备份执行器真的按它执行」在同一个提交里（2026-11-01 契约裁定，见 `MI-11-R16`）。
 */
export const CACHE_BACKUP_POLICIES = ['exclude'] as const
export type CacheBackupPolicy = (typeof CACHE_BACKUP_POLICIES)[number]

export const CACHE_INSPECTION_STATUSES = ['ready', 'empty', 'active', 'inspection_failed'] as const
export type CacheInspectionStatus = (typeof CACHE_INSPECTION_STATUSES)[number]

/** `invalidate` 已删除：没有任何生产者能写出它，服务与 IPC 只有 clear / compact（2026-11-01 契约裁定）。 */
export const CACHE_OPERATION_TYPES = ['clear', 'compact'] as const
export type CacheOperationType = (typeof CACHE_OPERATION_TYPES)[number]

export const CACHE_OPERATION_STATUSES = ['succeeded', 'failed', 'skipped'] as const
export type CacheOperationStatus = (typeof CACHE_OPERATION_STATUSES)[number]

export const CACHE_ERROR_CODES = [
  'cache_not_found',
  'cache_not_clearable',
  'cache_not_compactable',
  'cache_operation_in_progress',
  'cache_operation_denied',
  'cache_provider_failed',
  'cache_inspection_failed',
  'cache_requires_product',
  'cache_runtime_active'
] as const
export type CacheErrorCode = (typeof CACHE_ERROR_CODES)[number]

export type CacheLocalizedText = {
  'zh-CN'?: string
  'en-US'?: string
}

export type CacheRegistration = {
  cacheId: string
  ownerType: CacheOwnerType
  ownerId: string
  displayName: string
  description: string
  displayNameI18n?: CacheLocalizedText
  descriptionI18n?: CacheLocalizedText
  category: CacheCategory
  cacheKind: CacheKind
  durability: CacheDurability
  sensitivity: CacheSensitivity
  clearable: boolean
  compactable: boolean
  backupPolicy: CacheBackupPolicy
  warnings?: string[]
  warningsI18n?: CacheLocalizedText[]
}

export type CacheInspection = {
  cacheId: string
  status: CacheInspectionStatus
  sizeBytes?: number
  recordCount?: number
  lastUpdatedAt?: string
  active?: boolean
  rebuildable?: boolean
  message?: string
}

export type CacheOperationInput = {
  cacheId: string
  dryRun?: boolean
}

export type CacheOperationResult = {
  operationId: string
  cacheId: string
  operation: CacheOperationType
  dryRun: boolean
  status: CacheOperationStatus
  /**
   * 只入审计留证、无界面消费：审计列表与详情确实在读记录，但不渲染这一列。
   *
   * 它是**记录 JSON 的体积差**，不是「文件将缩小 X 字节」——SQLite 删行不缩文件，两个数不相等。
   *
   * 将来若要展示，只能写「记录体积将减少 X」；「可释放 / 回收空间」这类措辞一律禁止，
   * 除非同批伴随 `VACUUM`（当前不做）。
   */
  removedBytes?: number
  removedRecords?: number
  normalizedErrorCode?: CacheErrorCode
  message?: string
}

export type CacheProvider = {
  inspect?: () => Promise<CacheInspection>
  clear?: (input: CacheOperationInput) => Promise<Omit<CacheOperationResult, 'operationId'>>
  compact?: (input: CacheOperationInput) => Promise<Omit<CacheOperationResult, 'operationId'>>
}

export type CacheRegistrationWithProvider = CacheRegistration & {
  provider?: CacheProvider
}

export type CacheOperationAuditRecord = {
  operationId: string
  cacheId: string
  ownerType: CacheOwnerType
  ownerId: string
  operation: CacheOperationType
  dryRun: boolean
  requestedAt: string
  completedAt?: string
  status: CacheOperationStatus
  /**
   * 只入审计留证、无界面消费：审计列表与详情确实在读记录，但不渲染这一列。
   *
   * 它是**记录 JSON 的体积差**，不是「文件将缩小 X 字节」——SQLite 删行不缩文件，两个数不相等。
   *
   * 将来若要展示，只能写「记录体积将减少 X」；「可释放 / 回收空间」这类措辞一律禁止，
   * 除非同批伴随 `VACUUM`（当前不做）。
   */
  removedBytes?: number
  removedRecords?: number
  normalizedErrorCode?: CacheErrorCode
  message?: string
}

export type CacheOperationQuery = {
  cacheId?: string
  ownerType?: CacheOwnerType
  ownerId?: string
  limit?: number
  cursor?: string | null
}

export type CacheOperationPage = {
  records: CacheOperationAuditRecord[]
  nextCursor: string | null
}

export type SafeCacheView = {
  cacheId: string
  ownerType: CacheOwnerType
  ownerId: string
  displayName: string
  description: string
  displayNameI18n?: CacheLocalizedText
  descriptionI18n?: CacheLocalizedText
  category: CacheCategory
  cacheKind: CacheKind
  durability: CacheDurability
  sensitivity: CacheSensitivity
  clearable: boolean
  compactable: boolean
  backupPolicy: CacheBackupPolicy
  warnings: string[]
  warningsI18n?: CacheLocalizedText[]
  latestInspection?: CacheInspection
  latestOperation?: CacheOperationAuditRecord
}

export function isCacheErrorCode(value: unknown): value is CacheErrorCode {
  return typeof value === 'string' && CACHE_ERROR_CODES.includes(value as CacheErrorCode)
}

export function normalizeCacheRegistration(
  input: CacheRegistrationWithProvider,
  options?: { allowClearableUserDataLike?: boolean }
): CacheRegistrationWithProvider {
  const warnings = Array.isArray(input.warnings)
    ? input.warnings.filter((warning): warning is string => typeof warning === 'string' && warning.trim().length > 0)
    : []
  const warningsI18n = Array.isArray(input.warningsI18n)
    ? input.warningsI18n.filter(
        (warning): warning is CacheLocalizedText =>
          Boolean(warning) && typeof warning === 'object' && (typeof warning['zh-CN'] === 'string' || typeof warning['en-US'] === 'string')
      )
    : undefined

  if (input.durability === 'user-data-like' && input.clearable && !options?.allowClearableUserDataLike) {
    throw new Error(`Cache "${input.cacheId}" cannot be clearable when durability is user-data-like.`)
  }

  return {
    ...input,
    displayName: input.displayName.trim(),
    description: input.description.trim(),
    ownerId: input.ownerId.trim(),
    warnings,
    warningsI18n,
    displayNameI18n: normalizeLocalizedText(input.displayNameI18n),
    descriptionI18n: normalizeLocalizedText(input.descriptionI18n)
  }
}

export function toSafeCacheView(
  registration: CacheRegistration,
  input?: {
    latestInspection?: CacheInspection
    latestOperation?: CacheOperationAuditRecord
  }
): SafeCacheView {
  return {
    cacheId: registration.cacheId,
    ownerType: registration.ownerType,
    ownerId: registration.ownerId,
    displayName: registration.displayName,
    description: registration.description,
    displayNameI18n: registration.displayNameI18n,
    descriptionI18n: registration.descriptionI18n,
    category: registration.category,
    cacheKind: registration.cacheKind,
    durability: registration.durability,
    sensitivity: registration.sensitivity,
    clearable: registration.clearable,
    compactable: registration.compactable,
    backupPolicy: registration.backupPolicy,
    warnings: registration.warnings ?? [],
    warningsI18n: registration.warningsI18n,
    latestInspection: input?.latestInspection,
    latestOperation: input?.latestOperation
  }
}

export function createCacheOperationFailure(input: {
  operationId: string
  cacheId: string
  operation: CacheOperationType
  dryRun: boolean
  normalizedErrorCode: CacheErrorCode
  message?: string
}): CacheOperationResult {
  return {
    operationId: input.operationId,
    cacheId: input.cacheId,
    operation: input.operation,
    dryRun: input.dryRun,
    status: 'failed',
    normalizedErrorCode: input.normalizedErrorCode,
    message: input.message
  }
}

function normalizeLocalizedText(value: CacheLocalizedText | undefined): CacheLocalizedText | undefined {
  if (!value) return undefined
  const zh = typeof value['zh-CN'] === 'string' && value['zh-CN'].trim().length > 0 ? value['zh-CN'].trim() : undefined
  const en = typeof value['en-US'] === 'string' && value['en-US'].trim().length > 0 ? value['en-US'].trim() : undefined
  if (!zh && !en) return undefined
  return {
    ...(zh ? { 'zh-CN': zh } : {}),
    ...(en ? { 'en-US': en } : {})
  }
}
