import { describe, expect, it } from 'vitest'

import {
  findZeroXRouterProviderIndicatorLink,
  zeroXRouterProviderIndicatorLinks
} from './zeroXRouterProviderIndicatorLinkRegistry'

const candidateInputs = [
  { indicatorId: '8656', countryCode: 'US', period: 'monthly', unit: 'thousands' },
  { indicatorId: '4010', countryCode: 'US', period: 'monthly', unit: 'percent' },
  { indicatorId: '9272', countryCode: 'US', period: 'monthly', unit: 'percent' },
  { indicatorId: 'unknown', countryCode: 'US', period: 'monthly', unit: 'percent' }
] as const

describe('0xRouter provider indicator link registry', () => {
  it('contains no admitted mapping while every MC0 candidate remains planned', () => {
    expect(zeroXRouterProviderIndicatorLinks).toEqual([])
    candidateInputs.forEach((input) => {
      expect(findZeroXRouterProviderIndicatorLink({
        descriptorId: 'macro-calendar-0xrouter-economic-data',
        ...input
      })).toBeUndefined()
    })
  })

  it('fails closed for country, period, unit, and duplicate source-identity variants', () => {
    const sourceIdentity = { descriptorId: 'macro-calendar-0xrouter-economic-data', indicatorId: '8656' } as const
    expect(findZeroXRouterProviderIndicatorLink({ ...sourceIdentity, countryCode: 'CA', period: 'monthly', unit: 'thousands' })).toBeUndefined()
    expect(findZeroXRouterProviderIndicatorLink({ ...sourceIdentity, countryCode: 'US', period: 'quarterly', unit: 'thousands' })).toBeUndefined()
    expect(findZeroXRouterProviderIndicatorLink({ ...sourceIdentity, countryCode: 'US', period: 'monthly', unit: 'percent' })).toBeUndefined()
    expect(findZeroXRouterProviderIndicatorLink({ ...sourceIdentity, countryCode: 'US', period: 'monthly', unit: 'thousands' })).toBeUndefined()
  })
})
