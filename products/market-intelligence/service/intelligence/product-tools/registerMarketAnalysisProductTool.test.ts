import { describe, expect, it, vi } from 'vitest'

import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'
import { ProductAgentToolRegistry } from '@platform/ai/agent-platform/productTools/ProductAgentToolRegistry'
import { ProductAgentToolRuntimeService } from '@platform/ai/agent-platform/productTools/ProductAgentToolRuntimeService'
import { createInMemoryProductAgentToolTraceRepository } from '@platform/ai/agent-platform/productTools/productAgentToolTraceRepository'
import { createAgentStoreState } from '@platform/ai/agent-platform/store/agentStore'

import { marketIntelligenceProductManifest } from '../../../product.manifest'
import { registerMarketAnalysisProductTool } from './registerMarketAnalysisProductTool'

describe('registerMarketAnalysisProductTool', () => {
  it('registers one read-only context handler backed by the public query service', async () => {
    const registrations: ProductAgentToolHandlerRegistration[] = []
    const service = {
      queryFearGreedSnapshot: vi.fn(async () => ({ state: 'empty' as const, asOf: '2026-09-25T08:30:00.000Z' })),
      queryFundingRateHistory: vi.fn(async () => ({ state: 'empty' as const, asOf: '2026-09-25T08:30:00.000Z' })),
      queryCapitalConditionsSnapshot: vi.fn(async () => ({ state: 'empty' as const, asOf: '2026-09-25T08:30:00.000Z' })),
      getSourceHealth: vi.fn(async () => ({
        schemaVersion: 1, queryId: 'q', queryType: 'get_source_health' as const, asOf: '2026-09-25T08:30:00.000Z', servedAt: '2026-09-25T08:30:00.000Z', resultHash: 'h', scope: {}, timeWindow: { to: '2026-09-25T08:30:00.000Z' }, confidence: 0, caveats: [], sourceCoverage: [], evidenceRefs: [], data: { sources: [], summary: { freshCount: 0, staleCount: 0, failedCount: 0, pendingCount: 0, fixtureOnlyCount: 0, plannedCount: 0 } }
      }))
    }

    registerMarketAnalysisProductTool(registration => registrations.push(registration), () => service as never)

    expect(registrations).toHaveLength(1)
    expect(registrations[0]).toMatchObject({ productId: 'market-intelligence', handlerId: 'market-intelligence.get-market-analysis-context' })
    await expect(registrations[0]!.handle({ eventGroupId: 'mi-eg-test', asOf: '2026-09-25T08:30:00.000Z' }, {} as never)).resolves.toMatchObject({ state: 'available', profileId: 'crypto-market-analysis-v1' })
    expect(service.queryFearGreedSnapshot).toHaveBeenCalledWith({ asOf: '2026-09-25T08:30:00.000Z' })
    expect(service.queryFundingRateHistory).toHaveBeenCalledWith({ asOf: '2026-09-25T08:30:00.000Z' })
    expect(service.queryCapitalConditionsSnapshot).toHaveBeenCalledWith({ asOf: '2026-09-25T08:30:00.000Z' })
  })

  it('passes the real manifest schema through Product Agent Tool Runtime', async () => {
    const registry = new ProductAgentToolRegistry()
    registry.registerToolMetadata(marketIntelligenceProductManifest.productAgentTools!.find(tool => tool.toolName === 'get_market_analysis_context')!)
    const service = {
      queryFearGreedSnapshot: async () => ({ state: 'empty' as const, asOf: '2026-09-25T08:30:00.000Z' }),
      queryFundingRateHistory: async () => ({ state: 'empty' as const, asOf: '2026-09-25T08:30:00.000Z' }),
      queryCapitalConditionsSnapshot: async () => ({ state: 'empty' as const, asOf: '2026-09-25T08:30:00.000Z' }),
      getSourceHealth: async () => ({
        schemaVersion: 1, queryId: 'q', queryType: 'get_source_health' as const, asOf: '2026-09-25T08:30:00.000Z', servedAt: '2026-09-25T08:30:00.000Z', resultHash: 'h', scope: {}, timeWindow: { to: '2026-09-25T08:30:00.000Z' }, confidence: 0, caveats: [], sourceCoverage: [], evidenceRefs: [], data: { sources: [], summary: { freshCount: 0, staleCount: 0, failedCount: 0, pendingCount: 0, fixtureOnlyCount: 0, plannedCount: 0 } }
      })
    }
    registerMarketAnalysisProductTool(registration => registry.registerHandler(registration), () => service as never)
    const runtime = new ProductAgentToolRuntimeService({ registry, traceRepository: createInMemoryProductAgentToolTraceRepository(), installedProductIds: () => ['market-intelligence'] })
    const state = {
      ...createAgentStoreState(),
      agentProductToolPackages: [{ agentId: 'agent-1', productId: 'market-intelligence', permissionMode: 'allow-read-only' as const, updatedAt: '2026-09-25T08:30:00.000Z' }]
    }

    await expect(runtime.invokeTool(state, {
      agentId: 'agent-1', sessionId: 'session-1', productId: 'market-intelligence', toolName: 'get_market_analysis_context',
      input: { eventGroupId: 'mi-eg-test', asOf: '2026-09-25T08:30:00.000Z' }, toolCallId: 'mi-a03-runtime-1'
    })).resolves.toMatchObject({ output: { state: 'available', profileId: 'crypto-market-analysis-v1' } })
    await expect(runtime.invokeTool(state, {
      agentId: 'agent-1', sessionId: 'session-1', productId: 'market-intelligence', toolName: 'get_market_analysis_context',
      input: { eventGroupId: 'mi-eg-test' }, toolCallId: 'mi-a03-runtime-invalid-1'
    })).rejects.toMatchObject({ code: 'invalid-input-schema' })
  })
})
