import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { gunzipSync } from 'node:zlib'

import type { AgentObservabilitySettings } from '../../../ai/agent-platform/runtime/agentObservabilitySettings'
import {
  AgentOtlpPayloadAdapter,
  type AgentOtlpLogSummary,
  type AgentOtlpSpanSummary
} from './AgentOtlpPayloadAdapter'

const MAX_BODY_BYTES = 10 * 1024 * 1024

export type AgentOtlpBridgeIngestHandler = {
  onSpans?: (spans: AgentOtlpSpanSummary[]) => void
  onLogs?: (logs: AgentOtlpLogSummary[]) => void
  onRawPayload?: (pathname: '/v1/traces' | '/v1/logs', payload: unknown) => void
}

export type AgentOtlpBridgeServiceOptions = {
  settings: Pick<AgentObservabilitySettings, 'includePrompts' | 'includeToolContent'>
  handlers?: AgentOtlpBridgeIngestHandler
}

export class AgentOtlpBridgeService {
  private server?: Server
  private endpoint?: string
  private startPromise?: Promise<string>
  private readonly settings: Pick<AgentObservabilitySettings, 'includePrompts' | 'includeToolContent'>
  private readonly handlers: AgentOtlpBridgeIngestHandler

  constructor(options: AgentOtlpBridgeServiceOptions) {
    this.settings = options.settings
    this.handlers = options.handlers ?? {}
  }

  getEndpoint(): string | undefined {
    return this.endpoint
  }

  async ensureServer(): Promise<string> {
    if (this.endpoint) return this.endpoint
    if (this.startPromise) return this.startPromise

    this.startPromise = new Promise<string>((resolve, reject) => {
      const server = createServer((req, res) => {
        void this.handleRequest(req, res)
      })

      const fail = (error: Error) => {
        this.startPromise = undefined
        reject(error)
      }

      server.once('error', fail)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', fail)
        const address = server.address()
        if (!address || typeof address === 'string') {
          server.close()
          fail(new Error('Agent OTLP bridge did not bind a TCP port'))
          return
        }
        this.server = server
        this.endpoint = `http://127.0.0.1:${address.port}`
        resolve(this.endpoint)
      })
    })

    return this.startPromise
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = undefined
    this.endpoint = undefined
    this.startPromise = undefined
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  buildClaudeCodeTelemetryEnv(endpoint = this.endpoint): Record<string, string> | undefined {
    if (!endpoint) return undefined
    return {
      CLAUDE_CODE_ENABLE_TELEMETRY: '1',
      OTEL_TRACES_EXPORTER: 'otlp',
      OTEL_LOGS_EXPORTER: 'otlp',
      OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_ENDPOINT: endpoint,
      OTEL_EXPORTER_OTLP_TRACES_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `${endpoint}/v1/traces`,
      OTEL_EXPORTER_OTLP_LOGS_PROTOCOL: 'http/json',
      OTEL_EXPORTER_OTLP_LOGS_ENDPOINT: `${endpoint}/v1/logs`,
      OTEL_TRACES_EXPORT_INTERVAL: '1000',
      OTEL_LOGS_EXPORT_INTERVAL: '1000',
      OTEL_LOG_USER_PROMPTS: this.settings.includePrompts ? '1' : '0',
      OTEL_LOG_TOOL_DETAILS: this.settings.includeToolContent ? '1' : '0',
      OTEL_LOG_TOOL_CONTENT: this.settings.includeToolContent ? '1' : '0',
      OTEL_LOG_RAW_API_BODIES: '0'
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      this.respond(res, 405)
      return
    }

    const pathname = this.getPathname(req)
    if (pathname !== '/v1/traces' && pathname !== '/v1/logs') {
      this.respond(res, 404)
      return
    }

    if (!isJsonContentType(req)) {
      this.respond(res, 415)
      return
    }

    try {
      const payload = await readJsonBody(req)
      this.handlers.onRawPayload?.(pathname, payload)
      if (pathname === '/v1/traces') {
        const spans = AgentOtlpPayloadAdapter.spansFromPayload(payload, this.settings)
        this.handlers.onSpans?.(spans)
        this.respond(res, 200)
        return
      }
      const logs = AgentOtlpPayloadAdapter.logsFromPayload(payload, this.settings)
      this.handlers.onLogs?.(logs)
      this.respond(res, 200)
    } catch (error) {
      this.respond(res, error instanceof UnsupportedContentEncodingError ? 415 : 400)
    }
  }

  private respond(res: ServerResponse, statusCode: number): void {
    res.writeHead(statusCode, { 'content-type': 'application/json' })
    res.end('{}')
  }

  private getPathname(req: IncomingMessage): string {
    return new URL(req.url ?? '/', this.endpoint ?? 'http://127.0.0.1').pathname
  }
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new Error('OTLP payload too large')
    }
    chunks.push(buffer)
  }

  let body = Buffer.concat(chunks)
  const encoding = getHeaderValue(req.headers['content-encoding']).toLowerCase()
  if (encoding === 'gzip') {
    try {
      body = gunzipSync(body, { maxOutputLength: MAX_BODY_BYTES })
    } catch (error) {
      if (error instanceof RangeError) {
        throw new Error('OTLP payload too large after gzip decompression')
      }
      throw error
    }
  } else if (encoding !== '' && encoding !== 'identity') {
    throw new UnsupportedContentEncodingError(`Unsupported OTLP content encoding: ${encoding}`)
  }

  const text = body.toString('utf8')
  if (!text) return {}
  return JSON.parse(text)
}

function isJsonContentType(req: IncomingMessage): boolean {
  return getHeaderValue(req.headers['content-type']).toLowerCase().includes('application/json')
}

function getHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value.join(',')
  return value ?? ''
}

class UnsupportedContentEncodingError extends Error {}
