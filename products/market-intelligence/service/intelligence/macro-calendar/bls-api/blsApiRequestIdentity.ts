const identityCapabilityHeader = new WeakMap<object, string>()

export const localDevelopmentBlsApiRequestIdentityPolicy = Object.freeze({
  userAgent: 'BLS-CPS-Pipeline/1.0 (market-intelligence@example.com)',
  releaseToken: '1.0',
  supportMailbox: 'market-intelligence@example.com',
  ownedSupportDomain: 'example.com',
  supportContactOwnership: 'unverified-local-placeholder'
} as const)

export type MarketIntelligenceRequestIdentityConfiguration = Readonly<{
  userAgent: string
  releaseToken: string
  supportMailbox: string
  ownedSupportDomain: string
  supportContactOwnership: 'unverified-local-placeholder'
}>

export type BlsApiRequestIdentityCapability = Readonly<Record<never, never>>

export const marketIntelligenceRequestIdentityConfiguration: MarketIntelligenceRequestIdentityConfiguration = Object.freeze({
  ...localDevelopmentBlsApiRequestIdentityPolicy
})

const fixedLocalDevelopmentBlsApiRequestIdentityCapability: BlsApiRequestIdentityCapability = Object.freeze({})
identityCapabilityHeader.set(fixedLocalDevelopmentBlsApiRequestIdentityCapability, localDevelopmentBlsApiRequestIdentityPolicy.userAgent)

export function getFixedLocalDevelopmentBlsApiRequestIdentityCapability(): BlsApiRequestIdentityCapability {
  return fixedLocalDevelopmentBlsApiRequestIdentityCapability
}

export function applyBlsApiRequestIdentity(
  capability: BlsApiRequestIdentityCapability | undefined,
  headers: Headers
): boolean {
  const header = capability && identityCapabilityHeader.get(capability)
  if (!header || !(headers instanceof Headers)) return false
  headers.set('User-Agent', header)
  return true
}

export function isValidMarketIntelligenceRequestIdentityConfiguration(value: unknown): value is MarketIntelligenceRequestIdentityConfiguration {
  if (!isFrozenPlainRecord(value) || !hasExactKeys(value, [
    'userAgent', 'releaseToken', 'supportMailbox', 'ownedSupportDomain', 'supportContactOwnership'
  ])) return false
  const userAgent = readOwnData(value, 'userAgent')
  const releaseToken = readOwnData(value, 'releaseToken')
  const supportMailbox = readOwnData(value, 'supportMailbox')
  const ownedSupportDomain = readOwnData(value, 'ownedSupportDomain')
  const supportContactOwnership = readOwnData(value, 'supportContactOwnership')
  return userAgent === localDevelopmentBlsApiRequestIdentityPolicy.userAgent &&
    releaseToken === localDevelopmentBlsApiRequestIdentityPolicy.releaseToken &&
    supportMailbox === localDevelopmentBlsApiRequestIdentityPolicy.supportMailbox &&
    ownedSupportDomain === localDevelopmentBlsApiRequestIdentityPolicy.ownedSupportDomain &&
    supportContactOwnership === localDevelopmentBlsApiRequestIdentityPolicy.supportContactOwnership
}

function isFrozenPlainRecord(value: unknown): value is Record<string, unknown> {
  try {
    return typeof value === 'object' && value !== null && !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype && Object.isFrozen(value) && Object.getOwnPropertySymbols(value).length === 0
  } catch {
    return false
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  try {
    const keys = Object.keys(value)
    return keys.length === expected.length && expected.every((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor?.enumerable === true && 'value' in descriptor
    })
  } catch {
    return false
  }
}

function readOwnData(value: Record<string, unknown>, name: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name)
    return descriptor && 'value' in descriptor ? descriptor.value : undefined
  } catch {
    return undefined
  }
}
