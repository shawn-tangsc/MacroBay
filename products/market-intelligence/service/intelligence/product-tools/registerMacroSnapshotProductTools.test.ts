import { describe, expect, it, vi } from 'vitest'

import type { ProductAgentToolHandlerContext, ProductAgentToolHandlerRegistration } from '@platform/ai/agent-platform/productTools/productAgentToolBootstrapContracts'

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

/**
 * 平台拿到的是**登记项**，调用方式是 `handle(input, context)`——两个必填参数，装不进
 * `(input) => Promise<unknown>` 这种单参签名。夹具照平台的方式来：留住登记项，用它自己的 `handle` 调。
 */
function handlersFor(target: ReturnType<typeof service>) {
  const registrations = new Map<string, ProductAgentToolHandlerRegistration>()
  registerMacroSnapshotProductTools(
    (registration) => { registrations.set(registration.handlerId, registration) },
    () => target as never
  )
  return registrations
}

/** 平台每次调用都传这一份；本文件的用例不读它，但它是签名的一部分。 */
function contextFor(handlerId: string): ProductAgentToolHandlerContext {
  return {
    toolCallId: `call-${handlerId}`, productId: 'market-intelligence', toolName: handlerId, schemaVersion: 1,
    agentId: 'agent-1', agentSessionId: 'session-1', signal: new AbortController().signal, log: async () => undefined
  }
}

function callTool(registrations: ReadonlyMap<string, ProductAgentToolHandlerRegistration>, handlerId: string): Promise<unknown> {
  const registration = registrations.get(handlerId)
  if (!registration) throw new Error(`handler not registered: ${handlerId}`)
  return registration.handle({}, contextFor(handlerId))
}

describe('registerMacroSnapshotProductTools', () => {
  it('exposes the same macro snapshot the panel reads, with no arguments', async () => {
    const target = service({ market: { state: 'available', asOf: AS_OF, readings: [{ seriesId: 'dxy-real', level: 102.24, atMs: Date.parse(AS_OF), returns: {} }], caveats: [] } })
    const handlers = handlersFor(target)

    await expect(callTool(handlers, 'market-intelligence.get-macro-market-snapshot')).resolves.toMatchObject({ state: 'available' })
    expect(target.queryMacroMarketSnapshot).toHaveBeenCalledWith()
  })

  it('answers unavailable rather than inventing a value when the query is not wired', async () => {
    const handlers = handlersFor({ queryMacroMarketSnapshot: () => undefined, queryMacroRatesSnapshot: () => undefined } as never)

    await expect(callTool(handlers, 'market-intelligence.get-macro-market-snapshot')).resolves.toEqual({ state: 'unavailable' })
    await expect(callTool(handlers, 'market-intelligence.get-macro-rates-snapshot')).resolves.toEqual({ state: 'unavailable' })
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
    const injectedModule = {
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
    } as never
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
    registerIntelligenceProductTools(registration => registry.registerHandler(registration), {} as never, injectedModule)
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
