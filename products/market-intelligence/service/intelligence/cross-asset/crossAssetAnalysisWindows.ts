import type { CrossAssetRange } from '../../../contracts/crossAssetObservationContracts'

/**
 * The price horizons the analysis reports and the verifier checks.
 *
 * Deliberately not `AnalysisScenarioHorizon` (that is the scenario vocabulary: '0-15m', '15m-2h'…).
 * The two look alike and are not the same; `crossAssetAnalysisWindows.test.ts` asserts this list
 * matches `predictionVerificationPolicy.supportedPriceHorizons`.
 */
export type CrossAssetPriceHorizon = '15m' | '2h' | '24h' | '3d'

/**
 * How a cross-asset snapshot is read for one price horizon.
 *
 * The prediction verifier and the analysis context must agree on what "15m", "2h" and "3d" mean, or
 * the two drift apart silently: the verifier already read the 1h curve three points back for 15m,
 * the 24h curve 24 points back for 2h and the 7d curve 72 points back for 3d, while nothing in the
 * context path read them at all. Owning the numbers here means a change lands in both readers at
 * once, and the verifier's own horizon list is asserted against this policy by test.
 */
export type CrossAssetPriceWindow = Readonly<{
  horizon: CrossAssetPriceHorizon
} & (
  | Readonly<{ kind: 'curve'; range: CrossAssetRange; lookbackPoints: number }>
  | Readonly<{ kind: 'closed-return'; range: CrossAssetRange }>
)>

export const crossAssetAnalysisWindowPolicy = Object.freeze({
  version: 'crossAssetAnalysisWindows.v1',
  /** The 24h close is published as a closed return rather than derived from a curve. */
  closedReturnMetric: '24h' as const,
  priceReturns: Object.freeze([
    Object.freeze({ horizon: '15m' as CrossAssetPriceHorizon, kind: 'curve' as const, range: '1h' as CrossAssetRange, lookbackPoints: 3 }),
    Object.freeze({ horizon: '2h' as CrossAssetPriceHorizon, kind: 'curve' as const, range: '24h' as CrossAssetRange, lookbackPoints: 24 }),
    Object.freeze({ horizon: '24h' as CrossAssetPriceHorizon, kind: 'closed-return' as const, range: '24h' as CrossAssetRange }),
    Object.freeze({ horizon: '3d' as CrossAssetPriceHorizon, kind: 'curve' as const, range: '7d' as CrossAssetRange, lookbackPoints: 72 })
  ] as readonly CrossAssetPriceWindow[]),
  /** BTC measured against ETH over the same 2h window the verifier checks. */
  relativeReturn: Object.freeze({
    asset: 'BTC' as const, relativeToAsset: 'ETH' as const, horizon: '2h' as CrossAssetPriceHorizon,
    range: '24h' as CrossAssetRange, lookbackPoints: 24
  }),
  correlationRange: '24h' as CrossAssetRange
})

/** The ranges the analysis must read to cover every price horizon. */
export const crossAssetAnalysisRanges: readonly CrossAssetRange[] = Object.freeze(
  [...new Set(crossAssetAnalysisWindowPolicy.priceReturns.map(window => window.range))]
)
