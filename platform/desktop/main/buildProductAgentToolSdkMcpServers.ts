import type { AgentRuntimeComposition } from '../../ai/agent-platform/runtime/AgentRuntimeCompositionService'
import type { ProductAgentToolRuntimeService } from '../../ai/agent-platform/productTools/ProductAgentToolRuntimeService'
import {
  createProductToolCallId,
  invokeProductAgentToolThroughBridge
} from '../../ai/agent-platform/productTools/productAgentToolExecutionBridge'
import {
  buildProductAgentToolMcpServerKey,
  buildProductAgentToolRuntimeName
} from '../../ai/agent-platform/productTools/productAgentToolRuntimeNames'
import type { AgentRuntimeSessionChunk } from '../../ai/agent-platform/runtime/runtimeTypes'
import type { AgentStoreState } from '../../ai/agent-platform/store/agentStore'
import type { ProductAgentToolRegistry } from '../../ai/agent-platform/productTools/ProductAgentToolRegistry'
import { jsonSchemaToZod } from '../../ai/agent-platform/tools/jsonSchemaToZod'

type ProductAgentToolSdkModule = {
  tool?: (
    name: string,
    description: string,
    schema: unknown,
    handler: (args: Record<string, unknown>) => Promise<{ content: Array<{ type: 'text'; text: string }> }>
  ) => unknown
  createSdkMcpServer?: (input: {
    name: string
    version?: string
    tools: unknown[]
  }) => unknown
}

type BuildProductAgentToolSdkMcpServersInput = {
  composition: AgentRuntimeComposition
  agentId: string
  sessionId: string
  getAgentState: () => Promise<AgentStoreState>
  registry: ProductAgentToolRegistry
  runtime: ProductAgentToolRuntimeService
  emitChunk: (chunk: AgentRuntimeSessionChunk) => void
  signal?: AbortSignal
  loadSdkHelpers?: () => Promise<ProductAgentToolSdkModule | null>
}

export async function buildProductAgentToolSdkMcpServers(
  input: BuildProductAgentToolSdkMcpServersInput
): Promise<Record<string, unknown>> {
  const productTools = input.composition.productTools
  if (!productTools || productTools.packages.length === 0) return {}

  const sdk = (await input.loadSdkHelpers?.()) ?? (await defaultLoadProductToolSdkHelpers())
  if (!sdk?.tool || !sdk.createSdkMcpServer) return {}

  const servers: Record<string, unknown> = {}

  for (const pkg of productTools.packages) {
    if (pkg.permissionMode === 'disabled' || pkg.status !== 'available') continue

    const descriptors = input.registry.listToolsForProduct(pkg.productId).filter((tool) => tool.hasHandler)
    if (descriptors.length === 0) continue

    const sdkTools = descriptors.map((descriptor) => {
      const registration = input.registry.resolve(pkg.productId, descriptor.toolName)
      // The SDK's in-process MCP server only accepts Zod schemas, so render the manifest's JSON
      // Schema through the shared adapter instead of handing it the raw object.
      const inputSchema = jsonSchemaToZod(registration?.inputSchema ?? { type: 'object', additionalProperties: true })

      return sdk.tool!(
        descriptor.toolName,
        descriptor.description,
        inputSchema,
        async (args) => {
          const state = await input.getAgentState()
          const runtimeSnapshot = input.runtime.getAgentRuntime(state, input.agentId)
          const runtimeToolName = buildProductAgentToolRuntimeName(pkg.productId, descriptor.toolName)
          const toolCallId = createProductToolCallId()
          const result = await invokeProductAgentToolThroughBridge(input.runtime, runtimeSnapshot, {
            getState: input.getAgentState,
            sessionId: input.sessionId,
            agentId: input.agentId,
            runtimeToolName,
            toolInput: args,
            toolCallId,
            signal: input.signal,
            emitChunk: input.emitChunk
          })
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result.output)
              }
            ]
          }
        }
      )
    })

    const serverKey = buildProductAgentToolMcpServerKey(pkg.productId)
    servers[serverKey] = sdk.createSdkMcpServer({
      name: serverKey,
      version: '1.0.0',
      tools: sdkTools
    })
  }

  return servers
}

async function defaultLoadProductToolSdkHelpers(): Promise<ProductAgentToolSdkModule | null> {
  try {
    return (await import('@anthropic-ai/claude-agent-sdk')) as ProductAgentToolSdkModule
  } catch {
    return null
  }
}
