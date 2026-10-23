import type { CacheGovernanceService } from '../../storage/cache-governance/CacheGovernanceService'
import type { CacheOperationQuery } from '../../storage/cache-governance/cacheContracts'

export function createCacheGovernanceIpcHandlers(service: CacheGovernanceService) {
  return {
    listCaches: async () => service.listCaches(),
    inspectCache: async (cacheId: unknown) => service.inspectCache(assertCacheId(cacheId)),
    clearCache: async (input: unknown) => {
      const parsed = parseOperationInput(input)
      return service.clearCache(parsed.cacheId, { dryRun: parsed.dryRun })
    },
    compactCache: async (input: unknown) => {
      const parsed = parseOperationInput(input)
      return service.compactCache(parsed.cacheId, { dryRun: parsed.dryRun })
    },
    listOperations: async (query?: unknown) => service.listOperations(parseOperationQuery(query))
  }
}

export type CacheGovernanceIpcHandlers = ReturnType<typeof createCacheGovernanceIpcHandlers>

function parseOperationInput(
  value: unknown
): {
  cacheId: string
  dryRun?: boolean
} {
  const input = assertObject(value, 'cache operation request')
  return {
    cacheId: assertCacheId(input.cacheId),
    dryRun: optionalBoolean(input.dryRun, 'dryRun')
  }
}

function parseOperationQuery(value: unknown): CacheOperationQuery {
  if (value === undefined || value === null) return {}
  const input = assertObject(value, 'cache operations query')
  return {
    cacheId: input.cacheId === undefined ? undefined : assertCacheId(input.cacheId),
    ownerType:
      input.ownerType === undefined
        ? undefined
        : input.ownerType === 'platform' || input.ownerType === 'product'
          ? input.ownerType
          : fail('ownerType'),
    ownerId: input.ownerId === undefined ? undefined : assertShortString(input.ownerId, 'ownerId', 1, 80),
    limit: input.limit === undefined ? undefined : assertInteger(input.limit, 'limit', 1, 200),
    cursor:
      input.cursor === undefined || input.cursor === null
        ? input.cursor ?? undefined
        : assertShortString(input.cursor, 'cursor', 1, 400)
  }
}

function assertCacheId(value: unknown): string {
  return assertShortString(value, 'cacheId', 1, 160)
}

function assertShortString(value: unknown, label: string, min: number, max: number): string {
  if (typeof value !== 'string') fail(label)
  const next = value.trim()
  if (next.length < min || next.length > max) fail(label)
  return next
}

function assertInteger(value: unknown, label: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(label)
  const normalized = Math.floor(value)
  if (normalized < min || normalized > max) fail(label)
  return normalized
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') fail(label)
  return value
}

function assertObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid Storage and Cache ${label}.`)
  }
  return value as Record<string, unknown>
}

function fail(label: string): never {
  throw new Error(`Invalid Storage and Cache ${label}.`)
}
