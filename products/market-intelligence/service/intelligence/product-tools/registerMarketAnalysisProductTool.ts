import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { buildMarketAnalysisContext } from '../public-query/marketAnalysisContextQuery'
import type { MarketAnalysisContextInput } from '../../../contracts/marketAnalysisContracts'

const PRODUCT_ID = 'market-intelligence'

export function registerMarketAnalysisProductTool(
  register: (registration: ProductAgentToolHandlerRegistration) => void,
  getPublicQueryService: () => MarketIntelligencePublicQueryService
): void {
  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.get-market-analysis-context',
    handle: async (input) => buildMarketAnalysisContext((input ?? {}) as MarketAnalysisContextInput, getPublicQueryService())
  })
}
