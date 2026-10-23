import type { McpTool } from '../schemas/toolSchemas'
import type { McpServerEntity } from '../schemas/mcpServerSchemas'
import type { McpToolInput } from '../tools/agentToolCatalog'

export type McpRuntimeServerToolCall = {
  toolName: string
  input?: unknown
  sessionId?: string
  sessionContext?: unknown
  signal?: AbortSignal
}

export type McpRuntimeToolInvokeResult = {
  output: unknown
  content?: unknown
  structuredContent?: unknown
  isError?: boolean
  sessionContext?: unknown | null
}

export type McpRuntimeServerToolsChangedEvent = {
  tools?: readonly McpToolInput[]
  error?: unknown
}

export type McpRuntimeServerHost = {
  discoverTools: () => Promise<readonly McpToolInput[]>
  invokeTool: (input: McpRuntimeServerToolCall) => Promise<McpRuntimeToolInvokeResult>
  inspectTool?: (toolName: string) => Promise<McpToolInput | null>
  searchTools?: (query: string) => Promise<readonly McpToolInput[]>
  subscribeToToolChanges?: (listener: (event: McpRuntimeServerToolsChangedEvent) => void) => (() => void) | void
  close: () => Promise<void> | void
}

export type McpRuntimeServerHostFactory = (
  server: McpServerEntity
) => Promise<McpRuntimeServerHost> | McpRuntimeServerHost

export type McpRuntimeToolReference =
  | {
      serverId: string
      toolName: string
    }
  | {
      toolId: string
    }

export type McpRuntimeOperation =
  | {
      kind: 'discover-tools'
      serverId: string
    }
  | {
      kind: 'restart-server'
      serverId: string
    }
  | {
      kind: 'search-tools'
      serverId: string
      query: string
    }
  | ({
      kind: 'inspect-tool'
    } & McpRuntimeToolReference)
  | ({
      kind: 'invoke-tool'
      input?: unknown
      sessionId?: string
      signal?: AbortSignal
    } & McpRuntimeToolReference)

export type McpRuntimeOperationResult =
  | {
      kind: 'discover-tools'
      tools: McpTool[]
    }
  | {
      kind: 'restart-server'
      tools: McpTool[]
    }
  | {
      kind: 'search-tools'
      tools: McpTool[]
    }
  | {
      kind: 'inspect-tool'
      tool: McpTool | null
    }
  | {
      kind: 'invoke-tool'
      result: McpRuntimeToolInvokeResult
    }
