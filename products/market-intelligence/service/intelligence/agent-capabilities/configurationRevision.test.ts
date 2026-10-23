import { describe, expect, it } from 'vitest'

import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import { computeConfigurationRevision } from './configurationRevision'

function profile(overrides: Partial<IntelligenceSourceProfile> = {}): IntelligenceSourceProfile {
  return {
    profileId: 'profile-a',
    sourceId: 'source-a',
    enabled: true,
    collectionPreset: 'balanced',
    includeInSentiment: true,
    scopePolicy: 'all',
    rawArchiveEnabled: false,
    retentionMode: 'balanced',
    autoReplayAfterParserUpgrade: false,
    monitoredSymbols: ['BTCUSDT'],
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides
  }
}

const focusMarkets = ['CN', 'US']

describe('computeConfigurationRevision', () => {
  it('returns the first 12 lowercase hex characters of a sha256 digest', () => {
    const revision = computeConfigurationRevision({ profiles: [profile()], focusMarkets })
    expect(revision).toMatch(/^[0-9a-f]{12}$/)
  })

  it('pins the exact revision for a fixed configuration', () => {
    // Pinned so a change to the field order or the row/digest delimiters fails here.
    expect(computeConfigurationRevision({ profiles: [profile()], focusMarkets: ['CN', 'US'] })).toBe(
      'e901674e28e7'
    )
  })

  it('is stable when neither profiles nor focus markets change', () => {
    const first = computeConfigurationRevision({ profiles: [profile()], focusMarkets })
    const second = computeConfigurationRevision({ profiles: [profile()], focusMarkets: ['CN', 'US'] })
    expect(second).toBe(first)
  })

  it('ignores profile order', () => {
    const first = computeConfigurationRevision({
      profiles: [profile(), profile({ profileId: 'profile-b', sourceId: 'source-b' })],
      focusMarkets
    })
    const second = computeConfigurationRevision({
      profiles: [profile({ profileId: 'profile-b', sourceId: 'source-b' }), profile()],
      focusMarkets
    })
    expect(second).toBe(first)
  })

  it('changes when a profile field changes', () => {
    const before = computeConfigurationRevision({ profiles: [profile()], focusMarkets })
    const after = computeConfigurationRevision({ profiles: [profile({ enabled: false })], focusMarkets })
    expect(after).not.toBe(before)
  })

  it('changes when focus markets change', () => {
    const before = computeConfigurationRevision({ profiles: [profile()], focusMarkets })
    const after = computeConfigurationRevision({ profiles: [profile()], focusMarkets: ['CN', 'US', 'JP'] })
    expect(after).not.toBe(before)
  })

  it('ignores focus market order', () => {
    const first = computeConfigurationRevision({ profiles: [profile()], focusMarkets: ['CN', 'US'] })
    const second = computeConfigurationRevision({ profiles: [profile()], focusMarkets: ['US', 'CN'] })
    expect(second).toBe(first)
  })
})
