import { describe, expect, it, vi } from 'vitest'

import type { JobRuntime } from '@platform/jobs'
import type { ProductAgentToolHandlerContext, ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

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

/** The composition root builds the module once; the registrar receives that instance. */
const moduleUnderTest = { publicQueryService: mockPublicQueryService } as never

/**
 * 平台拿到的是**登记项**，调用方式是 `handle(input, context)`，所以夹具也照这个来：留住注册进来的那一份，
 * 再用平台会给的上下文调它。原来那张 `(input) => Promise<unknown>` 的表连 handler 都装不下——两个必填参数
 * 不能赋给一个只收一个参数的签名。
 */
function captureRegistrations(module: typeof moduleUnderTest): Map<string, ProductAgentToolHandlerRegistration> {
  const registrations = new Map<string, ProductAgentToolHandlerRegistration>()
  registerIntelligenceProductTools(
    (registration) => { registrations.set(registration.handlerId, registration) },
    {} as JobRuntime,
    module
  )
  return registrations
}

/** 平台每次调用都传这一份；本文件的用例不读它，但它是签名的一部分，不是一个能省的占位。 */
function handlerContext(handlerId: string): ProductAgentToolHandlerContext {
  return {
    toolCallId: `call-${handlerId}`, productId: 'market-intelligence', toolName: handlerId, schemaVersion: 1,
    agentId: 'agent-1', agentSessionId: 'session-1', signal: new AbortController().signal, log: async () => undefined
  }
}

function callTool(
  registrations: ReadonlyMap<string, ProductAgentToolHandlerRegistration>,
  handlerId: string,
  input: unknown
): Promise<unknown> {
  const registration = registrations.get(handlerId)
  if (!registration) throw new Error(`handler not registered: ${handlerId}`)
  return registration.handle(input, handlerContext(handlerId))
}

describe('registerIntelligenceProductTools', () => {
  it('delegates each handler to the public query service', async () => {
    const registrations = captureRegistrations(moduleUnderTest)

    await callTool(registrations, 'market-intelligence.query-sentiment-snapshot', { asOf: '2026-07-08T10:00:00.000Z' })
    await callTool(registrations, 'market-intelligence.query-sentiment-series', { asOf: '2026-07-08T10:00:00.000Z' })
    await callTool(registrations, 'market-intelligence.query-related-events', { asOf: '2026-07-08T10:00:00.000Z' })
    await callTool(registrations, 'market-intelligence.query-impact-timeline', { asOf: '2026-07-08T10:00:00.000Z' })
    await callTool(registrations, 'market-intelligence.get-source-health', { asOf: '2026-07-08T10:00:00.000Z' })
    await callTool(registrations, 'market-intelligence.get-evidence-excerpt', {
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
    const registrations = captureRegistrations(moduleUnderTest)
    expect(registrations.get(provenanceExplainTool.handlerId), 'the manifest names this handler, so it must be registered').toBeDefined()
    const handle = (input: unknown) => callTool(registrations, provenanceExplainTool.handlerId, input)

    // 不带族名 → 索引：模型得先知道有什么可查，才不会替没有记录的东西编来源。
    const index = await handle({}) as { families: string[]; index: string }
    expect(index.families).toEqual([...traceabilityFamiliesOwnedHere])
    expect(index.index).toContain(provenanceMethods.explainFigure)

    // 带族名 → 该族的口径与现值；不认识的族与非法形状都要老实说"没有"，不猜。
    expect((await handle({ family: 'cross-market-reading' }) as { state: string }).state).toBe('available')
    expect((await handle({ family: 'moon-phase' }) as { state: string }).state).toBe('unavailable')
    expect((await handle({ family: 'not a family' }) as { state: string }).state).toBe('unavailable')
  })
})
