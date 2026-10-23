import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import * as identityModule from './blsApiRequestIdentity'
import {
  applyBlsApiRequestIdentity,
  getFixedLocalDevelopmentBlsApiRequestIdentityCapability,
  isValidMarketIntelligenceRequestIdentityConfiguration,
  localDevelopmentBlsApiRequestIdentityPolicy,
  marketIntelligenceRequestIdentityConfiguration,
  type MarketIntelligenceRequestIdentityConfiguration
} from './blsApiRequestIdentity'

const localPlaceholderIdentity = (): MarketIntelligenceRequestIdentityConfiguration => Object.freeze({
  userAgent: 'BLS-CPS-Pipeline/1.0 (market-intelligence@example.com)',
  releaseToken: '1.0',
  supportMailbox: 'market-intelligence@example.com',
  ownedSupportDomain: 'example.com',
  supportContactOwnership: 'unverified-local-placeholder'
})

describe('BLS API request identity', () => {
  it('uses only the fixed unverified local-development placeholder', () => {
    expect(localDevelopmentBlsApiRequestIdentityPolicy.userAgent).toBe('BLS-CPS-Pipeline/1.0 (market-intelligence@example.com)')
    expect(marketIntelligenceRequestIdentityConfiguration).toEqual(localPlaceholderIdentity())
    expect(isValidMarketIntelligenceRequestIdentityConfiguration(localPlaceholderIdentity())).toBe(true)
  })

  it.each([
    ['non-immutable', { ...localPlaceholderIdentity() }],
    ['old product identity', Object.freeze({ ...localPlaceholderIdentity(), releaseToken: '0.1.0', userAgent: 'MarketIntelligence/0.1.0 (market-intelligence@example.com)' })],
    ['different version', Object.freeze({ ...localPlaceholderIdentity(), releaseToken: '1.0.1', userAgent: 'BLS-CPS-Pipeline/1.0.1 (market-intelligence@example.com)' })],
    ['different token spelling', Object.freeze({ ...localPlaceholderIdentity(), userAgent: 'bls-cps-pipeline/1.0 (market-intelligence@example.com)' })],
    ['claimed support ownership', Object.freeze({ ...localPlaceholderIdentity(), supportContactOwnership: 'verified' })],
    ['non-ASCII header', Object.freeze({ ...localPlaceholderIdentity(), userAgent: 'BLS-CPS-Pipeline/1.0 (market-intelligence@example.com)\u00A0' })]
  ])('rejects %s and cannot attach it to headers', (_label, configuration) => {
    const headers = new Headers()

    expect(isValidMarketIntelligenceRequestIdentityConfiguration(configuration)).toBe(false)
    expect(applyBlsApiRequestIdentity(configuration as never, headers)).toBe(false)
    expect(headers.get('User-Agent')).toBeNull()
  })

  it('rejects accessor and hostile Proxy configurations without throwing', () => {
    const { userAgent: _userAgent, ...rest } = localPlaceholderIdentity()
    const accessor = Object.freeze({
      ...rest,
      get userAgent(): string { throw new Error('private getter') }
    })
    const hostile = new Proxy(Object.freeze({}), { getOwnPropertyDescriptor: () => { throw new Error('private proxy') } })

    expect(isValidMarketIntelligenceRequestIdentityConfiguration(accessor as never)).toBe(false)
    expect(isValidMarketIntelligenceRequestIdentityConfiguration(hostile as never)).toBe(false)
  })

  it('attaches the exact placeholder only through the fixed opaque capability', () => {
    const headers = new Headers()

    expect(applyBlsApiRequestIdentity(getFixedLocalDevelopmentBlsApiRequestIdentityCapability(), headers)).toBe(true)
    expect(headers.get('User-Agent')).toBe('BLS-CPS-Pipeline/1.0 (market-intelligence@example.com)')
    expect(applyBlsApiRequestIdentity(Object.freeze({}) as never, new Headers())).toBe(false)
  })

  it('has no arbitrary configuration or mutable runtime override seam', () => {
    const source = readFileSync(new URL('./blsApiRequestIdentity.ts', import.meta.url), 'utf8')

    expect(identityModule).not.toHaveProperty('createBlsApiRequestIdentityCapability')
    expect(source).not.toMatch(/process\.env|globalThis|localStorage|vault|profile|settings|renderer|ipc/i)
    expect(source).not.toMatch(/icloud\.com/i)
  })
})
