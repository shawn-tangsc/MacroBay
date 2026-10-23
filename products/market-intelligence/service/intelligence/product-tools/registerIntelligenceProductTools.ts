import type { JobRuntime } from '@platform/jobs'
import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import { getIntelligenceModule } from '../intelligenceModule'
import { isProvenanceExplainQuery, parseProvenanceExplanation, type ProvenanceExplanation } from '../../../contracts/provenanceContracts'
import { provenanceExplainTool } from '../../../tools/provenance-explain'
import { explainFigure } from '../provenance/traceabilityExplain'
import { buildProvenanceIndex, renderProvenanceIndex } from '../provenance/traceabilityIndex'
import { registerMarketAnalysisProductTool } from './registerMarketAnalysisProductTool'
import { registerMacroSnapshotProductTools } from './registerMacroSnapshotProductTools'
import type {
  EvidenceExcerptQueryInput,
  MarketIntelligenceTimeBoundQueryInput
} from '../../../contracts/intelligenceQueryContracts'

const PRODUCT_ID = 'market-intelligence'

function asTimeBoundInput(input: unknown): MarketIntelligenceTimeBoundQueryInput {
  return (input ?? {}) as MarketIntelligenceTimeBoundQueryInput
}

function asEvidenceInput(input: unknown): EvidenceExcerptQueryInput {
  return (input ?? {}) as EvidenceExcerptQueryInput
}

export function registerIntelligenceProductTools(
  register: (registration: ProductAgentToolHandlerRegistration) => void,
  jobRuntime: JobRuntime
): void {
  const publicQueryService = () => getIntelligenceModule(jobRuntime).publicQueryService

  registerMarketAnalysisProductTool(register, publicQueryService)
  registerMacroSnapshotProductTools(register, publicQueryService)

  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.query-sentiment-snapshot',
    handle: async (input) => publicQueryService().querySentimentSnapshot(asTimeBoundInput(input))
  })

  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.query-sentiment-series',
    handle: async (input) => publicQueryService().querySentimentSeries(asTimeBoundInput(input))
  })

  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.query-related-events',
    handle: async (input) => publicQueryService().queryRelatedEvents(asTimeBoundInput(input))
  })

  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.query-impact-timeline',
    handle: async (input) => publicQueryService().queryImpactTimeline(asTimeBoundInput(input))
  })

  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.get-source-health',
    handle: async (input) => publicQueryService().getSourceHealth(asTimeBoundInput(input))
  })

  // 数字来源与算式（设计 144）：不带族名先给索引——模型得先知道有什么可查，才不会替没有记录的东西编来源。
  register({
    productId: PRODUCT_ID,
    handlerId: provenanceExplainTool.handlerId,
    handle: async (input): Promise<ProvenanceExplanation | Readonly<{ state: 'available'; index: string; families: readonly string[]; notOnThisSide: readonly string[] }>> => {
      const asked = input === undefined || input === null || (typeof input === 'object' && Object.keys(input as object).length === 0)
      if (asked) {
        const index = buildProvenanceIndex()
        return { state: 'available' as const, index: renderProvenanceIndex(index), families: index.families.map(family => family.id), notOnThisSide: index.notOnThisSide }
      }
      if (!isProvenanceExplainQuery(input)) return { state: 'unavailable' as const, family: '', reason: 'unknown-family' as const, ownedHere: [] }
      return parseProvenanceExplanation(explainFigure(input.family)) ?? { state: 'unavailable' as const, family: input.family, reason: 'unknown-family' as const, ownedHere: [] }
    }
  })

  register({
    productId: PRODUCT_ID,
    handlerId: 'market-intelligence.get-evidence-excerpt',
    handle: async (input) => publicQueryService().getEvidenceExcerpt(asEvidenceInput(input))
  })
}
