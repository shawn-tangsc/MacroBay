import { describe, expect, it } from 'vitest'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import type { CapabilityId } from './capabilityCatalog'
import { intelligenceAgentCapabilities } from './capabilityCatalog'
import { intelligenceCapabilityCoverage, type ExclusionReason } from './capabilityCoverage'

const EXCLUSION_REASONS: readonly ExclusionReason[] = [
  'destructive',
  'returns-plaintext-credential',
  'raw-payload',
  'cross-product-write',
  'internal-view',
  'user-private-data'
]

describe('intelligence capability coverage', () => {
  const routeMethods = marketIntelligenceProductManifest.serviceRoutes.map((route) => route.method)

  it('classifies every IPC service route and nothing else', () => {
    expect(new Set(Object.keys(intelligenceCapabilityCoverage))).toEqual(new Set(routeMethods))
    for (const method of routeMethods) {
      expect(intelligenceCapabilityCoverage[method], `unclassified IPC method: ${method}`).toBeDefined()
    }
  })

  it('exposes only capabilities that exist in the catalog', () => {
    const capabilityIds = new Set<string>(intelligenceAgentCapabilities.map((capability) => capability.id))
    for (const [method, decision] of Object.entries(intelligenceCapabilityCoverage)) {
      if (decision.state !== 'exposed') continue
      expect(capabilityIds.has(decision.capabilityId), `${method} points at unknown capability`).toBe(true)
    }
  })

  it('gives every excluded route one of the declared reasons', () => {
    for (const [method, decision] of Object.entries(intelligenceCapabilityCoverage)) {
      if (decision.state !== 'excluded') continue
      expect(EXCLUSION_REASONS).toContain(decision.reason)
      expect(decision.reason.trim().length).toBeGreaterThan(0)
    }
  })

  it('exposes the read surface and keeps destructive routes closed', () => {
    const decisionFor = (method: string) => intelligenceCapabilityCoverage[method]
    const exposedCapability = (method: string): CapabilityId | undefined =>
      decisionFor(method)?.state === 'exposed' ? decisionFor(method).capabilityId : undefined

    expect(exposedCapability('intelligence.querySentimentSnapshot')).toBe('query_sentiment_snapshot')
    expect(exposedCapability('intelligence.getOperationsHealth')).toBe('get_operations_health')
    expect(exposedCapability('intelligence.macro.economicCalendar.queryMonth')).toBe('query_macro_calendar')
    expect(exposedCapability('intelligence.crossAsset.query')).toBe('get_cross_asset_snapshot')
    expect(exposedCapability('intelligenceSources.listProfiles')).toBe('list_intelligence_sources')
    expect(exposedCapability('intelligenceSources.getHealth')).toBe('get_source_detail')
    expect(exposedCapability('intelligenceTranslation.getStatus')).toBe('get_translation_status')
    expect(decisionFor('intelligenceSources.revealCredential')).toEqual({
      state: 'excluded',
      reason: 'returns-plaintext-credential'
    })
    expect(decisionFor('intelligenceSources.saveProfile')).toEqual({ state: 'excluded', reason: 'destructive' })
  })
})
