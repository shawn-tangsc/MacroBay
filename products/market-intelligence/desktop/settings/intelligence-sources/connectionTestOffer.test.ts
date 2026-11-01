import { describe, expect, it } from 'vitest'

import { getProvider } from '../../../service/intelligence/application/providerRegistry'
import { offersConnectionTest } from './ProviderDetail'

describe('connection test offer', () => {
  it('offers the probe for the venue that declares one', () => {
    const provider = getProvider('policy-path')
    expect(provider).toBeDefined()
    // The button was missing because the source declared no probe; it declares one now.
    expect(provider!.sources[0]?.capabilities.testConnection).toBe(true)
    expect(offersConnectionTest(provider!)).toBe(true)
  })

  it('never offers it for an API-key provider, whose credentials are tested inside the key form', () => {
    expect(offersConnectionTest({ credential: 'api-key', sources: [{ capabilities: { testConnection: true } }] })).toBe(false)
  })

  it('stays hidden when no source declares a probe', () => {
    expect(offersConnectionTest({ credential: 'none', sources: [{ capabilities: { testConnection: false } }, {}] })).toBe(false)
  })
})
