import { describe, expect, it } from 'vitest'

import { isSuccessfulCredentialOperation } from './useIntelligenceSourcesSettings'

describe('isSuccessfulCredentialOperation', () => {
  it('accepts only an exact source-bound 0xRouter unverified save result', () => {
    expect(isSuccessfulCredentialOperation(
      { sourceId: '0xrouter-aggregate-provider', state: 'unverified' },
      '0xrouter-aggregate-provider'
    )).toBe(true)
    expect(isSuccessfulCredentialOperation(
      { sourceId: 'wrong-source', state: 'unverified' },
      '0xrouter-aggregate-provider'
    )).toBe(false)
    expect(isSuccessfulCredentialOperation(
      { sourceId: '0xrouter-aggregate-provider', state: 'unverified', extension: true },
      '0xrouter-aggregate-provider'
    )).toBe(false)
  })

  it('preserves the existing generic credential verification result', () => {
    expect(isSuccessfulCredentialOperation({ sourceId: 'fred', ok: true, message: 'safe', testedAt: '2026-08-30T00:00:00.000Z' }, 'fred')).toBe(true)
    expect(isSuccessfulCredentialOperation({ sourceId: 'fred', ok: false, message: 'safe', testedAt: '2026-08-30T00:00:00.000Z' }, 'fred')).toBe(false)
  })

  it('reads the same source-bound state result for every credentialed provider', () => {
    expect(isSuccessfulCredentialOperation({ sourceId: 'twelve-data-market', state: 'unverified' }, 'twelve-data-market')).toBe(true)
    expect(isSuccessfulCredentialOperation({ sourceId: 'twelve-data-market', state: 'failed', failureCode: 'credential-invalid' }, 'twelve-data-market')).toBe(false)
    expect(isSuccessfulCredentialOperation({ sourceId: 'twelve-data-market', state: 'failed', failureCode: 'rate-limited' }, 'twelve-data-market')).toBe(false)
    expect(isSuccessfulCredentialOperation({ sourceId: 'twelve-data-market', state: 'unverified', extension: true }, 'twelve-data-market')).toBe(false)
  })
})
