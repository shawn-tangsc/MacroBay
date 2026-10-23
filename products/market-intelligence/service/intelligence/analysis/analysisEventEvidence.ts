import { MARKET_ANALYSIS_CONTRACT_POLICY, isMarketAnalysisCanonicalUtc, type EventGroup, type MarketAnalysisContextAvailable } from '../../../contracts/marketAnalysisContracts'
import type { MarketIntelligencePublicQueryService } from '../public-query/publicQueryService'
import { hashMarketAnalysisJson } from './analysisHash'
import { marketAnalysisUnsafeOutputPolicy } from './analysisConstants'

// Event excerpts support their own historical claims, never unrelated current metric values.
export async function appendAnalysisEventEvidence(
  context: MarketAnalysisContextAvailable,
  group: Pick<EventGroup, 'eventRefs' | 'groupType'>,
  query: Pick<MarketIntelligencePublicQueryService, 'getEvidenceExcerpt'>,
  listRevisions: () => readonly { itemId: string; detectedAt: string }[] = () => []
): Promise<MarketAnalysisContextAvailable> {
  const facts = [...context.facts]
  const evidenceRefs = [...context.evidenceRefs]
  for (const itemId of group.eventRefs.slice(0, MARKET_ANALYSIS_CONTRACT_POLICY.maximumCollectionItems)) {
    let result
    try { result = await query.getEvidenceExcerpt({ itemId, asOf: context.asOf }) } catch { continue }
    if (listRevisions().some(revision => revision.itemId === itemId && revision.detectedAt > context.asOf)) continue
    const ref = result.evidenceRefs.find(candidate => candidate.itemId === itemId && candidate.evidenceRefId === result.data.evidenceRef.evidenceRefId)
    const excerpt = result.data.excerpt ?? result.data.title
    if (!ref || !ref.excerptHash || !isMarketAnalysisCanonicalUtc(ref.visibleAt) || ref.visibleAt > context.asOf ||
      !ref.publishedAt || !isMarketAnalysisCanonicalUtc(ref.publishedAt) || ref.publishedAt > context.asOf ||
      !excerpt || excerpt.includes('[REDACTED]') || excerpt.length > MARKET_ANALYSIS_CONTRACT_POLICY.maximumModelFieldCharacters ||
      marketAnalysisUnsafeOutputPolicy.prohibitedPatterns.some(pattern => pattern.test(excerpt))) continue
    const factId = `mi-fact-event-${hashMarketAnalysisJson({ itemId, excerptHash: ref.excerptHash })}`
    if (facts.some(fact => fact.factId === factId)) continue
    facts.push({ factId, domain: group.groupType === 'market-reaction' ? 'cross-asset' : group.groupType,
      subject: itemId, metric: 'event-excerpt', value: excerpt, unit: null, sourceId: ref.sourceId, sourceLabel: ref.sourceId,
      observedAt: ref.publishedAt, asOf: context.asOf, freshness: 'stale', confidence: 1, comparability: 'not-comparable', evidenceRefId: ref.evidenceRefId })
    if (!evidenceRefs.some(candidate => candidate.evidenceRefId === ref.evidenceRefId)) evidenceRefs.push({
      evidenceRefId: ref.evidenceRefId, sourceId: ref.sourceId, sourceLabel: ref.sourceId, itemId,
      occurredAt: ref.occurredAt ?? null, publishedAt: ref.publishedAt, detectedAt: ref.detectedAt,
      computedAt: ref.computedAt ?? null, visibleAt: ref.visibleAt, excerptHash: ref.excerptHash
    })
  }
  return { ...context, facts, evidenceRefs }
}
