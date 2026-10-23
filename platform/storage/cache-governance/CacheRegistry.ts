import {
  normalizeCacheRegistration,
  toSafeCacheView,
  type CacheOperationAuditRecord,
  type CacheRegistration,
  type CacheRegistrationWithProvider,
  type SafeCacheView
} from './cacheContracts'

type CacheRegistryOptions = {
  allowReplaceForTests?: boolean
  allowClearableUserDataLike?: boolean
}
const CACHE_ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/

export class CacheRegistry {
  private readonly entries = new Map<string, CacheRegistrationWithProvider>()
  private readonly options: CacheRegistryOptions

  constructor(options: CacheRegistryOptions = {}) {
    this.options = options
  }

  register(input: CacheRegistrationWithProvider): void {
    const normalized = normalizeCacheRegistration(input, {
      allowClearableUserDataLike: this.options.allowClearableUserDataLike
    })
    validateRegistration(normalized)
    const existing = this.entries.get(normalized.cacheId)
    if (existing && !this.options.allowReplaceForTests) {
      throw new Error(`Cache "${normalized.cacheId}" is already registered.`)
    }
    this.entries.set(normalized.cacheId, normalized)
  }

  list(): CacheRegistration[] {
    return [...this.entries.values()].map(stripProvider)
  }

  get(cacheId: string): CacheRegistration | null {
    const entry = this.entries.get(cacheId)
    return entry ? stripProvider(entry) : null
  }

  getWithProvider(cacheId: string): CacheRegistrationWithProvider | null {
    const entry = this.entries.get(cacheId)
    return entry ? { ...entry } : null
  }

  toSafeViews(input?: {
    inspections?: ReadonlyMap<string, SafeCacheView['latestInspection']>
    latestOperations?: ReadonlyMap<string, CacheOperationAuditRecord>
  }): SafeCacheView[] {
    return this.list()
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((registration) =>
        toSafeCacheView(registration, {
          latestInspection: input?.inspections?.get(registration.cacheId),
          latestOperation: input?.latestOperations?.get(registration.cacheId)
        })
      )
  }
}

function validateRegistration(input: CacheRegistrationWithProvider): void {
  if (!CACHE_ID_PATTERN.test(input.cacheId)) {
    throw new Error(`Cache "${input.cacheId}" must use a lowercase dotted or kebab identifier.`)
  }
  if (input.ownerType === 'platform' && input.ownerId !== 'platform') {
    throw new Error(`Platform cache "${input.cacheId}" must use ownerId "platform".`)
  }
  if (input.ownerType === 'product' && !input.ownerId) {
    throw new Error(`Product cache "${input.cacheId}" must include a product ownerId.`)
  }
  if (input.ownerType === 'platform' && input.cacheId.startsWith('platform.') === false) {
    throw new Error(`Platform cache "${input.cacheId}" must be prefixed with "platform.".`)
  }
  if (input.ownerType === 'product' && input.cacheId.startsWith(`${input.ownerId}.`) === false) {
    throw new Error(`Product cache "${input.cacheId}" must be prefixed with "${input.ownerId}.".`)
  }
  if (input.clearable && !input.provider?.clear) {
    throw new Error(`Cache "${input.cacheId}" is clearable but does not provide a clear handler.`)
  }
  if (input.compactable && !input.provider?.compact) {
    throw new Error(`Cache "${input.cacheId}" is compactable but does not provide a compact handler.`)
  }
}

function stripProvider(input: CacheRegistrationWithProvider): CacheRegistration {
  const { provider: _provider, ...safe } = input
  return safe
}
