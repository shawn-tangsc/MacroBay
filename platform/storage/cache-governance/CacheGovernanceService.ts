import { randomUUID } from 'node:crypto'

import type { CacheOperationAuditRepository } from './CacheOperationAuditRepository'
import { CacheRegistry } from './CacheRegistry'
import {
  createCacheOperationFailure,
  toSafeCacheView,
  type CacheErrorCode,
  type CacheInspection,
  type CacheOperationAuditRecord,
  type CacheOperationPage,
  type CacheOperationQuery,
  type CacheOperationResult,
  type CacheOperationType,
  type SafeCacheView
} from './cacheContracts'

type CacheGovernanceServiceDeps = {
  registry: CacheRegistry
  auditRepository: CacheOperationAuditRepository
  now?: () => Date
  createOperationId?: () => string
}

export class CacheGovernanceService {
  private readonly operationLocks = new Set<string>()
  private readonly latestInspections = new Map<string, CacheInspection>()
  private readonly latestOperations = new Map<string, CacheOperationAuditRecord>()

  constructor(private readonly deps: CacheGovernanceServiceDeps) {}

  async listCaches(): Promise<SafeCacheView[]> {
    await this.primeInspectionSummaries()
    const latestOperations = await this.listLatestOperationsByCache()
    return this.deps.registry.toSafeViews({
      inspections: this.latestInspections,
      latestOperations
    })
  }

  async inspectCache(cacheId: string): Promise<SafeCacheView> {
    const registration = this.deps.registry.getWithProvider(cacheId)
    if (!registration) {
      throw createGovernanceError('cache_not_found', `Cache "${cacheId}" was not found.`)
    }

    const inspection = await this.runInspection(cacheId)
    const latestOperations = await this.listLatestOperationsByCache()
    return toSafeCacheView(this.deps.registry.get(cacheId)!, {
      latestInspection: inspection,
      latestOperation: latestOperations.get(cacheId)
    })
  }

  async clearCache(cacheId: string, options?: { dryRun?: boolean }): Promise<CacheOperationResult> {
    return this.runOperation('clear', cacheId, options?.dryRun === true)
  }

  async compactCache(cacheId: string, options?: { dryRun?: boolean }): Promise<CacheOperationResult> {
    return this.runOperation('compact', cacheId, options?.dryRun === true)
  }

  async listOperations(query?: CacheOperationQuery): Promise<CacheOperationPage> {
    return this.deps.auditRepository.listPage(query)
  }

  private async primeInspectionSummaries(): Promise<void> {
    const registrations = this.deps.registry.list()
    const uncached = registrations
      .map((registration) => registration.cacheId)
      .filter((cacheId) => !this.latestInspections.has(cacheId))

    if (uncached.length === 0) return

    await Promise.all(
      uncached.map(async (cacheId) => {
        await this.runInspection(cacheId).catch(() => undefined)
      })
    )
  }

  private async runInspection(cacheId: string): Promise<CacheInspection> {
    const registration = this.deps.registry.getWithProvider(cacheId)
    if (!registration) {
      throw createGovernanceError('cache_not_found', `Cache "${cacheId}" was not found.`)
    }

    if (!registration.provider?.inspect) {
      const fallback: CacheInspection = {
        cacheId,
        status: 'inspection_failed',
        message: 'Inspection is not available for this cache.'
      }
      this.latestInspections.set(cacheId, fallback)
      return fallback
    }

    try {
      const result = await registration.provider.inspect()
      const normalized = { ...result, cacheId }
      this.latestInspections.set(cacheId, normalized)
      return normalized
    } catch (error) {
      const fallback: CacheInspection = {
        cacheId,
        status: 'inspection_failed',
        message: normalizeProviderMessage(error, 'Inspection failed.')
      }
      this.latestInspections.set(cacheId, fallback)
      return fallback
    }
  }

