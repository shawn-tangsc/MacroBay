import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { buildMarketAnalysisContext } from '../public-query/marketAnalysisContextQuery'
import type { MarketAnalysisContextInput, MarketAnalysisContextResult } from '../../../contracts/marketAnalysisContracts'

const PRODUCT_ID = 'market-intelligence'

export function registerMarketAnalysisProductTool(
  register: (registration: ProductAgentToolHandlerRegistration) => void,
  getPublicQueryService: () => MarketIntelligencePublicQueryService
): void {
  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.get-market-analysis-context',
    handle: async (input) => withoutSourceUrlsForModel(
      await buildMarketAnalysisContext((input ?? {}) as MarketAnalysisContextInput, getPublicQueryService())
    )
  })
}

/**
 * The context an Agent reads must not carry source URLs.
 *
 * The frozen snapshot keeps them so a conclusion can be audited, but the shared policy is that a
 * model is handed data, never a URL it might quote or follow. The promotion happens on the tool
 * boundary rather than in the context builder, because the auto-analysis path still needs the URL
 * when it freezes the snapshot.
 */
export function withoutSourceUrlsForModel(result: MarketAnalysisContextResult): MarketAnalysisContextResult {
  if (result.state !== 'available') return result
  return {
    ...result,
    facts: result.facts.map(({ sourceUrl: _sourceUrl, ...fact }) => fact),
    evidenceRefs: result.evidenceRefs.map(({ sourceUrl: _sourceUrl, ...ref }) => ref)
  }
}
