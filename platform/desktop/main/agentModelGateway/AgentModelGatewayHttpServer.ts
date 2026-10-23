import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer, type Server } from 'node:http'

import type { AgentModelGatewayProviderConfig } from './agentModelGatewayTypes'
import type { AgentModelGatewayProviderAdapter } from './AgentModelGatewayProviderAdapter'

export type AgentModelGatewayHttpServerOptions = {
  host?: string
  port: number
  getAuthToken: () => string
  getProviderConfig: () => AgentModelGatewayProviderConfig | null
  adapter: AgentModelGatewayProviderAdapter
  fetch: typeof fetch
  getUpstreamApiKey: () => string | null | Promise<string | null>
  now?: () => Date
}

export class AgentModelGatewayHttpServer {
  private server: Server | null = null
  private readonly host: string

  constructor(private readonly options: AgentModelGatewayHttpServerOptions) {
    this.host = options.host ?? '127.0.0.1'
  }

  getBaseUrl(): string {
    return `http://${this.host}:${this.options.port}/anthropic`
  }

  async start(): Promise<void> {
    if (this.server) return

    this.server = createServer((request, response) => {
      void this.handleRequest(request, response)
    })

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(this.options.port, this.host, () => resolve())
    })
  }

  async stop(): Promise<void> {
    if (!this.server) return
    const current = this.server
    this.server = null
    await new Promise<void>((resolve, reject) => {
      current.close((error) => (error ? reject(error) : resolve()))
    })
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url ?? '/', `http://${this.host}:${this.options.port}`)
      if (request.method === 'GET' && url.pathname === '/health') {
        writeJson(response, 200, { ok: true, status: 'live' })
        return
      }

      if (request.method === 'POST' && url.pathname === '/anthropic/v1/messages') {
        await this.handleAnthropicMessages(request, response)
        return
      }

      writeJson(response, 404, { error: 'not_found' })
    } catch (error) {
      writeJson(response, 500, {
        error: 'gateway_error',
        message: error instanceof Error ? error.message : 'Unknown gateway error'
      })
    }
  }

  private async handleAnthropicMessages(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const authHeader = request.headers['x-api-key']
    const token = typeof authHeader === 'string' ? authHeader : authHeader?.[0]
    if (!token || token !== this.options.getAuthToken()) {
      writeJson(response, 401, { error: 'unauthorized' })
      return
    }

    const config = this.options.getProviderConfig()
    if (!config) {
      writeJson(response, 503, { error: 'gateway_config_missing' })
      return
    }

    const upstreamApiKey = await this.options.getUpstreamApiKey()
    if (!upstreamApiKey) {
      writeJson(response, 503, { error: 'upstream_api_key_missing' })
      return
    }

    const body = await readRequestBody(request)
    const abortController = new AbortController()
    const onClientClose = () => abortController.abort(new Error('gateway-abort'))
    request.once('aborted', onClientClose)
    response.once('close', () => {
      if (!response.writableEnded) onClientClose()
    })

    try {
      const upstreamResponse = await this.options.adapter.forwardAnthropicMessages({
        config,
        body,
        upstreamApiKey,
        fetch: this.options.fetch,
        abortSignal: abortController.signal
      })

      response.statusCode = upstreamResponse.status
      for (const [key, value] of Object.entries(upstreamResponse.headers)) {
        if (typeof value === 'string') {
          response.setHeader(key, value)
        }
      }
      response.end(upstreamResponse.body)
    } finally {
      request.off('aborted', onClientClose)
    }
  }
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.statusCode = statusCode
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}
