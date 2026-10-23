import {
  createBlsApiCompatibilityProbe,
  type BlsApiCompatibilityFetch,
  type BlsApiCompatibilityProbe
} from './blsApiCompatibilityProbe'
import { getFixedLocalDevelopmentBlsApiRequestIdentityCapability } from './blsApiRequestIdentity'

export type BlsApiCompatibilityHost = Readonly<{
  initialize: (dependencies: unknown) => void
  availability: () => 'available' | 'unavailable'
  getProbe: () => BlsApiCompatibilityProbe | undefined
}>

const blsApiCompatibilityHostDependencyPolicy = Object.freeze({
  field: 'platformFetch'
} as const)

export function createBlsApiCompatibilityHost(): BlsApiCompatibilityHost {
  let probe: BlsApiCompatibilityProbe | undefined

  return Object.freeze({
    initialize: (dependencies: unknown): void => {
      if (probe) return
      const platformFetch = readPlatformFetch(dependencies)
      if (!platformFetch) return
      probe = createBlsApiCompatibilityProbe({
        fetch: platformFetch,
        identity: getFixedLocalDevelopmentBlsApiRequestIdentityCapability()
      })
    },
    availability: (): 'available' | 'unavailable' => probe ? 'available' : 'unavailable',
    getProbe: (): BlsApiCompatibilityProbe | undefined => probe
  })
}

function readPlatformFetch(value: unknown): BlsApiCompatibilityFetch | undefined {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype || !Object.isFrozen(value)) return undefined
    if (Object.getOwnPropertySymbols(value).length !== 0) return undefined
    const descriptor = Object.getOwnPropertyDescriptor(value, blsApiCompatibilityHostDependencyPolicy.field)
    return descriptor?.enumerable === true && 'value' in descriptor && typeof descriptor.value === 'function'
      ? descriptor.value as BlsApiCompatibilityFetch
      : undefined
  } catch {
    return undefined
  }
}
