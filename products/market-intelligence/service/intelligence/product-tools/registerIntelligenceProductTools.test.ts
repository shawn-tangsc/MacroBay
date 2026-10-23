import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'

import { registerIntelligenceProductTools } from './registerIntelligenceProductTools'
import { MARKET_INTELLIGENCE_QUERY_TYPES } from '../../../contracts/intelligenceQueryContracts'
import { provenanceMethods } from '../../../contracts/provenanceContracts'
import { provenanceExplainTool } from '../../../tools/provenance-explain'
import { traceabilityFamiliesOwnedHere } from '../provenance/traceabilityCatalog'

const mockPublicQueryService = {
  querySentimentSnapshot: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSnapshot })),
  querySentimentSeries: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sentimentSeries })),
  queryRelatedEvents: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.relatedEvents })),
  queryImpactTimeline: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.impactTimeline })),
  getSourceHealth: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.sourceHealth })),
  getEvidenceExcerpt: vi.fn(async () => ({ queryType: MARKET_INTELLIGENCE_QUERY_TYPES.evidenceExcerpt }))
}

vi.mock('../intelligenceModule', () => ({
  getIntelligenceModule: () => ({
    publicQueryService: mockPublicQueryService
  })
}))

describe('registerIntelligenceProductTools', () => {
  it('delegates each handler to the public query service', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
    registerIntelligenceProductTools(
      (registration) => {
        handlers.set(registration.handlerId, registration.handle)
      },
      {} as JobRuntime
    )

    await handlers.get('market-intelligence.query-sentiment-snapshot')?.({ asOf: '2026-07-08T10:00:00.000Z' })
    await handlers.get('market-intelligence.query-sentiment-series')?.({ asOf: '2026-07-08T10:00:00.000Z' })
    await handlers.get('market-intelligence.query-related-events')?.({ asOf: '2026-07-08T10:00:00.000Z' })
    await handlers.get('market-intelligence.query-impact-timeline')?.({ asOf: '2026-07-08T10:00:00.000Z' })
    await handlers.get('market-intelligence.get-source-health')?.({ asOf: '2026-07-08T10:00:00.000Z' })
    await handlers.get('market-intelligence.get-evidence-excerpt')?.({
      asOf: '2026-07-08T10:00:00.000Z',
      itemId: 'item-1'
    })

    expect(mockPublicQueryService.querySentimentSnapshot).toHaveBeenCalledWith({
      asOf: '2026-07-08T10:00:00.000Z'
    })
    expect(mockPublicQueryService.getSourceHealth).toHaveBeenCalledWith({
      asOf: '2026-07-08T10:00:00.000Z'
    })
    expect(mockPublicQueryService.getEvidenceExcerpt).toHaveBeenCalledWith({
      asOf: '2026-07-08T10:00:00.000Z',
      itemId: 'item-1'
    })
  })

  it('serves the figure-provenance tool: the index without arguments, the explanation with a family', async () => {
    const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
    registerIntelligenceProductTools((registration) => { handlers.set(registration.handlerId, registration.handle) }, {} as JobRuntime)
    const handle = handlers.get(provenanceExplainTool.handlerId)
    expect(handle, 'the manifest names this handler, so it must be registered').toBeDefined()

    // 不带族名 → 索引：模型得先知道有什么可查，才不会替没有记录的东西编来源。
    const index = await handle!({}) as { families: string[]; index: string }
    expect(index.families).toEqual([...traceabilityFamiliesOwnedHere])
    expect(index.index).toContain(provenanceMethods.explainFigure)

    // 带族名 → 该族的口径与现值；不认识的族与非法形状都要老实说"没有"，不猜。
    expect((await handle!({ family: 'cross-market-reading' }) as { state: string }).state).toBe('available')
    expect((await handle!({ family: 'moon-phase' }) as { state: string }).state).toBe('unavailable')
    expect((await handle!({ family: 'not a family' }) as { state: string }).state).toBe('unavailable')
  })
})
