import { describe, expect, it } from 'vitest'

import { createInMemoryProductAgentToolTraceRepository } from './productAgentToolTraceRepository'
import { ProductAgentToolRegistry } from './ProductAgentToolRegistry'
import { ProductAgentToolRuntimeService } from './ProductAgentToolRuntimeService'
import { createAgentStoreState } from '../store/agentStore'

describe('ProductAgentToolRuntimeService', () => {
  it('records terminal traces for pre-handler failures', async () => {
    const registry = new ProductAgentToolRegistry()
    const traceRepository = createInMemoryProductAgentToolTraceRepository()
    const runtime = new ProductAgentToolRuntimeService({
      registry,
      traceRepository,
      installedProductIds: () => ['market-intelligence']
    })

    registry.registerToolMetadata({
      toolName: 'get_source_health',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-source-health',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object' },
      schemaVersion: 1,
      description: 'health',
      readOnly: true,
      requiresTemporalBoundary: false,
      requiresApproval: 'never'
    })
    registry.registerHandler({
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-source-health',
      handle: async () => ({ ok: true })
    })

    const state = createAgentStoreState()

    await expect(
      runtime.invokeTool(state, {
        agentId: 'agent-1',
        sessionId: 'session-1',
        productId: 'market-intelligence',
        toolName: 'get_source_health',
        input: {},
        toolCallId: 'trace-disabled-1'
      })
    ).rejects.toThrow('disabled')

    const trace = await traceRepository.get('trace-disabled-1')
    expect(trace?.status).toBe('failed')
    expect(trace?.errorCode).toBe('tool-disabled')
    expect(trace?.completedAt).toBeTruthy()
  })

  it('rejects invalid input schema before handler execution', async () => {
    const registry = new ProductAgentToolRegistry()
    const traceRepository = createInMemoryProductAgentToolTraceRepository()
    const runtime = new ProductAgentToolRuntimeService({
      registry,
      traceRepository,
      installedProductIds: () => ['market-intelligence']
    })

    registry.registerToolMetadata({
      toolName: 'query_sentiment_snapshot',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.query-sentiment-snapshot',
      inputSchema: { type: 'object', required: ['asOf'], properties: { asOf: { type: 'string' } } },
      outputSchema: { type: 'object' },
      schemaVersion: 1,
      description: 'snapshot',
      readOnly: true,
      requiresTemporalBoundary: true,
      requiresApproval: 'on-sensitive'
    })
    registry.registerHandler({
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.query-sentiment-snapshot',
      handle: async () => ({ items: [] })
    })

    const state = {
      ...createAgentStoreState(),
      agentProductToolPackages: [
        {
          agentId: 'agent-1',
          productId: 'market-intelligence',
          permissionMode: 'allow-read-only' as const,
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }

    await expect(
      runtime.invokeTool(state, {
        agentId: 'agent-1',
        sessionId: 'session-1',
        productId: 'market-intelligence',
        toolName: 'query_sentiment_snapshot',
        input: {},
        toolCallId: 'trace-invalid-input-1'
      })
    ).rejects.toMatchObject({ code: 'invalid-input-schema' })

    const trace = await traceRepository.get('trace-invalid-input-1')
    expect(trace?.errorCode).toBe('invalid-input-schema')
  })

  it('rejects invalid output schema after handler execution', async () => {
    const registry = new ProductAgentToolRegistry()
    const traceRepository = createInMemoryProductAgentToolTraceRepository()
    const runtime = new ProductAgentToolRuntimeService({
      registry,
      traceRepository,
      installedProductIds: () => ['market-intelligence']
    })

    registry.registerToolMetadata({
      toolName: 'get_source_health',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-source-health',
      inputSchema: { type: 'object', properties: {} },
      outputSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } },
      schemaVersion: 1,
      description: 'health',
      readOnly: true,
      requiresTemporalBoundary: false,
      requiresApproval: 'never'
    })
    registry.registerHandler({
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-source-health',
      handle: async () => ({ ok: 'not-a-boolean' })
    })

    const state = {
      ...createAgentStoreState(),
      agentProductToolPackages: [
        {
          agentId: 'agent-1',
          productId: 'market-intelligence',
          permissionMode: 'allow-read-only' as const,
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }

    await expect(
      runtime.invokeTool(state, {
        agentId: 'agent-1',
        sessionId: 'session-1',
        productId: 'market-intelligence',
        toolName: 'get_source_health',
        input: {},
        toolCallId: 'trace-invalid-output-1'
      })
    ).rejects.toMatchObject({ code: 'invalid-output-schema' })

    const trace = await traceRepository.get('trace-invalid-output-1')
    expect(trace?.status).toBe('failed')
    expect(trace?.errorCode).toBe('invalid-output-schema')
  })
})
