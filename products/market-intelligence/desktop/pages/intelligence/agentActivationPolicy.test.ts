import { describe, expect, it } from 'vitest'

import type { AgentView, SourceView } from '../../../service/intelligence/application/sourceProjection'
import { projectActivation } from './agentActivationPolicy'

function source(sourceId: string, overrides: Partial<SourceView> = {}): SourceView {
  return {
    sourceId,
    providerId: sourceId,
    displayName: sourceId,
    enabled: false,
    visibility: 'visible',
    readiness: 'live',
    ...overrides
  } as SourceView
}

function view(groups: Array<{ groupId: string; tier: 'required' | 'recommended' | 'optional'; sources: SourceView[] }>): AgentView {
  return { groups } as unknown as AgentView
}

function group(groupId: string, sources: SourceView[], tier: 'required' | 'recommended' | 'optional' = 'required') {
  return { groupId, tier, sources }
}

describe('projectActivation', () => {
  it('reports zero providers before the agent view is loaded', () => {
    expect(projectActivation(undefined)).toEqual({ enabledSourceCount: 0, totalSourceCount: 0 })
  })

  it('increments as soon as one provider is enabled, regardless of health', () => {
    const projection = projectActivation(view([
      group('spot-momentum', [source('coingecko-market', { enabled: true, health: 'failed' })]),
      group('fear-greed', [source('alternative-fear-greed')]),
      group('funding-rate', [source('binance-futures-positioning')])
    ]))
    expect(projection).toEqual({ enabledSourceCount: 1, totalSourceCount: 3 })
  })

  it('counts a provider once even when it owns several sources', () => {
    const projection = projectActivation(view([
      group('spot-momentum', [
        source('0xrouter-aggregate-provider', { providerId: '0xrouter', enabled: true, health: 'failed' }),
        source('0xrouter-economic-data', { providerId: '0xrouter', enabled: true }),
        source('0xrouter-financial-events', { providerId: '0xrouter' })
      ]),
      group('fear-greed', [source('alternative-fear-greed', { enabled: true })])
    ]))
    expect(projection).toEqual({ enabledSourceCount: 2, totalSourceCount: 2 })
  })

  it('excludes pending/hidden providers and de-duplicates across groups', () => {
    const projection = projectActivation(view([
      group('spot-momentum', [
        source('binance-spot-market', { enabled: true }),
        source('binance-asset-page', { visibility: 'pending' }),
        source('twelve-data-market', { visibility: 'hidden' })
      ]),
      group('fear-greed', [source('binance-spot-market', { enabled: true })])
    ]))
    expect(projection).toEqual({ enabledSourceCount: 1, totalSourceCount: 1 })
  })
})
