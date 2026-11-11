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

  it('offers it for an API-key provider too: the probe now lives next to the source name, not in the key form', () => {
    // 2026-11-10：凭据块里那颗删掉了（全屏只留一颗，跟着源名走），所以 API-Key 源同样用它。
    expect(offersConnectionTest({ credential: 'api-key', sources: [{ capabilities: { testConnection: true } }] })).toBe(true)
  })

  it('stays hidden when no source declares a probe', () => {
    expect(offersConnectionTest({ credential: 'none', sources: [{ capabilities: { testConnection: false } }, {}] })).toBe(false)
  })
})
