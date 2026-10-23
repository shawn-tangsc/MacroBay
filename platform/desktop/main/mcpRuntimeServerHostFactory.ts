import {
  createMcpRuntimeConfigError,
  createMcpRuntimeDependencyError,
  normalizeMcpRuntimeToolInvokeResult,
  type McpRuntimeServerHostFactory,
  type McpRuntimeToolInvokeResult
} from '../../ai/agent-platform/mcp'
import type { McpServerEntity } from '../../ai/agent-platform/schemas/mcpServerSchemas'
import type { McpToolInput } from '../../ai/agent-platform/tools/agentToolCatalog'

type McpSdkModule = {
  Client?: new (...args: any[]) => unknown
  StdioClientTransport?: new (...args: any[]) => unknown
  SSEClientTransport?: new (...args: any[]) => unknown
  StreamableHTTPClientTransport?: new (...args: any[]) => unknown
}

type McpSdkListChangedCallback = (error: unknown, tools?: readonly McpSdkTool[]) => void

type McpSdkClient = {
  connect: (transport: unknown) => Promise<void>
  listTools: () => Promise<{ tools?: readonly McpSdkTool[] }>
  callTool: (
    input: { name: string; arguments?: unknown },
    resultSchema?: unknown,
    options?: { signal?: AbortSignal }
  ) => Promise<unknown>
  close: () => Promise<void>
}

