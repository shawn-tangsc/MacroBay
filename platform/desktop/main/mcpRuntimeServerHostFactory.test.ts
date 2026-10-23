import { describe, expect, it, vi } from 'vitest'

import type { McpServerEntity } from '../../ai/agent-platform/schemas/mcpServerSchemas'
import { createMcpRuntimeServerHostFactory, createMcpSdkModuleLoader } from './mcpRuntimeServerHostFactory'

const stdioServer: McpServerEntity = {
  id: 'mcp-files',
  name: 'Filesystem',
  type: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem'],
  isActive: true
}

const sseServer: McpServerEntity = {
  id: 'mcp-search',
  name: 'Search',
  type: 'sse',
  baseUrl: 'https://mcp.example.com/sse',
  headers: {
    Authorization: 'Bearer secret'
  },
  isActive: true
}

const streamableHttpServer: McpServerEntity = {
  id: 'mcp-http',
  name: 'HTTP Search',
  type: 'streamableHttp',
  baseUrl: 'https://mcp.example.com/http',
  headers: {
    'X-API-Key': 'secret'
  },
  isActive: true
}

describe('mcp runtime server host factory', () => {
  it('creates a stdio-backed host that discovers, inspects, searches, and invokes tools', async () => {
    const listTools = vi.fn(async () => ({
      tools: [
        {
          name: 'read_file',
          description: 'Read a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
        },
        {
          name: 'search_files',
          description: 'Search files'
        }
      ]
    }))
    const callTool = vi.fn(async () => ({
      content: [{ type: 'text', text: 'ok' }],
      isError: false
    }))
    const close = vi.fn(async () => {})
    const connect = vi.fn(async () => {})
    const createClient = vi.fn(() => ({
      connect,
      listTools,
      callTool,
      close
    }))
    const createStdioTransport = vi.fn((options: unknown) => ({ kind: 'stdio', options }))

    const createHost = createMcpRuntimeServerHostFactory({
      loadMcpSdkModule: async () => ({
        ok: true,
        module: {
          Client: class {},
          StdioClientTransport: class {}
        }
      }),
      createClient,
      createStdioTransport
    })

    const host = await createHost(stdioServer)

    await expect(host.discoverTools()).resolves.toEqual([
      {
        id: 'read_file',
        name: 'read_file',
        description: 'Read a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
      },
      {
        id: 'search_files',
        name: 'search_files',
        description: 'Search files',
        inputSchema: undefined
      }
    ])

    await expect(host.inspectTool?.('read_file')).resolves.toEqual({
      id: 'read_file',
      name: 'read_file',
      description: 'Read a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
    })
    await expect(host.inspectTool?.('missing')).resolves.toBeNull()
    await expect(host.searchTools?.('search')).resolves.toEqual([
      {
        id: 'search_files',
        name: 'search_files',
        description: 'Search files',
        inputSchema: undefined
      }
    ])
    await expect(
      host.invokeTool({
        toolName: 'read_file',
        input: { path: '/tmp/demo.txt' },
        sessionContext: 'mcp-session-1'
      })
    ).resolves.toEqual({
      output: 'ok',
      content: [{ type: 'text', text: 'ok' }],
      isError: false
    })

    expect(createStdioTransport).toHaveBeenCalledWith({
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem'],
      env: undefined
    })
    expect(connect).toHaveBeenCalledTimes(1)
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'read_file',
        arguments: { path: '/tmp/demo.txt' },
        sessionContext: 'mcp-session-1'
      },
      undefined,
      undefined
    )

    await host.close()
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('normalizes rich MCP tool invocation results and forwards abort signals', async () => {
    const abortController = new AbortController()
    const callTool = vi.fn(async () => ({
      content: [
        { type: 'text', text: 'File not found.' },
        { type: 'image', data: 'base64-image', mimeType: 'image/png' },
        { type: 'resource', resource: { uri: 'file:///tmp/missing.txt', text: 'missing' } }
      ],
      structuredContent: {
        code: 'ENOENT',
        path: '/tmp/missing.txt'
      },
      isError: true,
      sessionContext: {
        id: 'mcp-session-2'
      }
    }))
    const close = vi.fn(async () => {})
    const connect = vi.fn(async () => {})
    const createClient = vi.fn(() => ({
      connect,
      listTools: vi.fn(async () => ({ tools: [] })),
      callTool,
      close
    }))

    const createHost = createMcpRuntimeServerHostFactory({
      loadMcpSdkModule: async () => ({
        ok: true,
        module: {
          Client: class {},
          StdioClientTransport: class {}
        }
      }),
      createClient,
      createStdioTransport: vi.fn(() => ({ kind: 'stdio' }))
    })

    const host = await createHost(stdioServer)

    await expect(
      host.invokeTool({
        toolName: 'read_file',
        input: { path: '/tmp/missing.txt' },
        signal: abortController.signal
      })
    ).resolves.toEqual({
      output: {
        code: 'ENOENT',
        path: '/tmp/missing.txt'
      },
      content: [
        { type: 'text', text: 'File not found.' },
        { type: 'image', data: 'base64-image', mimeType: 'image/png' },
        { type: 'resource', resource: { uri: 'file:///tmp/missing.txt', text: 'missing' } }
      ],
      structuredContent: {
        code: 'ENOENT',
        path: '/tmp/missing.txt'
      },
      isError: true,
      sessionContext: {
        id: 'mcp-session-2'
      }
    })
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'read_file',
        arguments: { path: '/tmp/missing.txt' }
      },
      undefined,
      {
        signal: abortController.signal
      }
    )

    await host.close()
  })

  it('bridges SDK live tool-change callbacks into host subscribers and cached tool metadata', async () => {
    const listTools = vi.fn(async () => ({
      tools: [{ name: 'read_file', description: 'Read a file' }]
    }))
    const close = vi.fn(async () => {})
    const connect = vi.fn(async () => {})
    let onToolsChanged:
      | ((error: unknown, tools?: ReadonlyArray<{ name: string; description?: string; inputSchema?: Record<string, unknown> }>) => void)
      | undefined
    const createClient = vi.fn((input?: { onToolsChanged?: typeof onToolsChanged }) => {
      onToolsChanged = input?.onToolsChanged
      return {
        connect,
        listTools,
        callTool: vi.fn(async () => ({ content: [] })),
        close
      }
    })

    const createHost = createMcpRuntimeServerHostFactory({
      loadMcpSdkModule: async () => ({
        ok: true,
        module: {
          Client: class {},
          StdioClientTransport: class {}
        }
      }),
      createClient,
      createStdioTransport: vi.fn(() => ({ kind: 'stdio' }))
    })

    const host = await createHost(stdioServer)
    const listener = vi.fn()
    const unsubscribe = host.subscribeToToolChanges?.(listener)

    onToolsChanged?.(null, [
      {
        name: 'write_file',
        description: 'Write a file',
        inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
      }
    ])

    expect(listener).toHaveBeenCalledWith({
      tools: [
        {
          id: 'write_file',
          name: 'write_file',
          description: 'Write a file',
          inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
        }
      ]
    })
    await expect(host.inspectTool?.('write_file')).resolves.toEqual({
      id: 'write_file',
      name: 'write_file',
      description: 'Write a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } }
    })

    const notificationError = new Error('tool watch failed')
    onToolsChanged?.(notificationError)

    expect(listener).toHaveBeenLastCalledWith({
      error: notificationError
    })

    unsubscribe?.()
    onToolsChanged?.(null, [{ name: 'after_unsubscribe', description: 'Ignored after unsubscribe' }])
    expect(listener).toHaveBeenCalledTimes(2)

    await host.close()
  })

  it('creates SSE and streamable HTTP transports with forwarded headers', async () => {
    const connect = vi.fn(async () => {})
    const close = vi.fn(async () => {})
    const createClient = vi.fn(() => ({
      connect,
      listTools: vi.fn(async () => ({ tools: [] })),
      callTool: vi.fn(async () => ({ content: [] })),
      close
    }))
    const createSseTransport = vi.fn((url: URL, options: unknown) => ({ kind: 'sse', url, options }))
    const createStreamableHttpTransport = vi.fn((url: URL, options: unknown) => ({
      kind: 'streamable-http',
      url,
      options
    }))

    const createHost = createMcpRuntimeServerHostFactory({
      loadMcpSdkModule: async () => ({
        ok: true,
        module: {
          Client: class {},
          SSEClientTransport: class {},
          StreamableHTTPClientTransport: class {}
        }
      }),
      createClient,
      createSseTransport,
      createStreamableHttpTransport
    })

    const sseHost = await createHost(sseServer)
    const httpHost = await createHost(streamableHttpServer)

    expect(createSseTransport).toHaveBeenCalledWith(new URL('https://mcp.example.com/sse'), {
      requestInit: {
        headers: {
          Authorization: 'Bearer secret'
        }
      }
    })
    expect(createStreamableHttpTransport).toHaveBeenCalledWith(new URL('https://mcp.example.com/http'), {
      requestInit: {
        headers: {
          'X-API-Key': 'secret'
        }
      }
    })

    await sseHost.close()
    await httpHost.close()
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('throws a clear error when the MCP SDK package is unavailable', async () => {
    const createHost = createMcpRuntimeServerHostFactory({
      loadMcpSdkModule: async () => ({
        ok: false,
        reason: 'module-not-installed',
        message: 'MCP SDK package is not installed.'
      })
    })

    await expect(createHost(stdioServer)).rejects.toThrow('MCP SDK package is not installed.')
  })

  it('rejects invalid server transport configuration before opening a client', async () => {
    const createClient = vi.fn()
    const createHost = createMcpRuntimeServerHostFactory({
      loadMcpSdkModule: async () => ({
        ok: true,
        module: {
          Client: class {},
          StdioClientTransport: class {}
        }
      }),
      createClient
    })

    await expect(
      createHost({
        ...stdioServer,
        command: undefined
      })
    ).rejects.toThrow('MCP stdio server "mcp-files" is missing a command.')

    await expect(
      createHost({
        ...sseServer,
        baseUrl: '   '
      })
    ).rejects.toThrow('MCP remote server "mcp-search" is missing a baseUrl.')

    await expect(
      createHost({
        ...sseServer,
        baseUrl: 'not-a-valid-url'
      })
    ).rejects.toThrow('MCP remote server "mcp-search" has an invalid baseUrl: not-a-valid-url.')

    expect(createClient).not.toHaveBeenCalled()
  })

  it('reports a stable not-installed result when the MCP SDK import fails', async () => {
    const loadMcpSdkModule = createMcpSdkModuleLoader({
      importer: async () => {
        const error = new Error("Cannot find package '@modelcontextprotocol/sdk'") as Error & {
          code?: string
        }
        error.code = 'ERR_MODULE_NOT_FOUND'
        throw error
      }
    })

    await expect(loadMcpSdkModule()).resolves.toEqual({
      ok: false,
      reason: 'module-not-installed',
      message: 'MCP SDK package is not installed in the desktop main process runtime.'
    })
  })

  it('falls back across multiple MCP SDK importers before succeeding', async () => {
    const loadMcpSdkModule = createMcpSdkModuleLoader({
      importers: [
        async () => {
          const error = new Error("Cannot find package '@modelcontextprotocol/client'") as Error & {
            code?: string
          }
          error.code = 'ERR_MODULE_NOT_FOUND'
          throw error
        },
        async () => ({
          Client: class {},
          StdioClientTransport: class {}
        })
      ]
    })

    await expect(loadMcpSdkModule()).resolves.toMatchObject({
      ok: true
    })
  })
})
