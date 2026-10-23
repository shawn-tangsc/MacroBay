import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { marketIntelligenceAgents, marketIntelligenceActivationSources } from './agentPortalModel'

describe('market intelligence agent portal model', () => {
  it('keeps crypto as the sole activatable agent with fixed analyst portraits', () => {
    expect(marketIntelligenceAgents).toEqual([
      expect.objectContaining({ id: 'crypto', activation: 'available', portraitAsset: 'mi-crypto-analyst.jpg' }),
      expect.objectContaining({ id: 'stocks', activation: 'coming-soon', portraitAsset: 'mi-equities-analyst.jpg' }),
      expect.objectContaining({ id: 'futures', activation: 'coming-soon', portraitAsset: 'mi-futures-analyst.jpg' })
    ])

    for (const agent of marketIntelligenceAgents) {
      expect(existsSync(resolve(process.cwd(), 'products/market-intelligence/desktop/pages/intelligence/assets', agent.portraitAsset))).toBe(true)
    }
  })

  it('lists every fixed crypto activation source without a live profile', () => {
    expect(marketIntelligenceActivationSources.map(({ tier }) => tier)).toEqual([
      'required',
      'required',
      'required',
      'recommended',
      'recommended',
      'recommended',
      'optional',
    ])

    expect(marketIntelligenceActivationSources.map(({ id }) => id)).toEqual([
      'fear-greed',
      'spot-momentum',
      'funding-rate',
      'macro-calendar',
      'stablecoin-defi',
      'regulation-exchange',
      'industry-news'
    ])
  })
})
