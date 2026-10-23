import type { CacheRegistrationWithProvider } from './cacheContracts'
import { CacheRegistry } from './CacheRegistry'

export type ProductCacheRegistration = Omit<CacheRegistrationWithProvider, 'ownerType' | 'ownerId'> & {
  ownerId?: never
  ownerType?: never
}

export type ProductCacheRegistrar = (productId: string, registration: ProductCacheRegistration) => void

export function createProductCacheRegistrar(registry: CacheRegistry): ProductCacheRegistrar {
  return (productId, registration) => {
    const normalizedProductId = productId.trim()
    if (!normalizedProductId) {
      throw new Error('Product cache registration requires a productId.')
    }

    registry.register({
      ...registration,
      ownerType: 'product',
      ownerId: normalizedProductId
    })
  }
}
