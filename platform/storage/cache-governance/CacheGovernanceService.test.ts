import { describe, expect, it, vi } from 'vitest'

import { InMemoryCacheOperationAuditRepository } from './CacheOperationAuditRepository'
import { CacheGovernanceService } from './CacheGovernanceService'
import { CacheRegistry } from './CacheRegistry'
import type { CacheRegistrationWithProvider } from './cacheContracts'

describe('CacheGovernanceService', () => {
  it('returns cache_not_found for unknown caches', async () => {
    const service = createService()

    await expect(service.clearCache('platform.unknown')).resolves.toMatchObject({
      status: 'failed',
      normalizedErrorCode: 'cache_not_found'
    })
  })

  it('returns cache_not_clearable for non-clearable caches', async () => {
    const service = createService({
      registration: createRegistration({ clearable: false })
    })

    await expect(service.clearCache('platform.agent-runtime-compatibility')).resolves.toMatchObject({
      status: 'failed',
      normalizedErrorCode: 'cache_not_clearable'
    })
  })

  it('normalizes provider failure and audits it', async () => {
    const repository = new InMemoryCacheOperationAuditRepository()
    const service = createService({
      repository,
      registration: createRegistration({
        clearable: true,
        provider: {
          clear: vi.fn(async () => {
            throw new Error('provider exploded')
          })
        }
      })
    })

    const result = await service.clearCache('platform.agent-runtime-compatibility')
    expect(result).toMatchObject({
      status: 'failed',
      normalizedErrorCode: 'cache_provider_failed',
      message: 'provider exploded'
    })

    const page = await repository.listPage()
    expect(page.records[0]).toMatchObject({
      cacheId: 'platform.agent-runtime-compatibility',
      normalizedErrorCode: 'cache_provider_failed',
      status: 'failed'
    })
  })

  it('rejects concurrent operations on the same cache', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = createService({
      registration: createRegistration({
        clearable: true,
        provider: {
          clear: vi.fn(async ({ cacheId, dryRun }) => {
            await pending
            return {
              cacheId,
              operation: 'clear' as const,
              dryRun: dryRun === true,
              status: 'succeeded' as const
            }
          })
        }
      })
    })

    const first = service.clearCache('platform.agent-runtime-compatibility')
    const second = await service.clearCache('platform.agent-runtime-compatibility')

    expect(second).toMatchObject({
      status: 'failed',
      normalizedErrorCode: 'cache_operation_in_progress'
    })

    release()
    await expect(first).resolves.toMatchObject({ status: 'succeeded' })
  })

  it('supports dry-run without mutating provider state', async () => {
    const clear = vi.fn(async ({ cacheId, dryRun }: { cacheId: string; dryRun?: boolean }) => ({
      cacheId,
      operation: 'clear' as const,
      dryRun: dryRun === true,
      status: 'skipped' as const,
      removedBytes: 1024,
      removedRecords: 8
    }))
    const service = createService({
      registration: createRegistration({
        clearable: true,
        provider: { clear }
      })
    })

    const result = await service.clearCache('platform.agent-runtime-compatibility', { dryRun: true })
    expect(result).toMatchObject({
      dryRun: true,
      status: 'skipped',
      removedBytes: 1024,
      removedRecords: 8
    })
    expect(clear).toHaveBeenCalledWith({ cacheId: 'platform.agent-runtime-compatibility', dryRun: true })
  })

  it('writes audit records for success and failure results', async () => {
    const repository = new InMemoryCacheOperationAuditRepository()
    const service = createService({
      repository,
      registration: createRegistration({
        clearable: true,
        compactable: true,
        provider: {
          clear: vi.fn(async ({ cacheId, dryRun }) => ({
            cacheId,
            operation: 'clear' as const,
            dryRun: dryRun === true,
            status: 'succeeded' as const,
            removedRecords: 2
          })),
          compact: vi.fn(async () => {
            throw new Error('compact failed')
          })
        }
      })
    })

    await service.clearCache('platform.agent-runtime-compatibility')
    await service.compactCache('platform.agent-runtime-compatibility')

    const page = await repository.listPage({ limit: 10 })
    expect(page.records).toHaveLength(2)
    expect(page.records.some((record) => record.status === 'succeeded')).toBe(true)
    expect(page.records.some((record) => record.status === 'failed')).toBe(true)
  })

  it('hydrates lightweight inspection summaries during listCaches', async () => {
    const inspect = vi.fn(async () => ({
      cacheId: 'platform.agent-runtime-compatibility',
      status: 'ready' as const,
      recordCount: 3,
      sizeBytes: 512,
      lastUpdatedAt: '2026-07-12T12:00:00.000Z'
    }))
    const service = createService({
      registration: createRegistration({
        provider: { inspect }
      })
    })

    const caches = await service.listCaches()

    expect(inspect).toHaveBeenCalledOnce()
    expect(caches[0]?.latestInspection).toMatchObject({
      recordCount: 3,
      sizeBytes: 512,
      lastUpdatedAt: '2026-07-12T12:00:00.000Z'
    })
  })

  it('re-reads every inspection on every list, so Refresh shows the current numbers', async () => {
    let sizeBytes = 512
    const inspect = vi.fn(async () => ({
      cacheId: 'platform.agent-runtime-compatibility',
      status: 'ready' as const,
      recordCount: 3,
      sizeBytes,
      lastUpdatedAt: '2026-07-12T12:00:00.000Z'
    }))
    const service = createService({
      registration: createRegistration({ provider: { inspect } })
    })

    const beforeRefresh = await service.listCaches()
    sizeBytes = 1024
    const afterRefresh = await service.listCaches()

    expect(inspect).toHaveBeenCalledTimes(2)
    expect(beforeRefresh[0]?.latestInspection).toMatchObject({ sizeBytes: 512 })
    expect(afterRefresh[0]?.latestInspection).toMatchObject({ sizeBytes: 1024 })
  })

  it('shares one in-flight refresh between overlapping lists instead of stacking inspections', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const inspect = vi.fn(async () => {
      await pending
      return { cacheId: 'platform.agent-runtime-compatibility', status: 'ready' as const, sizeBytes: 1 }
    })
    const service = createService({
      registration: createRegistration({ provider: { inspect } })
    })

    const first = service.listCaches()
    const second = service.listCaches()
    release()
    const [firstViews, secondViews] = await Promise.all([first, second])

    // 次数在这里是契约本身：合并的是「同一次在飞巡检」，没有别的东西能观测到它。
    // 两个并发调用还必须拿到同一份结果——否则「少扫一次」可能是把第二次调用饿死。
    expect(inspect).toHaveBeenCalledOnce()
    expect(firstViews[0]?.latestInspection).toMatchObject({ sizeBytes: 1 })
    expect(secondViews[0]?.latestInspection).toMatchObject({ sizeBytes: 1 })

    // 巡检结束后再点刷新，仍然重新读一遍（合并只覆盖重叠窗口，不是永久缓存）。
    await service.listCaches()
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  it('preserves localized cache metadata in list and inspect results', async () => {
    const service = createService({
      registration: createRegistration({
        displayNameI18n: {
          'zh-CN': 'Agent 运行时兼容性',
          'en-US': 'Agent runtime compatibility'
        },
        descriptionI18n: {
          'zh-CN': '运行时探测缓存',
          'en-US': 'Runtime probe cache'
        },
        warningsI18n: [
          {
            'zh-CN': '清理后会重新计算兼容性探测结果。',
            'en-US': 'Clearing recomputes compatibility probes.'
          }
        ],
        provider: {
          inspect: vi.fn(async () => ({
            cacheId: 'platform.agent-runtime-compatibility',
            status: 'ready' as const
          }))
        }
      })
    })

    const listed = await service.listCaches()
    const inspected = await service.inspectCache('platform.agent-runtime-compatibility')

    expect(listed[0]).toMatchObject({
      displayNameI18n: {
        'zh-CN': 'Agent 运行时兼容性',
        'en-US': 'Agent runtime compatibility'
      },
      descriptionI18n: {
        'zh-CN': '运行时探测缓存',
        'en-US': 'Runtime probe cache'
      },
      warningsI18n: [
        {
          'zh-CN': '清理后会重新计算兼容性探测结果。',
          'en-US': 'Clearing recomputes compatibility probes.'
        }
      ]
    })
    expect(inspected).toMatchObject({
      displayNameI18n: {
        'zh-CN': 'Agent 运行时兼容性',
        'en-US': 'Agent runtime compatibility'
      },
      descriptionI18n: {
        'zh-CN': '运行时探测缓存',
        'en-US': 'Runtime probe cache'
      },
      warningsI18n: [
        {
          'zh-CN': '清理后会重新计算兼容性探测结果。',
          'en-US': 'Clearing recomputes compatibility probes.'
        }
      ]
    })
  })
})

function createService(input?: {
  repository?: InMemoryCacheOperationAuditRepository
  registration?: CacheRegistrationWithProvider
}) {
  const registry = new CacheRegistry()
  if (input?.registration) {
    registry.register(input.registration)
  }
  return new CacheGovernanceService({
    registry,
    auditRepository: input?.repository ?? new InMemoryCacheOperationAuditRepository(),
    now: () => new Date('2026-07-12T12:00:00.000Z'),
    createOperationId: () => 'op-fixed'
  })
}

function createRegistration(
  overrides: Partial<CacheRegistrationWithProvider> = {}
): CacheRegistrationWithProvider {
  return {
    cacheId: 'platform.agent-runtime-compatibility',
    ownerType: 'platform',
    ownerId: 'platform',
    displayName: 'Agent runtime compatibility',
    description: 'Probe cache.',
    category: 'ai-runtime',
    cacheKind: 'json-file',
    durability: 'rebuildable',
    sensitivity: 'none',
    clearable: false,
    compactable: false,
    backupPolicy: 'exclude',
    warnings: [],
    ...overrides
  }
}