  private async runOperation(
    operation: Extract<CacheOperationType, 'clear' | 'compact'>,
    cacheId: string,
    dryRun: boolean
  ): Promise<CacheOperationResult> {
    const registration = this.deps.registry.getWithProvider(cacheId)
    const operationId = this.createOperationId()
    const requestedAt = this.now().toISOString()

    if (!registration) {
      return this.auditAndReturn(
        registration,
        {
          operationId,
          cacheId,
          ownerType: 'platform',
          ownerId: 'platform',
          operation,
          dryRun,
          requestedAt,
          completedAt: this.now().toISOString(),
          status: 'failed',
          normalizedErrorCode: 'cache_not_found',
          message: `Cache "${cacheId}" was not found.`
        },
        createCacheOperationFailure({
          operationId,
          cacheId,
          operation,
          dryRun,
          normalizedErrorCode: 'cache_not_found',
          message: `Cache "${cacheId}" was not found.`
        })
      )
    }

    if (operation === 'clear' && (!registration.clearable || !registration.provider?.clear)) {
      return this.auditFailure(registration, {
        operationId,
        cacheId,
        operation,
        dryRun,
        requestedAt,
        normalizedErrorCode: 'cache_not_clearable',
        message: `Cache "${cacheId}" is not clearable.`
      })
    }

    if (operation === 'compact' && (!registration.compactable || !registration.provider?.compact)) {
      return this.auditFailure(registration, {
        operationId,
        cacheId,
        operation,
        dryRun,
        requestedAt,
        normalizedErrorCode: 'cache_not_compactable',
        message: `Cache "${cacheId}" is not compactable.`
      })
    }

    if (this.operationLocks.has(cacheId)) {
      return this.auditFailure(registration, {
        operationId,
        cacheId,
        operation,
        dryRun,
        requestedAt,
        normalizedErrorCode: 'cache_operation_in_progress',
        message: `Cache "${cacheId}" already has an operation in progress.`
      })
    }

    this.operationLocks.add(cacheId)
    try {
      const providerResult =
        operation === 'clear'
          ? await registration.provider!.clear!({ cacheId, dryRun })
          : await registration.provider!.compact!({ cacheId, dryRun })

      const result: CacheOperationResult = {
        ...providerResult,
        operationId,
        cacheId,
        operation,
        dryRun
      }
      const auditRecord: CacheOperationAuditRecord = {
        operationId,
        cacheId,
        ownerType: registration.ownerType,
        ownerId: registration.ownerId,
        operation,
        dryRun,
        requestedAt,
        completedAt: this.now().toISOString(),
        status: result.status,
        removedBytes: result.removedBytes,
        removedRecords: result.removedRecords,
        normalizedErrorCode: result.normalizedErrorCode,
        message: result.message
      }
      return this.auditAndReturn(registration, auditRecord, result)
    } catch (error) {
      const normalizedErrorCode = normalizeProviderErrorCode(error)
      return this.auditFailure(registration, {
        operationId,
        cacheId,
        operation,
        dryRun,
        requestedAt,
        normalizedErrorCode,
        message: normalizeProviderMessage(error, 'Cache operation failed.')
      })
    } finally {
      this.operationLocks.delete(cacheId)
      await this.runInspection(cacheId).catch(() => undefined)
    }
  }

  private async auditFailure(
    registration: { ownerType: 'platform' | 'product'; ownerId: string } | null,
    input: {
      operationId: string
      cacheId: string
      operation: Extract<CacheOperationType, 'clear' | 'compact'>
      dryRun: boolean
      requestedAt: string
      normalizedErrorCode: CacheErrorCode
      message: string
    }
  ): Promise<CacheOperationResult> {
    const result = createCacheOperationFailure({
      operationId: input.operationId,
      cacheId: input.cacheId,
      operation: input.operation,
      dryRun: input.dryRun,
      normalizedErrorCode: input.normalizedErrorCode,
      message: input.message
    })
    const auditRecord: CacheOperationAuditRecord = {
      operationId: input.operationId,
      cacheId: input.cacheId,
      ownerType: registration?.ownerType ?? 'platform',
      ownerId: registration?.ownerId ?? 'platform',
      operation: input.operation,
      dryRun: input.dryRun,
      requestedAt: input.requestedAt,
      completedAt: this.now().toISOString(),
      status: 'failed',
      normalizedErrorCode: input.normalizedErrorCode,
      message: input.message
    }
    return this.auditAndReturn(registration, auditRecord, result)
  }

  private async auditAndReturn(
    _registration: { ownerType: 'platform' | 'product'; ownerId: string } | null,
    record: CacheOperationAuditRecord,
    result: CacheOperationResult
  ): Promise<CacheOperationResult> {
    await this.deps.auditRepository.append(record)
    this.latestOperations.set(record.cacheId, record)
    return result
  }

  private async listLatestOperationsByCache(): Promise<Map<string, CacheOperationAuditRecord>> {
    const page = await this.deps.auditRepository.listPage({ limit: 200 })
    const latest = new Map<string, CacheOperationAuditRecord>()
    for (const record of page.records) {
      if (!latest.has(record.cacheId)) {
        latest.set(record.cacheId, record)
      }
    }
    for (const [cacheId, record] of this.latestOperations.entries()) {
      if (!latest.has(cacheId)) latest.set(cacheId, record)
    }
    return latest
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private createOperationId(): string {
    return this.deps.createOperationId?.() ?? randomUUID()
  }
}

function normalizeProviderErrorCode(error: unknown): CacheErrorCode {
  if (typeof error === 'object' && error && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (code === 'cache_runtime_active') return 'cache_runtime_active'
  }
  return 'cache_provider_failed'
}

function normalizeProviderMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

function createGovernanceError(code: CacheErrorCode, message: string): Error & { code: CacheErrorCode } {
  const error = new Error(message) as Error & { code: CacheErrorCode }
  error.code = code
  return error
}
