declare module '@anthropic-ai/claude-agent-sdk' {
  export function query(input: unknown): AsyncIterable<unknown>
  const mod: { query?: typeof query }
  export default mod
}

declare module '@anthropic-ai/claude-code' {
  export function query(input: unknown): AsyncIterable<unknown>
  const mod: { query?: typeof query }
  export default mod
}

declare module '@modelcontextprotocol/sdk/client/index.js' {
  export class Client {
    constructor(info: unknown, options?: unknown)
    connect(transport: unknown): Promise<void>
    listTools(): Promise<{ tools?: readonly unknown[] }>
    callTool(input: unknown, resultSchema?: unknown, options?: unknown): Promise<unknown>
    close(): Promise<void>
  }
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  export class StdioClientTransport {
    constructor(options: unknown)
  }
}

declare module '@modelcontextprotocol/sdk/client/sse.js' {
  export class SSEClientTransport {
    constructor(url: URL, options?: unknown)
  }
}

declare module '@modelcontextprotocol/sdk/client/streamableHttp' {
  export class StreamableHTTPClientTransport {
    constructor(url: URL, options?: unknown)
  }
}

declare module '@modelcontextprotocol/client' {
  export class Client {
    constructor(info: unknown, options?: unknown)
    connect(transport: unknown): Promise<void>
    listTools(): Promise<{ tools?: readonly unknown[] }>
    callTool(input: unknown, resultSchema?: unknown, options?: unknown): Promise<unknown>
    close(): Promise<void>
  }

  export class SSEClientTransport {
    constructor(url: URL, options?: unknown)
  }

  export class StreamableHTTPClientTransport {
    constructor(url: URL, options?: unknown)
  }
}

declare module '@modelcontextprotocol/client/stdio' {
  export class StdioClientTransport {
    constructor(options: unknown)
  }
}
