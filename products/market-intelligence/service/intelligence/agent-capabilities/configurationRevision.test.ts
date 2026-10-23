import { describe, expect, it } from 'vitest'

import type { IntelligenceSourceProfile } from '../schema/intelligenceSource'
import {
  computeCalendarRevision,
  computeConfigurationRevision,
  computeCrossAssetRevision,
  computeTranslationRevision
} from './configurationRevision'

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

describe('computeCalendarRevision', () => {
  const configuration = {
    providers: { 'macro-calendar-fed': true, 'macro-calendar-bea': false },
    releaseTimes: {
      'US.CPI.RELEASE.2026-M09': {
        scheduledAt: '2026-09-10T12:30:00.000Z',
        scheduledDate: '2026-09-10'
      }
    }
  }

  it('returns the first 12 lowercase hex characters of a sha256 digest', () => {
    expect(computeCalendarRevision(configuration)).toMatch(/^[0-9a-f]{12}$/)
  })

  it('is stable for the same configuration regardless of entry order', () => {
    const first = computeCalendarRevision(configuration)
    const second = computeCalendarRevision({
      providers: { 'macro-calendar-bea': false, 'macro-calendar-fed': true },
      releaseTimes: {
        'US.CPI.RELEASE.2026-M09': {
          scheduledAt: '2026-09-10T12:30:00.000Z',
          scheduledDate: '2026-09-10'
        }
      }
    })
    expect(second).toBe(first)
  })

  it('changes when a provider enable flag or a release time changes', () => {
    const baseline = computeCalendarRevision(configuration)
    expect(
      computeCalendarRevision({ ...configuration, providers: { ...configuration.providers, 'macro-calendar-fed': false } })
    ).not.toBe(baseline)
    expect(
      computeCalendarRevision({
        ...configuration,
        releaseTimes: {
          'US.CPI.RELEASE.2026-M09': {
            scheduledAt: '2026-09-10T13:30:00.000Z',
            scheduledDate: '2026-09-10'
          }
        }
      })
    ).not.toBe(baseline)
    expect(
      computeCalendarRevision({ providers: configuration.providers, releaseTimes: {} })
    ).not.toBe(baseline)
  })
})

describe('computeTranslationRevision', () => {
  const settings = {
    autoTranslateEnabled: true,
    targetLocale: 'zh-CN',
    providerId: 'provider-a',
    modelId: 'model-a',
    translateTitle: true,
    translateSummary: false,
    translateEvidenceExcerpt: false
  }

  it('returns 12 hex characters and is deterministic', () => {
    expect(computeTranslationRevision(settings)).toMatch(/^[0-9a-f]{12}$/)
    expect(computeTranslationRevision({ ...settings })).toBe(computeTranslationRevision(settings))
  })

  it('changes when any translation setting changes', () => {
    const baseline = computeTranslationRevision(settings)
    expect(computeTranslationRevision({ ...settings, autoTranslateEnabled: false })).not.toBe(baseline)
    expect(computeTranslationRevision({ ...settings, targetLocale: 'en-US' })).not.toBe(baseline)
    expect(computeTranslationRevision({ ...settings, providerId: 'provider-b' })).not.toBe(baseline)
    expect(computeTranslationRevision({ ...settings, modelId: 'model-b' })).not.toBe(baseline)
    expect(computeTranslationRevision({ ...settings, translateTitle: false })).not.toBe(baseline)
    expect(computeTranslationRevision({ ...settings, translateSummary: true })).not.toBe(baseline)
    expect(computeTranslationRevision({ ...settings, translateEvidenceExcerpt: true })).not.toBe(baseline)
  })

  it('ignores the settings timestamp, which is metadata rather than configuration', () => {
    expect(
      computeTranslationRevision({
        ...settings,
        // Extra metadata the caller may carry must not move the revision.
        updatedAt: '2026-10-02T00:00:00.000Z'
      } as typeof settings)
    ).toBe(computeTranslationRevision(settings))
  })
})

describe('computeCrossAssetRevision', () => {
  it('returns 12 hex characters and is deterministic', () => {
    const configuration = { state: 'configured' as const, enabled: true }
    expect(computeCrossAssetRevision(configuration)).toMatch(/^[0-9a-f]{12}$/)
    expect(computeCrossAssetRevision({ ...configuration })).toBe(computeCrossAssetRevision(configuration))
  })

  it('changes when the interface configuration changes', () => {
    const baseline = computeCrossAssetRevision({ state: 'configured', enabled: true })
    expect(computeCrossAssetRevision({ state: 'configured', enabled: false })).not.toBe(baseline)
    expect(computeCrossAssetRevision({ state: 'default', enabled: true })).not.toBe(baseline)
    expect(computeCrossAssetRevision({ state: 'unknown' })).not.toBe(baseline)
  })
})
