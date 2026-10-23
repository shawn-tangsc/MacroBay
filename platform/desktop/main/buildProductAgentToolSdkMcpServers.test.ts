import { describe, expect, it, vi } from 'vitest'

import type { AgentRuntimeComposition } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import { ProductAgentToolRegistry } from '../../ai/agent-platform/productTools/ProductAgentToolRegistry'
import { ProductAgentToolRuntimeService } from '../../ai/agent-platform/productTools/ProductAgentToolRuntimeService'
import { createAgentStoreState } from '../../ai/agent-platform/store/agentStore'
import { buildProductAgentToolSdkMcpServers } from './buildProductAgentToolSdkMcpServers'

describe('buildProductAgentToolSdkMcpServers', () => {
  it('passes manifest inputSchema and re-reads agent state on invoke', async () => {
    const registry = new ProductAgentToolRegistry()
    const runtime = new ProductAgentToolRuntimeService({
      registry,
      installedProductIds: () => ['market-intelligence']
    })

    const inputSchema = {
      type: 'object',
      required: ['symbol'],
      properties: {
        symbol: { type: 'string' }
      }
    }

    registry.registerToolMetadata({
      toolName: 'get_source_health',
      productId: 'market-intelligence',
      handlerId: 'market-intelligence.get-source-health',
      inputSchema,
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

    const getAgentState = vi.fn(async () => ({
      ...createAgentStoreState(),
      agentProductToolPackages: [
        {
          agentId: 'agent-1',
          productId: 'market-intelligence',
          permissionMode: 'allow-read-only' as const,
          updatedAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    }))

    const capturedSchemas: unknown[] = []
    const sdk = {
      tool: vi.fn((_name, _description, schema, handler) => {
        capturedSchemas.push(schema)
        return { handler }
      }),
      createSdkMcpServer: vi.fn((input) => input)
    }

    const composition: AgentRuntimeComposition = {
      agentId: 'agent-1',
      sessionId: 'session-1',
      agentType: 'claude-code',
      instructions: null,
      modelId: 'provider:model-a',
      modelName: null,
      permissionMode: 'acceptEdits',
      workspacePath: '/tmp/workspace',
      workspaceType: 'user',
      environment: {},
      tools: { all: [], enabled: [], disabled: [] },
      mcp: { sources: [], servers: [] },
      skills: { agentId: 'agent-1', skills: [], toolIds: [] },
      productTools: runtime.getAgentRuntime(await getAgentState(), 'agent-1')
    }

    const servers = await buildProductAgentToolSdkMcpServers({
      composition,
      agentId: 'agent-1',
      sessionId: 'session-1',
      getAgentState,
      registry,
      runtime,
      emitChunk: () => undefined,
      loadSdkHelpers: async () => sdk
    })

    expect(Object.keys(servers)).toEqual(['market-intelligence'])
    expect(capturedSchemas[0]).toEqual(inputSchema)

    const handler = sdk.tool.mock.calls[0]?.[3] as (args: Record<string, unknown>) => Promise<unknown>
    await handler({ symbol: 'sample-input' })

    expect(getAgentState).toHaveBeenCalled()
  })
})
