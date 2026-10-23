import { describe, expect, it, vi } from 'vitest'

import { invokeProductAgentToolThroughBridge, createProductToolCallId } from './productAgentToolExecutionBridge'
import { ProductAgentToolRuntimeService } from './ProductAgentToolRuntimeService'
import { ProductAgentToolRegistry } from './ProductAgentToolRegistry'
import { createAgentStoreState } from '../store/agentStore'

describe('invokeProductAgentToolThroughBridge', () => {
  it('uses the same toolCallId for start and finish chunks', async () => {
    const registry = new ProductAgentToolRegistry()
    const runtime = new ProductAgentToolRuntimeService({
      registry,
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

    const toolCallId = createProductToolCallId()
    const chunks: Array<{ type: string; toolCallId: string }> = []
    const productTools = runtime.getAgentRuntime(state, 'agent-1')

    await invokeProductAgentToolThroughBridge(runtime, productTools, {
      getState: async () => state,
      sessionId: 'session-1',
      agentId: 'agent-1',
      runtimeToolName: 'mcp__market-intelligence__get_source_health',
      toolInput: {},
      toolCallId,
      emitChunk: (chunk) => {
        if (chunk.type === 'product-tool-call-start' || chunk.type === 'product-tool-call-finish') {
          chunks.push({ type: chunk.type, toolCallId: chunk.toolCallId })
        }
      }
    })

    expect(chunks).toEqual([
      { type: 'product-tool-call-start', toolCallId },
      { type: 'product-tool-call-finish', toolCallId }
    ])
  })
})
