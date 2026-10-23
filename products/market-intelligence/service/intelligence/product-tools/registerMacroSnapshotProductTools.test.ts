import { describe, expect, it, vi } from 'vitest'

import type { ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

import { registerMacroSnapshotProductTools } from './registerMacroSnapshotProductTools'

const AS_OF = '2026-10-14T12:00:00.000Z'

function service(overrides: Partial<Record<'market' | 'rates', unknown>> = {}) {
  return {
    queryMacroMarketSnapshot: overrides.market === undefined
      ? vi.fn(() => ({ state: 'empty' as const, asOf: AS_OF, readings: [], caveats: [] }))
      : vi.fn(() => overrides.market),
    queryMacroRatesSnapshot: overrides.rates === undefined
      ? vi.fn(() => ({ state: 'empty' as const, asOf: AS_OF, readings: [], caveats: [] }))
      : vi.fn(() => overrides.rates)
  }
}

function handlersFor(target: ReturnType<typeof service>) {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>()
  registerMacroSnapshotProductTools(
    (registration: ProductAgentToolHandlerRegistration) => handlers.set(registration.handlerId, registration.handle),
    () => target as never
  )
  return handlers
}

describe('registerMacroSnapshotProductTools', () => {
  it('exposes the same macro snapshot the panel reads, with no arguments', async () => {
    const target = service({ market: { state: 'available', asOf: AS_OF, readings: [{ seriesId: 'dxy-real', level: 102.24, atMs: Date.parse(AS_OF), returns: {} }], caveats: [] } })
    const handlers = handlersFor(target)

    await expect(handlers.get('market-intelligence.get-macro-market-snapshot')?.({})).resolves.toMatchObject({ state: 'available' })
    expect(target.queryMacroMarketSnapshot).toHaveBeenCalledWith()
  })

  it('answers unavailable rather than inventing a value when the query is not wired', async () => {
    const handlers = handlersFor({ queryMacroMarketSnapshot: () => undefined, queryMacroRatesSnapshot: () => undefined } as never)

    await expect(handlers.get('market-intelligence.get-macro-market-snapshot')?.({})).resolves.toEqual({ state: 'unavailable' })
    await expect(handlers.get('market-intelligence.get-macro-rates-snapshot')?.({})).resolves.toEqual({ state: 'unavailable' })
  })

  it('registers both handlers under the manifest identities', () => {
    const handlers = handlersFor(service())

    expect([...handlers.keys()]).toEqual([
      'market-intelligence.get-macro-market-snapshot',
      'market-intelligence.get-macro-rates-snapshot'
    ])
  })

  it('passes the real manifest schemas through the product agent tool runtime', async () => {
    vi.resetModules()
    vi.doMock('../intelligenceModule', () => ({
      getIntelligenceModule: () => ({
        publicQueryService: {
          queryMacroMarketSnapshot: () => ({
            state: 'available' as const, asOf: AS_OF, caveats: ['synthetic-dollar-index'],
            readings: [{ seriesId: 'dxy-synthetic', level: 101.42, atMs: Date.parse(AS_OF), returns: { '24h': 0.4 }, synthetic: true as const }]
          }),
          queryMacroRatesSnapshot: () => ({
            state: 'available' as const, asOf: AS_OF, caveats: ['official-daily-close'],
            readings: [{ seriesId: 'DGS10', metricKey: 'US_10Y_YIELD', actual: 4.15, previous: 4.13, period: '2026-10-13' }]
          })
        }
      })
    }))
    const { registerIntelligenceProductTools } = await import('./registerIntelligenceProductTools')
    const { marketIntelligenceProductManifest } = await import('../../../product.manifest')
    const { ProductAgentToolRegistry } = await import('@platform/ai/agent-platform/productTools/ProductAgentToolRegistry')
    const { ProductAgentToolRuntimeService } = await import('@platform/ai/agent-platform/productTools/ProductAgentToolRuntimeService')
    const { createInMemoryProductAgentToolTraceRepository } = await import('@platform/ai/agent-platform/productTools/productAgentToolTraceRepository')
    const { createAgentStoreState } = await import('@platform/ai/agent-platform/store/agentStore')

    const registry = new ProductAgentToolRegistry()
    for (const toolName of ['get_macro_market_snapshot', 'get_macro_rates_snapshot']) {
      registry.registerToolMetadata(marketIntelligenceProductManifest.productAgentTools!.find(tool => tool.toolName === toolName)!)
    }
    registerIntelligenceProductTools(registration => registry.registerHandler(registration), {} as never)
    const runtime = new ProductAgentToolRuntimeService({
      registry, traceRepository: createInMemoryProductAgentToolTraceRepository(), installedProductIds: () => ['market-intelligence']
    })
    const state = {
      ...createAgentStoreState(),
      agentProductToolPackages: [{ agentId: 'agent-1', productId: 'market-intelligence', permissionMode: 'allow-read-only' as const, updatedAt: AS_OF }]
    }

    await expect(runtime.invokeTool(state, {
      agentId: 'agent-1', sessionId: 'session-1', productId: 'market-intelligence', toolName: 'get_macro_market_snapshot',
      input: {}, toolCallId: 'mi-macro-market-1'
    })).resolves.toMatchObject({ output: { state: 'available', readings: [{ seriesId: 'dxy-synthetic', synthetic: true }] } })
    await expect(runtime.invokeTool(state, {
      agentId: 'agent-1', sessionId: 'session-1', productId: 'market-intelligence', toolName: 'get_macro_rates_snapshot',
      input: {}, toolCallId: 'mi-macro-rates-1'
    })).resolves.toMatchObject({ output: { state: 'available', readings: [{ seriesId: 'DGS10', actual: 4.15, period: '2026-10-13' }] } })

    vi.doUnmock('../intelligenceModule')
  })
})
