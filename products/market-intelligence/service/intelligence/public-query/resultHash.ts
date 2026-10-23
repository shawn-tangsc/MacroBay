import { canonicalJsonHash } from '@platform/ai/agent-platform/productTools/productAgentToolHash'

import type { MarketIntelligenceQueryResult } from './queryContracts'

export type QueryResultHashInput = Omit<MarketIntelligenceQueryResult<unknown>, 'resultHash' | 'servedAt' | 'queryId'>

export function buildQueryResultHash(input: QueryResultHashInput): string {
  return canonicalJsonHash(input).sha256
}
