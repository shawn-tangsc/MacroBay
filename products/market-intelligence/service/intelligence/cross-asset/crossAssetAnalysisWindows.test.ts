import { describe, expect, it } from 'vitest'

import { predictionVerificationPolicy } from '../analysis/predictionVerificationService'
import { crossAssetAnalysisRanges, crossAssetAnalysisWindowPolicy } from './crossAssetAnalysisWindows'

describe('cross-asset analysis windows', () => {
  it('reads exactly the price horizons the verifier can check', () => {
    // The two used to be written independently: the verifier read 3/24/72 points back on the
    // 1h/24h/7d curves, and the analysis context read none of them. One policy now feeds both,
    // and this asserts the horizons still line up.
    expect([...crossAssetAnalysisWindowPolicy.priceReturns].map(window => window.horizon).sort())
      .toEqual([...predictionVerificationPolicy.supportedPriceHorizons].sort())
  })

  it('names the window each horizon is read from, so 15m/2h/3d cannot silently mean something else', () => {
    expect(crossAssetAnalysisWindowPolicy.priceReturns).toEqual([
      { horizon: '15m', kind: 'curve', range: '1h', lookbackPoints: 3 },
      { horizon: '2h', kind: 'curve', range: '24h', lookbackPoints: 24 },
      { horizon: '24h', kind: 'closed-return', range: '24h' },
      { horizon: '3d', kind: 'curve', range: '7d', lookbackPoints: 72 }
    ])
    // Every range the facts need, deduplicated, so the context fetches each one exactly once.
    expect([...crossAssetAnalysisRanges].sort()).toEqual(['1h', '24h', '7d'])
    // The relative return is the verifier's own comparison: BTC against ETH over the 2h window.
    expect(crossAssetAnalysisWindowPolicy.relativeReturn).toMatchObject({
      asset: 'BTC', relativeToAsset: 'ETH', horizon: '2h', range: '24h', lookbackPoints: 24
    })
  })
})