type McpSdkTool = {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

type McpSdkLoadResult =
  | {
      ok: true
      module: McpSdkModule
    }
  | {
      ok: false
      reason: 'module-not-installed'
      message: string
    }

type McpRuntimeServerHostFactoryDependencies = {
  loadMcpSdkModule?: () => Promise<McpSdkLoadResult>
  createClient?: (input?: { onToolsChanged?: McpSdkListChangedCallback }) => McpSdkClient
  createStdioTransport?: (input: { command: string; args: string[]; env?: Record<string, string> }) => unknown
  createSseTransport?: (url: URL, options: { requestInit: { headers?: Record<string, string> } }) => unknown
  createStreamableHttpTransport?: (url: URL, options: { requestInit: { headers?: Record<string, string> } }) => unknown
}

export function createMcpRuntimeServerHostFactory(
  deps: McpRuntimeServerHostFactoryDependencies
): McpRuntimeServerHostFactory {
  const loadMcpSdkModule = deps.loadMcpSdkModule ?? createMcpSdkModuleLoader()

  return async (server) => {
    const sdk = await loadMcpSdkModule()
    if (!sdk.ok) {
      throw createMcpRuntimeDependencyError(sdk.message)
    }

    const transport = createServerTransport(server, sdk.module, deps)
    const toolChangeListeners = new Set<(event: { tools?: readonly McpToolInput[]; error?: unknown }) => void>()
    let cachedTools: McpToolInput[] | null = null
    const emitToolChange = (event: { tools?: readonly McpToolInput[]; error?: unknown }): void => {
      for (const listener of toolChangeListeners) {
        listener(event)
      }
    }
    const client =
      deps.createClient?.({
        onToolsChanged: (error, tools) => {
          if (error) {
            emitToolChange({ error })
            return
          }

          if (!tools) return
          cachedTools = tools.map(normalizeSdkTool)
          emitToolChange({ tools: cachedTools })
        }
      }) ?? createSdkClient(sdk.module, {
        onToolsChanged: (error, tools) => {
          if (error) {
            emitToolChange({ error })
            return
          }

          if (!tools) return
          cachedTools = tools.map(normalizeSdkTool)
          emitToolChange({ tools: cachedTools })
        }
      })
    await client.connect(transport)

    const loadTools = async (): Promise<McpToolInput[]> => {
      const result = await client.listTools()
      cachedTools = (result.tools ?? []).map(normalizeSdkTool)
      return cachedTools
    }

    return {
      discoverTools: async () => loadTools(),
      inspectTool: async (toolName) => {
        const tools = cachedTools ?? (await loadTools())
        return tools.find((tool) => tool.name === toolName) ?? null
      },
      searchTools: async (query) => {
        const normalizedQuery = query.trim().toLowerCase()
        const tools = cachedTools ?? (await loadTools())
        if (!normalizedQuery) return tools
        return tools.filter((tool) => {
          const description = tool.description?.toLowerCase() ?? ''
          return tool.name.toLowerCase().includes(normalizedQuery) || description.includes(normalizedQuery)
        })
      },
      invokeTool: async ({ toolName, input, sessionContext, signal }): Promise<McpRuntimeToolInvokeResult> => {
        const result = await client.callTool(
          {
            name: toolName,
            arguments: input,
            ...(sessionContext == null ? {} : { sessionContext })
          },
          undefined,
          signal ? { signal } : undefined
        )
        return normalizeMcpRuntimeToolInvokeResult(result)
      },
      subscribeToToolChanges: (listener) => {
        toolChangeListeners.add(listener)
        return () => {
          toolChangeListeners.delete(listener)
        }
      },
      close: async () => {
        await client.close()
      }
    }
  }
}

type McpSdkModuleLoaderDependencies = {
  importer?: () => Promise<McpSdkModule>
  importers?: Array<() => Promise<McpSdkModule>>
}

export function createMcpSdkModuleLoader(
  deps: McpSdkModuleLoaderDependencies = {}
): () => Promise<McpSdkLoadResult> {
  const importers =
    deps.importers && deps.importers.length > 0
      ? deps.importers
      : deps.importer
        ? [deps.importer]
        : [defaultMcpSdkImporter]

  return async () => {
    let lastNotInstalledError: unknown = null

    for (const importer of importers) {
      try {
        return {
          ok: true,
          module: await importer()
        }
      } catch (error) {
        if (isMcpSdkModuleNotInstalledError(error)) {
          lastNotInstalledError = error
          continue
        }
        throw error
      }
    }

    return {
      ok: false,
      reason: 'module-not-installed',
      message:
        lastNotInstalledError instanceof Error && lastNotInstalledError.message.trim()
          ? 'MCP SDK package is not installed in the desktop main process runtime.'
          : 'MCP SDK package is not installed in the desktop main process runtime.'
    }
  }
}

function createSdkClient(
  module: McpSdkModule,
  options: {
    onToolsChanged?: McpSdkListChangedCallback
  } = {}
): McpSdkClient {
  if (!module.Client) {
    throw new Error('MCP SDK Client export is not available from the loaded module.')
  }

  return new module.Client({
    name: 'AI Desktop',
    version: '0.1.0'
  }, {
    capabilities: {},
    listChanged: options.onToolsChanged
      ? {
          tools: {
            onChanged: options.onToolsChanged
          }
        }
      : undefined
  }) as unknown as McpSdkClient
}

function createServerTransport(
  server: McpServerEntity,
  module: McpSdkModule,
  deps: McpRuntimeServerHostFactoryDependencies
): unknown {
  if (server.type === 'stdio' || (!server.type && server.command)) {
    const command = server.command?.trim()
    if (!command) {
      throw createMcpRuntimeConfigError(`MCP stdio server "${server.id}" is missing a command.`)
    }
    const args = server.args ? [...server.args] : []
    return (
      deps.createStdioTransport?.({
        command,
        args,
        ...(server.env ? { env: { ...server.env } } : {})
      }) ?? createSdkTransport(module.StdioClientTransport, [{ command, args, env: server.env }], 'StdioClientTransport')
    )
  }

  if (server.type === 'sse') {
    const baseUrl = server.baseUrl?.trim()
    if (!baseUrl) {
      throw createMcpRuntimeConfigError(`MCP remote server "${server.id}" is missing a baseUrl.`)
    }
    const remoteUrl = parseServerUrl(server.id, baseUrl)
    return (
      deps.createSseTransport?.(remoteUrl, {
        requestInit: {
          ...(server.headers ? { headers: { ...server.headers } } : {})
        }
      }) ??
      createSdkTransport(
        module.SSEClientTransport,
        [
          remoteUrl,
          {
            requestInit: {
              ...(server.headers ? { headers: { ...server.headers } } : {})
            }
          }
        ],
        'SSEClientTransport'
      )
    )
  }

  if (server.type === 'streamableHttp') {
    const baseUrl = server.baseUrl?.trim()
    if (!baseUrl) {
      throw createMcpRuntimeConfigError(`MCP remote server "${server.id}" is missing a baseUrl.`)
    }
    const remoteUrl = parseServerUrl(server.id, baseUrl)
    return (
      deps.createStreamableHttpTransport?.(remoteUrl, {
        requestInit: {
          ...(server.headers ? { headers: { ...server.headers } } : {})
        }
      }) ??
      createSdkTransport(
        module.StreamableHTTPClientTransport,
        [
          remoteUrl,
          {
            requestInit: {
              ...(server.headers ? { headers: { ...server.headers } } : {})
            }
          }
        ],
        'StreamableHTTPClientTransport'
      )
    )
  }

  throw createMcpRuntimeConfigError(`Unsupported MCP server type for "${server.id}": ${server.type ?? 'unknown'}.`)
}

function createSdkTransport(
  Transport: (new (...args: any[]) => unknown) | undefined,
  args: any[],
  exportName: string
): unknown {
  if (!Transport) {
    throw createMcpRuntimeDependencyError(`MCP SDK ${exportName} export is not available from the loaded module.`)
  }
  return new Transport(...args)
}

function parseServerUrl(serverId: string, baseUrl: string): URL {
  try {
    return new URL(baseUrl)
  } catch {
    throw createMcpRuntimeConfigError(`MCP remote server "${serverId}" has an invalid baseUrl: ${baseUrl}.`)
  }
}

async function defaultMcpSdkImporter(): Promise<McpSdkModule> {
  try {
    const [clientModule, stdioModule] = await Promise.all([
      import('@modelcontextprotocol/client'),
      import('@modelcontextprotocol/client/stdio')
    ])

    return {
      Client: clientModule.Client,
      StdioClientTransport: stdioModule.StdioClientTransport,
      SSEClientTransport: clientModule.SSEClientTransport,
      StreamableHTTPClientTransport: clientModule.StreamableHTTPClientTransport
    }
  } catch (error) {
    if (!isMcpSdkModuleNotInstalledError(error)) {
      throw error
    }

    const [clientModule, stdioModule, sseModule, streamableHttpModule] = await Promise.all([
      import('@modelcontextprotocol/sdk/client/index.js'),
      import('@modelcontextprotocol/sdk/client/stdio.js'),
      import('@modelcontextprotocol/sdk/client/sse.js'),
      import('@modelcontextprotocol/sdk/client/streamableHttp')
    ])

    return {
      Client: clientModule.Client,
      StdioClientTransport: stdioModule.StdioClientTransport,
      SSEClientTransport: sseModule.SSEClientTransport,
      StreamableHTTPClientTransport: streamableHttpModule.StreamableHTTPClientTransport
    }
  }
}

function isMcpSdkModuleNotInstalledError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message
  return (
    ('code' in error && error.code === 'ERR_MODULE_NOT_FOUND') ||
    message.includes("@modelcontextprotocol/client") ||
    message.includes("@modelcontextprotocol/sdk") ||
    message.includes('Cannot find module')
  )
}

function normalizeSdkTool(tool: McpSdkTool): McpToolInput {
  return {
    id: tool.name,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }
}
